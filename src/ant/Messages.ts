export class Message {
    private static checksumFunction = (prev: number, cur: number) => prev ^ cur;
    
    static SYNC_BYTE = 0xa4;

    static checksum(id: number, content: number[]): number {
        return [Message.SYNC_BYTE, content.length, id, ...content]
            .reduce(Message.checksumFunction, 0);
    }

    private id: number;
    private wait_for_reply: boolean;
    protected content: number[];

    constructor(id: number, content: number[], wait_for_reply = true) {
        this.id = id;
        this.content = content;
        this.wait_for_reply = wait_for_reply;
    }

    header(): number[] {
        return [
            Message.SYNC_BYTE,
            this.content.length,
            this.id,
        ];
    }

    checksum(): number {
        return this.header()
            .concat(this.content)
            .reduce(Message.checksumFunction, 0);
    }

    encode(): ArrayBuffer {
        const bytes = this.header()
            .concat(this.content)
            .concat(this.checksum());
        return new Uint8Array(bytes);
    }

    getContent(): number[] {
        return this.content;
    }

    getId(): number {
        return this.id;
    }

    waitForReply(): boolean {
        return this.wait_for_reply;
    }

    isReply(message: Message): boolean {
        return message instanceof ChannelEvent && message.getEventCode() === EventCode.RESPONSE_NO_ERROR;
    }
}


abstract class ExtendableMessage extends Message {

    constructor(id: number, content: number[]) {
        super(id, content);
    }

    isExtended(): boolean {
        return this.content.length > 9;
    }

    hasChannelOutput(): boolean {
        const flag_byte = this.content[9];
        return (flag_byte & 0x80) === 0x80;
    }

    hasRSSI(): boolean {
        const flag_byte = this.content[9];
        return (flag_byte & 0x40) === 0x40;
    }

    hasTimestamp(): boolean {
        const flag_byte = this.content[9];
        return (flag_byte & 0x20) === 0x20;
    }

    getDeviceNumber(): number {
        return (this.content[10] << 8) + this.content[11];
    }

    getDeviceType(): number {
        return this.content[12];
    }

    getTransType(): number {
        return this.content[13];
    }

    getMeasurementType(): number {
        const offset = this.hasChannelOutput() ? 4 : 0;
        return this.content[10 + offset];
    }

    getRSSIValue(): number {
        const offset = this.hasChannelOutput() ? 4 : 0;
        return this.content[11 + offset];
    }

    getThresholdConfigurationValue(): number {
        const offset = this.hasChannelOutput() ? 4 : 0;
        return this.content[12 + offset];
    }

    getTimestamp(): number {
        const offset = this.hasChannelOutput() ? this.hasRSSI() ? 7 : 4 : 0;
        return (this.content[10 + offset] << 8) + this.content[11 + offset];
    }
}


export enum EventCode {
    RESPONSE_NO_ERROR = 0x00,
    EVENT_RX_SEARCH_TIMEOUT = 0x01,
    EVENT_RX_FAIL = 0x02,
    EVENT_TX = 0x03,
    EVENT_TRANSFER_RX_FAILED = 0x04,
    EVENT_TRANSFER_TX_COMPLETED = 0x05,
    EVENT_TRANSFER_TX_FAILED = 0x06,
    EVENT_CHANNEL_CLOSED = 0x07,
    EVENT_RX_FAIL_GO_TO_SEARCH = 0x08,
    EVENT_CHANNEL_COLLISION = 0x09,
    EVENT_TRANSFER_TX_START = 0x0a,
    EVENT_TRANSFER_NEXT_DATA_BLOCK = 0x11,
    CHANNEL_IN_WRONG_STATE = 0x15,
    CHANNEL_NOT_OPENED = 0x16,
    CHANNEL_ID_NOT_SET = 0x18,
    CLOSE_ALL_CHANNELS = 0x19,
    TRANSFER_IN_PROGRESS = 0x1f,
    TRANSFER_SEQUENCE_NUMBER_ERROR = 0x20,
    TRANSFER_IN_ERROR = 0x21,
    MESSAGE_SIZE_EXCEEDS_LIMIT = 0x27,
    INVALID_MESSAGE = 0x28,
    INVALID_NETWORK_NUMBER = 0x29,
    INVALID_LIST_ID = 0x30,
    INVALID_SCAN_TX_CHANNEL = 0x31,
    INVALID_PARAMETER_PROVIDED = 0x33,
    EVENT_SERIAL_QUE_OVERFLOW = 0x34,
    EVENT_QUE_OVERFLOW = 0x35,
    ENCRYPT_NEGOTIATION_SUCCESS = 0x38,
    ENCRYPT_NEGOTIATION_FAIL = 0x39,
    NVM_FULL_ERROR = 0x40,
    NVM_WRITE_ERROR = 0x41,
    USB_STRING_WRITE_FAIL = 0x70,
    MESG_SERIAL_ERROR_ID = 0xae,
}


export class MessageChecksumError extends Error {
    constructor() {
        super("Message checksum is wrong!");
    }
}


export class StartupMessage extends Message {

    static ID = 0x6f;

    constructor(message: number[]) {
        super(StartupMessage.ID, [...message], false);
    }

    isPowerOnReset(): boolean {
        return this.content[0] === 0x00;
    }

    isHardwareReset(): boolean {
        return (this.content[0] & 0x01) === 0x01;
    }

    isWatchdogReset(): boolean {
        return (this.content[0] & 0x02) === 0x02;
    }

    isCommandReset(): boolean {
        return (this.content[0] & 0x10) === 0x10;
    }

    isSynchronousReset(): boolean {
        return (this.content[0] & 0x20) === 0x20;
    }

    isSuspendReset(): boolean {
        return (this.content[0] & 0x40) === 0x40;
    }
}


export class ResetMessage extends Message {

    static ID = 0x4a;

    constructor() {
        super(ResetMessage.ID, [0x00]);
    }

    isReply(message: Message): boolean {
        return message.getId() === StartupMessage.ID;
    }
}


export class SetNetworkKeyMessage extends Message {

    static ID = 0x46;

    constructor(key: number[], network_number: number) {
        super(SetNetworkKeyMessage.ID, [network_number, ...key]);
    }
}


export interface ExtendedAssignmentOptions {
    background_scanning_enable?: boolean;
    frequency_agility_enable?: boolean;
    fast_channel_init_enable?: boolean;
    asynchronous_transmission_enable?: boolean;
}


export class AssignChannelMessage extends Message {

    static ID = 0x42;

    constructor(type: number, channel_number: number, network_number: number, options: ExtendedAssignmentOptions = {
        asynchronous_transmission_enable: false,
        background_scanning_enable: false,
        fast_channel_init_enable: false,
        frequency_agility_enable: false,
    }) {
        const extended_assignment_byte = 0x00 |
            (options.background_scanning_enable ? 0x01 : 0x00) |
            (options.frequency_agility_enable ? 0x04 : 0x00) |
            (options.fast_channel_init_enable ? 0x10 : 0x00) |
            (options.asynchronous_transmission_enable ? 0x20 : 0x00);

        console.log("ext ass. byte", extended_assignment_byte);

        super(AssignChannelMessage.ID, extended_assignment_byte === 0x00 ?
            [channel_number, type, network_number] :
            [channel_number, type, network_number, extended_assignment_byte]);
    }
}


export class SetChannelIdMessage extends Message {

    static ID = 0x51;

    constructor(deviceType: number, channel_number: number) {
        super(SetChannelIdMessage.ID, [channel_number, 0x00, 0x00, deviceType, 0x00]);
    }
}


export class SetChannelHighPrioritySearchTimeoutMessage extends Message {

    static ID = 0x44;

    constructor(channel_number: number, timeout_in_seconds: number) {
        const timeout_counts = Math.min(255, Math.max(0, Math.round(timeout_in_seconds / 2.5)));
        super(SetChannelHighPrioritySearchTimeoutMessage.ID, [channel_number, timeout_counts])
    }
}


export class SetChannelLowPrioritySearchTimeoutMessage extends Message {

    static ID = 0x63;

    constructor(channel_number: number, timeout_in_seconds: number) {
        const timeout_counts = Math.min(255, Math.max(0, Math.round(timeout_in_seconds / 2.5)));
        super(SetChannelLowPrioritySearchTimeoutMessage.ID, [channel_number, timeout_counts])
    }
}


export class SetChannelPeriodMessage extends Message {

    static ID = 0x43;

    constructor(period: number, channel_number: number) {
        const buffer = new ArrayBuffer(2);
        const view = new DataView(buffer);
        view.setUint16(0, period, true);
        super(SetChannelPeriodMessage.ID, [channel_number, view.getUint8(0), view.getUint8(1)]);
    }
}


export class SetChannelRfFrequencyMessage extends Message {

    static ID = 0x45;

    constructor(frequency: number, channel_number: number) {
        super(SetChannelRfFrequencyMessage.ID, [channel_number, frequency]);
    }
}


export class OpenRxScanModeMessage extends Message {

    static ID = 0x5b;

    constructor(sync_packets_only = false) {
        super(OpenRxScanModeMessage.ID, [0x00, sync_packets_only ? 0x01 : 0x00])
    }
}


export class OpenChannelMessage extends Message {

    static ID = 0x4b;

    constructor(channel_number: number) {
        super(OpenChannelMessage.ID, [channel_number]);
    }
}


export class BroadcastMessage extends ExtendableMessage {

    static ID = 0x4e;

    static create(data: number[], channel_number: number): BroadcastMessage {
        return new BroadcastMessage([channel_number, ...data]);
    }

    constructor(content: number[]) {
        super(BroadcastMessage.ID, content);
    }

    isReply(message: Message): boolean {
        return message instanceof ChannelEvent && message.getEventCode() === EventCode.EVENT_TX;
    }

    getChannelNumber(): number {
        return this.content[0];
    }

    getPayload(): number[] {
        return this.content.slice(1);
    }
}


export enum ChannelStatus {
    UNASSIGNED = 0,
    ASSIGNED = 1,
    SEARCHING = 2,
    TRACKING = 3,
}


export class ChannelStatusMessage extends Message {

    static ID = 0x52;

    constructor(content: number[]) {
        super(ChannelStatusMessage.ID, content, false);
    }

    getChannelNumber(): number {
        return this.content[0];
    }

    getStatus(): ChannelStatus {
        return this.content[1] & 0x03;
    }
}


export class ChannelIdMessage extends Message {

    static ID = 0x51;

    constructor(content: number[]) {
        super(ChannelIdMessage.ID, content);
    }

    getChannelNumber(): number {
        return this.content[0];
    }

    getDeviceNumber(): number {
        return (this.content[1] << 8) + this.content[2];
    }

    getDeviceTypeId(): number {
        return this.content[3];
    }

    getTransType(): number {
        return this.content[4];
    }
}


declare type RequestedMessageCallback = (reply: Message) => void;


export class RequestMessage extends Message {

    static ID = 0x4d;

    private expected_message_id: number;
    private callback: RequestedMessageCallback;

    constructor(channel_number: number, message_id: number, callback: RequestedMessageCallback) {
        super(RequestMessage.ID, [channel_number, message_id]);
        this.expected_message_id = message_id;
        this.callback = callback;
    }

    isReply(message: Message): boolean {
        if (message.getId() === this.expected_message_id) {
            this.callback(message);
            return true;
        }
    }
}


export class ChannelEvent extends Message {

    static ID = 0x40;

    static create(channel_number: number, initiating_message_id: number, response_code: EventCode): ChannelEvent {
        return new ChannelEvent([channel_number, initiating_message_id, response_code]);
    }

    constructor(content: number[]) {
        super(ChannelEvent.ID, content);
    }

    getEventCode(): EventCode {
        return this.getContent()[2] as EventCode;
    }

    getEventCodeAsString(): string {
        return EventCode[this.getContent()[2]];
    }

    getInitiatingMessageId(): number {
        return this.getContent()[1];
    }

    getChannelNumber(): number {
        return this.getContent()[0];
    }

    isResponse(): boolean {
        return this.getContent()[1] !== 1;
    }
}

export function buildMessage(id: number, content: number[], checksum: number): Message {
    if (Message.checksum(id, content) !== checksum) throw new MessageChecksumError();

    switch (id) {
        case BroadcastMessage.ID:
            return new BroadcastMessage(content);

        case StartupMessage.ID:
            return new StartupMessage(content);

        case ChannelStatusMessage.ID:
            return new ChannelStatusMessage(content);

        case ChannelIdMessage.ID:
            return new ChannelIdMessage(content);

        case ChannelEvent.ID:
            const channel_event = new ChannelEvent(content);
            if (channel_event.getEventCode() != EventCode.EVENT_TX &&
                channel_event.getEventCode() != EventCode.RESPONSE_NO_ERROR) {
                console.warn("received event with code", channel_event.getEventCodeAsString(), "on channel", channel_event.getChannelNumber());
            }
            return channel_event;

        default:
            const message = new Message(id, content);
            console.warn("parsed message with unknown id", id, "and content", content);
            return message;
    }
}

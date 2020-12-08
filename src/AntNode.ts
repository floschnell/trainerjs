/**
 * ANT+ WebUSB driver
 * Very basic functionality (no extended message support, no burst support ...)
 * Tested with the CYCPLUS Ant+ Dongle: https://www.cycplus.com/products/ant-usb-stick-u1
 * 
 * @author Florian Schnell
 */


declare type NetworkKey = [number, number, number, number, number, number, number, number];


export class NetworkKeys {
    static readonly DefaultKey: NetworkKey = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    static readonly AntPlusKey: NetworkKey = [0xb9, 0xa5, 0x21, 0xfb, 0xbd, 0x72, 0xc3, 0x45];
    static readonly PublicKey: NetworkKey = [0xe8, 0xe4, 0x21, 0x3b, 0x55, 0x7a, 0x67, 0xc1];
}


interface USBDevice {
    open(): Promise<void>;
    selectConfiguration(config: number): Promise<void>;
    claimInterface(iface: number): Promise<void>;
    transferOut(channel: number, data: ArrayBuffer): Promise<boolean>;
    transferIn(channel: number, maxBytes: number): Promise<any>;
    reset(): Promise<any>;
    releaseInterface(iface: number): Promise<any>;
    close(): Promise<any>;
};


export class Message {
    static SYNC_BYTE = 0xa4;
    private id: number;
    protected content: number[];
    private wait_for_reply: boolean;

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
            .reduce((prev, cur) => prev ^ cur, 0);
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


interface ExtendedMessageParameters {
    device_number: number,
    device_type: number,
    transmission_type: number,
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


enum EventCode {
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


class StartupMessage extends Message {

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


class ResetMessage extends Message {

    static ID = 0x4a;

    constructor() {
        super(ResetMessage.ID, [0x00]);
    }

    isReply(message: Message): boolean {
        return message.getId() === StartupMessage.ID;
    }
}


class SetNetworkKeyMessage extends Message {

    static ID = 0x46;

    constructor(key: number[], network_number: number = 0x00) {
        super(SetNetworkKeyMessage.ID, [network_number, ...key]);
    }
}


class AssignChannelMessage extends Message {

    static ID = 0x42;

    constructor(type: number, channel_number: number = 0x00) {
        super(AssignChannelMessage.ID, [channel_number, type, 0x00]);
    }
}


class SetChannelIdMessage extends Message {

    static ID = 0x51;

    constructor(deviceType: number, channel_number: number = 0x00) {
        super(SetChannelIdMessage.ID, [channel_number, 0x00, 0x00, deviceType, 0x00]);
    }
}


class SetChannelPeriodMessage extends Message {

    static ID = 0x43;

    constructor(period: number, channel_number: number = 0x00) {
        const buffer = new ArrayBuffer(2);
        const view = new DataView(buffer);
        view.setUint16(0, period, true);
        super(SetChannelPeriodMessage.ID, [channel_number, view.getUint8(0), view.getUint8(1)]);
    }
}


class SetChannelRfFrequencyMessage extends Message {

    static ID = 0x45;

    constructor(frequency: number, channel_number: number = 0x00) {
        super(SetChannelRfFrequencyMessage.ID, [channel_number, frequency]);
    }
}


class OpenRxScanModeMessage extends Message {

    static ID = 0x5b;

    constructor(sync_packets_only = false) {
        super(OpenRxScanModeMessage.ID, [0x00, sync_packets_only ? 0x01 : 0x00])
    }
}


class OpenChannelMessage extends Message {

    static ID = 0x4b;

    constructor(channel_number: number = 0x00) {
        super(OpenChannelMessage.ID, [channel_number]);
    }
}


export class BroadcastMessage extends ExtendableMessage {

    static ID = 0x4e;

    static create(data: number[], channel_number: number = 0x00): BroadcastMessage {
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


class ChannelEvent extends Message {

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


interface QueuedMessage {
    message: Message,
    callback: () => void,
}


export enum ChannelType {
    BIDIRECTIONAL_RECEIVE = 0x00,
    BIDIRECTIONAL_TRANSMIT = 0x10,
    SHARED_BIDIRECTIONAL_RECEIVE = 0x20,
    SHARED_BIDIRECTIONAL_TRANSMIT = 0x30,
    UNIDIRECTIONAL_RECEIVE = 0x40,
    UNIDIRECTIONAL_TRANSMIT = 0x50,
}


export interface NodeConfig {
    network_key?: NetworkKey;
    channels: ChannelConfig[];
};


export interface ChannelConfig {
    number: number;
    type: ChannelType;
    device_type: number;
    period: number;
    rf_frequency: number;
    scan?: boolean;
}


export abstract class AntNode {
    protected configuration: NodeConfig;
    private device: USBDevice;
    private out_queue: QueuedMessage[] = [];
    private log: Console = null;
    private connected: boolean = false;

    constructor(configuration: NodeConfig, log = null) {
        this.log = log;
        this.configuration = configuration;

        if (this.configuration.network_key === undefined) {
            this.configuration.network_key = NetworkKeys.DefaultKey;
        }
    }

    public isConnected(): boolean {
        return this.connected;
    }

    public async connect(): Promise<void> {
        await this.initUSBDevice();
        this.connected = true;
        await this.initializeANTConnection();

        this.sendReceiveCycle();
    }

    public async disconnect(): Promise<void> {
        this.connected = false;
        await this.device.releaseInterface(0);
        await this.device.close();
        this.out_queue.splice(0);
    }

    private async initUSBDevice(): Promise<USBDevice> {
        // @ts-ignore
        this.device = await navigator.usb.requestDevice({
            filters: [{
                vendorId: 0x0FCF,
                productId: 0x1008,
            }]
        });

        await this.device.open();
        this.log_info("device", this.device, "opened");
        
        await this.device.selectConfiguration(1);
        this.log_info("config selected");
        
        await this.device.claimInterface(0);
        this.log_info("interface claimed");

        return this.device;
    }

    private async sendReceiveCycle(): Promise<void> {
        if (this.connected) {
            if (this.out_queue.length > 0) {
                const {
                    message: out_message,
                    callback,
                } = this.out_queue.shift();
                await this.sendMessage(out_message, callback);
            }

            try {
                const in_message = await this.receiveMessage();
                this.processMessage(in_message);
            } catch (e) {
                if (this.connected) {
                    throw e;
                }
            } finally {
                window.setTimeout(this.sendReceiveCycle.bind(this), 0);
            }
        }
    }

    protected abstract processMessage(in_message: Message): void;

    private async initializeANTConnection(): Promise<void> {
        await this.sendMessage(new ResetMessage());
        await new Promise((resolve) => setTimeout(resolve, 500));

        await this.sendMessage(new SetNetworkKeyMessage(this.configuration.network_key));

        for (const channel_config of this.configuration.channels) {
            this.log_info("opening channel", channel_config.number);
            await this.sendMessage(new AssignChannelMessage(channel_config.type, channel_config.number));
            await this.sendMessage(new SetChannelIdMessage(channel_config.device_type, channel_config.number));
            await this.sendMessage(new SetChannelRfFrequencyMessage(channel_config.rf_frequency, channel_config.number));
            await this.sendMessage(new SetChannelPeriodMessage(channel_config.period, channel_config.number));
            
            if (channel_config.scan === true) {
                await this.sendMessage(new OpenRxScanModeMessage());
                this.log_info("openend channel", channel_config.number, "in scan mode");
            } else {
                await this.sendMessage(new OpenChannelMessage(channel_config.number));
                this.log_info("openend channel", channel_config.number);
            }
        }
    }

    private async sendMessage(out_message: Message, callback: () => void = null): Promise<void> {
        const message_bytes = out_message.encode();
        await this.device.transferOut(1, message_bytes);

        // retry send every second
        const interval_handle = setInterval(async () => {
            await this.device.transferOut(1, message_bytes);
        }, 1000);

        // wait for ACK
        while (out_message.waitForReply()) {
            const in_message = await this.receiveMessage();
            if (out_message.isReply(in_message)) {
                break;
            }
        }

        clearInterval(interval_handle);
        if (callback !== null) callback();
    }

    private async receiveMessage(): Promise<Message> {
        let in_message: Message = null;
        do {
            const in_byte = new DataView((await this.device.transferIn(1, 1)).data.buffer).getUint8(0);
            if (in_byte === Message.SYNC_BYTE) {
                const message_size = new DataView((await this.device.transferIn(1, 1)).data.buffer).getUint8(0);
                const message_body = new Uint8Array((await this.device.transferIn(1, message_size + 2)).data.buffer);
                const message_id = message_body[0];
                const message_content = [...message_body.slice(1, message_size + 1)];
                const message_checksum = message_body[message_size + 1];
                in_message = this.buildMessage(message_id, message_content);

                if (in_message.checksum() !== message_checksum) {
                    throw new MessageChecksumError();
                }
            } else {
                console.warn("dropping byte:", in_byte);
            }
        } while (in_message === null);

        return in_message;
    }

    private buildMessage(id: number, content: number[]): Message {
        switch (id) {
            case BroadcastMessage.ID:
                return new BroadcastMessage(content);

            case StartupMessage.ID:
                return new StartupMessage(content);
            
            case ChannelEvent.ID:
                const channel_event = new ChannelEvent(content);
                if (channel_event.getEventCode() != EventCode.EVENT_TX) {
                    console.warn("received channel event with code", channel_event.getEventCodeAsString());
                }
                return channel_event;

            default:
                const message = new Message(id, content);
                console.warn("parsed message with unknown id", id, "and content", content);
                return message;
        }
    }

    protected queueMessage(message: Message, callback: () => void = null): void {
        this.out_queue.push({ message, callback });
    }

    protected log_info(...msg: any[]): void {
        if (this.log) {
            this.log.info(...msg);
        }
    }
}
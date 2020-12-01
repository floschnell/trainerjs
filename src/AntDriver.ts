/**
 * ANT+ WebUSB driver
 * Very basic functionality (no extended message support, no burst support ...)
 * Tested with the CYCPLUS Ant+ Dongle: https://www.cycplus.com/products/ant-usb-stick-u1
 * 
 * @author Florian Schnell
 */


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
    static ANT_SYNC_BYTE = 0xa4;
    private type: number;
    private content: number[];

    constructor(type: number, content: number[]) {
        this.type = type;
        this.content = content;
    }

    header(): number[] {
        return [
            Message.ANT_SYNC_BYTE,
            this.content.length,
            this.type,
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

    getType(): number {
        return this.type;
    }
}


export class MessageChecksumError extends Error {
    constructor() {
        super("Message checksum is wrong!");
    }
}


class ResetMessage extends Message {
    constructor() {
        super(0xA4, [0x00]);
    }
}


class SetNetworkKeyMessage extends Message {
    constructor(key: number[], network_number: number = 0x00) {
        super(0x46, [network_number, ...key]);
    }
}


class AssignChannelMessage extends Message {
    constructor(type: number, channel_number: number = 0x00) {
        super(0x42, [channel_number, type, 0x00]);
    }
}


class SetChannelIdMessage extends Message {
    constructor(deviceType: number, channel_number: number = 0x00) {
        super(0x51, [channel_number, 0x00, 0x00, deviceType, 0x00]);
    }
}


class SetChannelPeriodMessage extends Message {
    constructor(period: number, channel_number: number = 0x00) {
        const buffer = new ArrayBuffer(2);
        const view = new DataView(buffer);
        view.setUint16(0, period, true);
        super(0x43, [channel_number, view.getUint8(0), view.getUint8(1)]);
    }
}


class SetChannelRfFrequencyMessage extends Message {
    constructor(frequency: number, channel_number: number = 0x00) {
        super(0x45, [channel_number, frequency]);
    }
}


class OpenChannelMessage extends Message {
    constructor(channel_number: number = 0x00) {
        super(0x4b, [channel_number]);
    }
}


export class BroadcastMessage extends Message {
    constructor(data: number[], channel_number: number = 0x00) {
        super(0x4e, [channel_number, ...data]);
    }
}


interface QueuedMessage {
    message: Message,
    callback: () => void,
}


export interface AntConfiguration {
    channel_number?: number;
    channel_type: number;
    network_key: [number, number, number, number, number, number, number, number];
    device_type: number;
    channel_period: number;
    rf_frequency: number;
};


export abstract class AntDriver {
    private configuration: AntConfiguration;
    private device: USBDevice;
    private out_queue: QueuedMessage[] = [];
    private log: Console = null;
    private connected: boolean = false;

    constructor(configuration: AntConfiguration, log = null) {
        this.log = log;
        this.configuration = configuration;

        if (this.configuration.channel_number === undefined) {
            this.configuration.channel_number = 0x00;
        }
    }

    public isConnected(): boolean {
        return this.connected;
    }

    public async start(): Promise<void> {
        await this.initUSBDevice();
        this.connected = true;
        const connectionInitializedPromise = this.initializeANTConnection();
        this.sendReceiveCycle();
        return connectionInitializedPromise;
    }

    public async stop(): Promise<void> {
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
            await this.sendMessage();
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

    private initializeANTConnection(): Promise<void> {
        this.queueMessage(new ResetMessage());
        this.queueMessage(new SetNetworkKeyMessage(this.configuration.network_key));
        this.queueMessage(new AssignChannelMessage(this.configuration.channel_type, this.configuration.channel_number));
        this.queueMessage(new SetChannelIdMessage(this.configuration.device_type, this.configuration.channel_number));
        this.queueMessage(new SetChannelRfFrequencyMessage(this.configuration.rf_frequency, this.configuration.channel_number));
        this.queueMessage(new SetChannelPeriodMessage(this.configuration.channel_period, this.configuration.channel_number));
        return new Promise((resolve) => this.queueMessage(new OpenChannelMessage(this.configuration.channel_number), () => {
            this.log_info("opened ANT+ connection");
            resolve();
        }));
    }

    private async sendMessage(): Promise<void> {
        let out_message = null;
        do {
            if (this.out_queue.length === 0) break;
            const {
                message: out_message,
                callback,
            } = this.out_queue.shift();
            const message_bytes = out_message.encode();
            await this.device.transferOut(1, message_bytes);

            // retry send every second
            const interval_handle = setInterval(async () => {
                await this.device.transferOut(1, message_bytes);
            }, 1000);

            // wait for ACK
            while (true) {
                const in_message = await this.receiveMessage();
                if (in_message.getType() === 0x40) {
                    if (out_message instanceof BroadcastMessage) {
                        if (in_message.getContent()[1] === 0x01 && in_message.getContent()[2] === 0x03) {
                            break;
                        }
                    } else {
                        if (in_message.getContent()[1] === out_message.getType()) {
                            break;
                        }
                    }
                }
            }

            clearInterval(interval_handle);
            if (callback !== null) callback();

        } while (!(out_message instanceof BroadcastMessage));
    }

    private async receiveMessage(): Promise<Message> {
        let in_message = null;
        do {
            const message_trans_type = new DataView((await this.device.transferIn(1, 1)).data.buffer).getUint8(0);
            if (message_trans_type === Message.ANT_SYNC_BYTE) {
                const message_size = new DataView((await this.device.transferIn(1, 1)).data.buffer).getUint8(0);
                const message_body = new Uint8Array((await this.device.transferIn(1, message_size + 2)).data.buffer);
                const message_type = message_body[0];
                const message_content = [...message_body.slice(1, message_size + 1)];
                const message_checksum = message_body[message_size + 1];
                in_message = new Message(message_type, message_content);
                if (in_message.checksum() !== message_checksum) {
                    console.error(message_size, message_body);
                    throw new MessageChecksumError();
                }
            }
        } while (in_message === null);
        return in_message;
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
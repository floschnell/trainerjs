/**
 * Bushido WebUSB driver
 * Compatible with proprietary ANT+ protocol of the Tacx Bushido t1980.
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


class Message {
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


class MessageChecksumError extends Error {
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
    constructor(key: number[]) {
        super(0x46, [0x00, ...key]);
    }
}


class AssignChannelMessage extends Message {
    constructor(type: number) {
        super(0x42, [0x00, type, 0x00]);
    }
}


class SetChannelIdMessage extends Message {
    constructor(deviceType: number) {
        super(0x51, [0x00, 0x00, 0x00, deviceType, 0x00]);
    }
}


class SetChannelPeriodMessage extends Message {
    constructor(period: number) {
        const buffer = new ArrayBuffer(2);
        const view = new DataView(buffer);
        view.setUint16(0, period, true);
        super(0x43, [0x00, view.getUint8(0), view.getUint8(1)]);
    }
}


class SetChannelRfFrequencyMessage extends Message {
    constructor(frequency: number) {
        super(0x45, [0x00, frequency - 2400]);
    }
}


class OpenChannelMessage extends Message {
    constructor() {
        super(0x4b, [0x00]);
    }
}


class BushidoMessage extends Message {
    constructor(data: number[]) {
        super(0x4e, [0x00, ...data]);
    }
}


class BushidoResetHeadUnitMessage extends BushidoMessage {
    constructor() {
        super([0xac, 0x03, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]);
    }
}


class BushidoContinueMessage extends BushidoMessage {
    constructor() {
        super([0xac, 0x03, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00]);
    }
}


class BushidoStartCyclingMessage extends BushidoMessage {
    constructor() {
        super([0xac, 0x03, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00]);
    }
}


class BushidoInitPCConnectionMessage extends BushidoMessage {
    constructor() {
        super([0xac, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00]);
    }
}


class BushidoClosePCConnectionMessage extends BushidoMessage {
    constructor() {
        super([0xac, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    }
}


class BushidoDataMessage extends BushidoMessage {
    constructor(slope: number, weight: number) {
        const corrected_slope = Math.max(-50, Math.min(200, Math.round(slope * 10.0)));
        if (corrected_slope < 0) {
            super([0xdc, 0x01, 0x00, 0xff, 256 + corrected_slope, weight, 0x00, 0x00]);
        } else {
            super([0xdc, 0x01, 0x00, 0x00, corrected_slope, weight, 0x00, 0x00]);
        }
    }
}


export class BushidoData {
    public readonly speed: number = 0;
    public readonly cadence: number = 0;
    public readonly power: number = 0;
    public readonly distance: number = 0;
    public readonly break_temp: number = 0;
    public readonly heart_rate: number = 0;
    public slope: number = 0;
    public weight: number = 70;
}


interface QueuedMessage {
    message: Message,
    callback: () => void,
}


class BushidoHeadUnit {
    static BUTTON_LEFT: number = 0x01;
    static BUTTON_DOWN: number = 0x02;
    static BUTTON_OK: number = 0x03;
    static BUTTON_UP: number = 0x04;
    static BUTTON_RIGHT: number = 0x05;
}


export class BushidoUSB {
    private device: USBDevice;
    private data: BushidoData = new BushidoData();
    private is_paused: boolean = false;
    private out_queue: QueuedMessage[] = [];
    private log: Console = null;
    private connected: boolean = false;
    private last_button_code: number = -1;
    private last_button_timestamp: number = 0;

    public onPaused: () => void = null;
    public onResumed: () => void = null;
    public onDataUpdated: (updatedData: BushidoData) => void = null;
    public onDistanceUpdated: (updatedDistance: number) => void = null;
    public onSpeedUpdated: (updatedSpeed: number) => void = null;

    public onButtonLeft: () => void = null;
    public onButtonDown: () => void = null;
    public onButtonOK: () => void = null;
    public onButtonUp: () => void = null;
    public onButtonRight: () => void = null;

    constructor(log = null) {
        this.log = log;
    }

    public getData(): BushidoData {
        return this.data;
    }

    public setRiderWeight(weight: number): void {
        this.data.weight = weight;
    }

    public setSlope(slope: number): void {
        this.data.slope = slope;
    }

    public isPaused(): boolean {
        return this.is_paused;
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

    public async connectToHeadUnit(): Promise<void> {
        return new Promise((resolve) => {
            this.queueMessage(new BushidoInitPCConnectionMessage(), resolve);
        });
    }

    public async resetHeadUnit(): Promise<void> {
        return new Promise((resolve) => {
            this.queueMessage(new BushidoResetHeadUnitMessage(), resolve);
        });
    }

    public async startCyclingCourse(): Promise<void> {
        return new Promise(resolve => {
            this.queueMessage(new BushidoStartCyclingMessage(), resolve);
        });
    }

    public async disconnectFromHeadUnit(): Promise<void> {
        return new Promise(resolve => {
            this.queueMessage(new BushidoInitPCConnectionMessage());
            this.queueMessage(new BushidoClosePCConnectionMessage(), resolve);
        });
    }

    public async stop(): Promise<void> {
        await this.disconnectFromHeadUnit();
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

    private initializeANTConnection(): Promise<void> {
        this.queueMessage(new ResetMessage());
        this.queueMessage(new SetNetworkKeyMessage([0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,]));
        this.queueMessage(new AssignChannelMessage(0x00));
        this.queueMessage(new SetChannelIdMessage(0x52));
        this.queueMessage(new SetChannelPeriodMessage(4096));
        this.queueMessage(new SetChannelRfFrequencyMessage(2460));
        return new Promise((resolve) => this.queueMessage(new OpenChannelMessage(), () => {
            this.log_info("opened ANT+ connection");
            resolve();
        }));
    }
    
    private sendData(): void {
        this.queueMessage(new BushidoDataMessage(this.data.slope, this.data.weight));
        this.log_info("send data ...");
    }

    private continue(): void {
        this.queueMessage(new BushidoContinueMessage());
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
                    if (out_message instanceof BushidoMessage) {
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

        } while (!(out_message instanceof BushidoMessage));
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

    private processMessage(message: Message): void {
        const data = message.getContent();
        data.shift();
        if (data[0] === 0xdd) {
            if (data[1] === 0x01) {
                this.data = {
                    ...this.data,
                    speed: ((data[2] << 8) + data[3]) / 10.0,
                    power: (data[4] << 8) + data[5],
                    cadence: data[6],
                };
                this.log_info("received speed", this.data.speed, ", power", this.data.power, "and cadence", this.data.cadence);
                if (this.onDataUpdated) this.onDataUpdated(this.data);
                if (this.onSpeedUpdated) this.onSpeedUpdated(this.data.speed);
            } else if (data[1] === 0x02) {
                const old_distance = this.data.distance;
                this.data = {
                    ...this.data,
                    distance: (((data[2] << 24) + data[3] << 16) + data[4] << 8) + data[5],
                    heart_rate: data[6],
                }
                this.log_info("received distance", this.data.distance, "and heart rate", this.data.heart_rate);
                if (this.onDataUpdated) this.onDataUpdated(this.data);
                if (old_distance !== this.data.distance && this.onDistanceUpdated) this.onDistanceUpdated(this.data.distance);
            } else if (data[1] === 0x03) {
                this.data = {
                    ...this.data,
                    break_temp: data[4],
                };
                this.log_info("received break temp:", this.data.break_temp);
                if (this.onDataUpdated) this.onDataUpdated(this.data);
            } else if (data[1] === 0x10) {
                this.processButtonPress(data[2]);
            }
        } else if (data[0] === 0xad) {
            if (data[1] === 0x01 && data[2] === 0x02) {
                this.is_paused = false;
                if (this.onResumed) this.onResumed();
                this.log_info("sending slope of:", this.data.slope);
                this.sendData();
            } else if (data[1] === 0x01 && data[2] === 0x03) {
                this.is_paused = true;
                this.log_info("sending continue message ...");
                if (this.onPaused) this.onPaused();
                this.continue();
            }
        }
    }

    private processButtonPress(button_code: number): void {
        if (this.last_button_code !== button_code || Date.now() - this.last_button_timestamp > 1000) {
            switch (button_code) {
                case BushidoHeadUnit.BUTTON_LEFT:
                    this.log_info("< left button pressed.");
                    if (this.onButtonLeft) this.onButtonLeft();
                    break;
                case BushidoHeadUnit.BUTTON_DOWN:
                    this.log_info("v down button pressed.");
                    if (this.onButtonDown) this.onButtonDown();
                    break;
                case BushidoHeadUnit.BUTTON_OK:
                    this.log_info("x OK button pressed.");
                    if (this.onButtonOK) this.onButtonOK();
                    break;
                case BushidoHeadUnit.BUTTON_UP:
                    this.log_info("^ up button pressed.");
                    if (this.onButtonUp) this.onButtonUp();
                    break;
                case BushidoHeadUnit.BUTTON_RIGHT:
                    this.log_info("> right button pressed.");
                    if (this.onButtonRight) this.onButtonRight();
                    break;
                default:
                    this.log_info("unkown button was pressed.");
            }

            this.last_button_timestamp = Date.now();
            this.last_button_code = button_code;
        }
    }

    private queueMessage(message: Message, callback: () => void = null): void {
        this.out_queue.push({ message, callback });
    }

    private log_info(...msg: any[]): void {
        if (this.log) {
            this.log.info(...msg);
        }
    }
}
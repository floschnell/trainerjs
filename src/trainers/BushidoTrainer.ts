/**
 * Tacx Bushido (t1980) driver
 * Tested with the CYCPLUS Ant+ Dongle: https://www.cycplus.com/products/ant-usb-stick-u1
 * 
 * @author Florian Schnell
 */

import { UsbDriver } from '../ant/Driver';
import { BroadcastMessage, Message } from '../ant/Messages';
import { Node } from '../ant/Node';
import { BikeTrainer, BikeTrainerData } from '../BikeTrainer';
import { NetworkKeys, ChannelType } from "../ant/Network";


class BushidoResetHeadUnitMessage extends BroadcastMessage {
    constructor(channel_number: number = 0x00) {
        super([channel_number, 0xac, 0x03, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]);
    }
}


class BushidoContinueMessage extends BroadcastMessage {
    constructor(channel_number: number = 0x00) {
        super([channel_number, 0xac, 0x03, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00]);
    }
}


class BushidoStartCyclingMessage extends BroadcastMessage {
    constructor(channel_number: number = 0x00) {
        super([channel_number, 0xac, 0x03, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00]);
    }
}


class BushidoInitPCConnectionMessage extends BroadcastMessage {
    constructor(channel_number: number = 0x00) {
        super([channel_number, 0xac, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00]);
    }
}


class BushidoClosePCConnectionMessage extends BroadcastMessage {
    constructor(channel_number: number = 0x00) {
        super([channel_number, 0xac, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    }
}


class BushidoDataMessage extends BroadcastMessage {
    constructor(slope: number, weight: number, channel_number: number = 0x00) {
        const corrected_slope = Math.max(-50, Math.min(200, Math.round(slope * 10.0)));
        if (corrected_slope < 0) {
            super([channel_number, 0xdc, 0x01, 0x00, 0xff, 256 + corrected_slope, weight, 0x00, 0x00]);
        } else {
            super([channel_number, 0xdc, 0x01, 0x00, 0x00, corrected_slope, weight, 0x00, 0x00]);
        }
    }
}


export class BushidoData implements BikeTrainerData {
    public readonly speed: number = 0;
    public readonly cadence: number = 0;
    public readonly power: number = 0;
    public readonly distance: number = 0;
    public readonly break_temp: number = 0;
    public readonly heart_rate: number = 0;
    public slope: number = 0;
    public weight: number = 70;
}


class BushidoHeadUnit {
    static BUTTON_LEFT: number = 0x01;
    static BUTTON_UP: number = 0x02;
    static BUTTON_OK: number = 0x03;
    static BUTTON_DOWN: number = 0x04;
    static BUTTON_RIGHT: number = 0x05;
}


export class BushidoTrainer extends Node implements BikeTrainer {
    private data: BushidoData = new BushidoData();
    private is_paused: boolean = false;
    private last_button_code: number = -1;
    private last_button_timestamp: number = 0;
    private last_heart_rate: number = 0;

    public onPaused: () => void = null;
    public onResumed: () => void = null;
    public onDataUpdated: (updatedData: BushidoData) => void = null;
    public onDistanceUpdated: (updatedDistance: number) => void = null;

    public onButtonLeft: () => void = null;
    public onButtonDown: () => void = null;
    public onButtonOK: () => void = null;
    public onButtonUp: () => void = null;
    public onButtonRight: () => void = null;

    constructor(log = null) {
        super(new UsbDriver(), {
            networks: [
                {
                    key: NetworkKeys.AntPlusKey,
                    number: 1,
                },
            ],
            channels: [
                {
                    device_type: 0x78,
                    number: 1,
                    period: 8070,
                    rf_frequency: 57,
                    type: ChannelType.UNIDIRECTIONAL_RECEIVE,
                    network_number: 1,
                },
                {
                    device_type: 0x52,
                    number: 0,
                    period: 4096,
                    rf_frequency: 60,
                    type: ChannelType.BIDIRECTIONAL_RECEIVE,
                    network_number: 0,
                    wait_until_tracking: true,
                },
            ],
        }, log);
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

    public async startWorkout(): Promise<void> {
        await this.connectToHeadUnit();
        await this.resetHeadUnit();
        await this.startCyclingCourse();
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

    public async disconnect(): Promise<void> {
        await this.disconnectFromHeadUnit();
        super.disconnect();
    }
    
    private sendData(): void {
        this.queueMessage(new BushidoDataMessage(this.data.slope, this.data.weight));
        this.log_info("send data ...");
    }

    private continue(): void {
        this.queueMessage(new BushidoContinueMessage());
    }

    protected processMessage(message: Message): void {
        if (message instanceof BroadcastMessage) {
            switch (message.getChannelNumber()) {
                case 0:
                    return this.processBushidoMessage(message);
                case 1:
                    return this.processHeartRateMessage(message);
                default:
                    console.warn("received message on unknown channel:", message.getChannelNumber());
            }
        }
    }

    private processHeartRateMessage(message: BroadcastMessage) {
        this.last_heart_rate = message.getPayload()[7];
        console.log("computed HR:", this.last_heart_rate);
    }

    private processBushidoMessage(message: BroadcastMessage) {
        const data = message.getPayload();
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
            } else if (data[1] === 0x02) {
                const old_distance = this.data.distance;
                this.data = {
                    ...this.data,
                    distance: (((data[2] << 24) + data[3] << 16) + data[4] << 8) + data[5],
                    heart_rate: data[6] === 0 ? this.last_heart_rate : data[6],
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
                this.data = {
                    ...this.data,
                    power: 0,
                    cadence: 0,
                    speed: 0,
                };
                this.log_info("pause detected, sending continue message ...");
                if (this.onDataUpdated) this.onDataUpdated(this.data);
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
}
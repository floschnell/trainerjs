import { Driver } from "./Driver";
import { Message, ResetMessage, SetNetworkKeyMessage, AssignChannelMessage, SetChannelIdMessage, SetChannelRfFrequencyMessage, SetChannelPeriodMessage, OpenRxScanModeMessage, OpenChannelMessage, MessageChecksumError, BroadcastMessage, StartupMessage, ChannelEvent, EventCode, ExtendedAssignmentOptions, RequestMessage, ChannelStatusMessage, ChannelStatus } from "./Messages";
import { ChannelType, NetworkKey } from "./Network";


interface QueuedMessage {
    message: Message,
    callback: () => void,
}

export interface NodeConfig {
    reset?: boolean;
    networks: NetworkConfig[];
    channels: ChannelConfig[];
};


export interface NetworkConfig {
    key: NetworkKey;
    number: number;
}


export interface ChannelConfig {
    number: number;
    type: ChannelType;
    period: number;
    rf_frequency: number;
    scan?: boolean;
    device_type: number;
    network_number: number;
    assignment_options?: ExtendedAssignmentOptions;
}


export class DriverNotOpenError extends Error { };


export class NotConnectedError extends Error { };


export abstract class Node {
    protected configuration: NodeConfig;
    protected driver: Driver;
    private out_queue: QueuedMessage[] = [];
    private log: Console = null;
    private connected: boolean = false;

    constructor(driver: Driver, configuration: NodeConfig, log = null) {
        this.log = log;
        this.configuration = configuration;
        this.driver = driver;

        if (this.configuration.reset === undefined) {
            this.configuration.reset = true;
        }
    }

    public isConnected(): boolean {
        return this.driver.isOpen() && this.connected;
    }

    public async connect(): Promise<void> {
        if (!this.driver.isOpen()) {
            await this.driver.open();
        };

        await this.initializeANTConnection();
        this.connected = true;
        this.sendReceiveCycle();
    }

    public async disconnect(close_driver: boolean = false): Promise<void> {
        if (!this.connected) throw new NotConnectedError();

        if (close_driver) this.driver.close();

        this.out_queue.splice(0);
        this.connected = false;
    }

    private async sendReceiveCycle(): Promise<void> {
        if (this.connected) {
            if (this.out_queue.length > 0) {
                const {
                    message: out_message,
                    callback,
                } = this.out_queue.shift();
                await this.driver.sendMessage(out_message, callback);
            }

            try {
                const in_message = await this.driver.receiveMessage();
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

        if (this.configuration.reset) {
            await this.driver.sendMessage(new ResetMessage());
            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        for (const network_config of this.configuration.networks) {
            await this.driver.sendMessage(new SetNetworkKeyMessage(network_config.key, network_config.number));
        }

        for (const channel_config of this.configuration.channels) {
            this.log_info("opening channel", channel_config.number);
            await this.driver.sendMessage(new AssignChannelMessage(channel_config.type, channel_config.number, channel_config.network_number, channel_config.assignment_options));
            await this.driver.sendMessage(new SetChannelIdMessage(channel_config.device_type, channel_config.number));
            await this.driver.sendMessage(new SetChannelRfFrequencyMessage(channel_config.rf_frequency, channel_config.number));
            await this.driver.sendMessage(new SetChannelPeriodMessage(channel_config.period, channel_config.number));

            if (channel_config.scan === true) {
                await this.driver.sendMessage(new OpenRxScanModeMessage());
                this.log_info("openend channel", channel_config.number, "in scan mode");
            } else {
                await this.driver.sendMessage(new OpenChannelMessage(channel_config.number));
                this.log_info("openend channel", channel_config.number);
            }
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
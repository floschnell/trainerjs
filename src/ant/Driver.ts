import { BroadcastMessage, ChannelEvent, EventCode, Message, MessageChecksumError, StartupMessage } from "./Messages";

export interface Driver {
    sendMessage(message: Message, callback?: () => void): Promise<void>;
    receiveMessage(): Promise<Message>;
    open(): Promise<void>;
    close(): Promise<void>;
    isOpen(): boolean;
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


class NotConnectedError extends Error {};


class AlreadyConnectedError extends Error {};


export class UsbDriver implements Driver {
    private device: USBDevice;
    private connected: boolean;

    async open(): Promise<void> {
        if (this.connected) throw new AlreadyConnectedError();

        try {
            // @ts-ignore
            this.device = await navigator.usb.requestDevice({
                filters: [{
                    vendorId: 0x0FCF,
                    productId: 0x1008,
                }]
            });
    
            await this.device.open();
    
            await this.device.selectConfiguration(1);
    
            await this.device.claimInterface(0);

            this.connected = true;
        } catch (e) {
            this.connected = false;
        }
    }

    isOpen(): boolean {
        return this.connected;
    }

    async close(): Promise<void> {
        if (!this.connected) throw new NotConnectedError();

        await this.device.releaseInterface(0);
        await this.device.close();
        this.connected = false;
    }

    async sendMessage(out_message: Message, callback: () => void = null): Promise<void> {
        if (!this.connected) throw new NotConnectedError();

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

    async receiveMessage(): Promise<Message> {
        if (!this.connected) throw new NotConnectedError();

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
                if (channel_event.getEventCode() != EventCode.EVENT_TX &&
                    channel_event.getEventCode() != EventCode.RESPONSE_NO_ERROR) {
                    console.warn("received channel event with code", channel_event.getEventCodeAsString());
                }
                return channel_event;

            default:
                const message = new Message(id, content);
                console.warn("parsed message with unknown id", id, "and content", content);
                return message;
        }
    }
}
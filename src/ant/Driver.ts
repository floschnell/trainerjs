import { buildMessage, Message } from "./Messages";

export interface Driver {
    sendMessage(message: Message): Promise<void>;
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


class NotOpenError extends Error {};


class AlreadyOpenError extends Error {};


export class UsbDriver implements Driver {
    private device: USBDevice;
    private is_open: boolean;

    async open(): Promise<void> {
        if (this.is_open) throw new AlreadyOpenError();

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

            this.is_open = true;
        } catch (e) {
            this.is_open = false;
        }
    }

    isOpen(): boolean {
        return this.is_open;
    }

    async close(): Promise<void> {
        if (!this.is_open) throw new NotOpenError();

        await this.device.releaseInterface(0);
        await this.device.close();
        this.is_open = false;
    }

    async sendMessage(out_message: Message): Promise<void> {
        if (!this.is_open) throw new NotOpenError();

        const message_bytes = out_message.encode();
        await this.device.transferOut(1, message_bytes);
    }

    async receiveMessage(): Promise<Message> {
        if (!this.is_open) throw new NotOpenError();

        let in_message: Message = null;
        do {
            const in_byte = new DataView((await this.device.transferIn(1, 1)).data.buffer).getUint8(0);
            if (in_byte === Message.SYNC_BYTE) {
                const message_size = new DataView((await this.device.transferIn(1, 1)).data.buffer).getUint8(0);
                const message_body = new Uint8Array((await this.device.transferIn(1, message_size + 2)).data.buffer);
                const message_id = message_body[0];
                const message_content = [...message_body.slice(1, message_size + 1)];
                const message_checksum = message_body[message_size + 1];
                in_message = buildMessage(message_id, message_content, message_checksum);
            } else {
                console.warn("dropping byte:", in_byte);
            }
        } while (in_message === null);

        return in_message;
    }
}
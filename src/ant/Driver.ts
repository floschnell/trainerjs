import { buildMessage, Message } from "./Messages";

export interface Driver {
    sendMessage(message: Message): Promise<void>;
    receiveMessage(): Promise<Message>;
    open(): Promise<void>;
    close(): Promise<void>;
    isOpen(): boolean;
}



class NotOpenError extends Error {};


class AlreadyOpenError extends Error {};


export class UsbDriver implements Driver {
    private device: USBDevice;
    private is_open: boolean;
    private data: Array<number>;

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

    async receiveData(): Promise<void> {
        const result = await this.device.transferIn(1, 1024);
        this.data = [
            ...(this.data || []),
            ...new Uint8Array(result.data.buffer)
        ];
    }

    async receiveMessage(): Promise<Message> {
        if (!this.is_open) throw new NotOpenError();

        let in_message: Message = null;
        do {
            await this.receiveData();
            const in_byte = this.data.shift()
            if (in_byte === Message.SYNC_BYTE) {
                const message_size = this.data.shift();
                const message_id = this.data.shift();
                const message_content = this.data.splice(0, message_size);
                const message_checksum = this.data.shift();
                in_message = buildMessage(message_id, message_content, message_checksum);
            } else {
                console.warn("dropping byte:", in_byte);
            }
        } while (in_message === null);

        return in_message;
    }
}
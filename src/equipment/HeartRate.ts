import { Message, BroadcastMessage, RequestMessage, ChannelStatusMessage, ChannelStatus, ChannelIdMessage } from "../ant/Messages";
import { UsbDriver } from "../ant/Driver";
import { Node } from "../ant/Node";
import { NetworkKeys, ChannelType } from "../ant/Network";

export class HeartRateMonitor extends Node {
    constructor(console: Console = null) {
        super(new UsbDriver(), {
            networks: [{
                key: NetworkKeys.AntPlusKey,
                number: 0,
            }],
            channels: [{
                device_type: 0x78,
                number: 1,
                period: 8070,
                rf_frequency: 57,
                type: ChannelType.BIDIRECTIONAL_RECEIVE,
                network_number: 0,
            }]
        }, console);
    }

    async connect(): Promise<void> {
        await super.connect();

        this.queueMessage(new RequestMessage(1, ChannelIdMessage.ID, (msg: ChannelIdMessage) => {
            console.log("tracking channel ID:");
            console.log("device number:", msg.getDeviceNumber());
            console.log("device type:", msg.getDeviceTypeId());
            console.log("transmission type:", msg.getTransType());
        }));
    }

    processMessage(message: Message) {
        if (message instanceof BroadcastMessage) {
            const payload = message.getPayload();
            console.log("computed HR:", payload[7]);
        }
    }
}
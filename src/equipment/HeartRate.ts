import { Message, BroadcastMessage } from "../ant/Messages";
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
                number: 0x01,
                period: 8070,
                rf_frequency: 57,
                type: ChannelType.UNIDIRECTIONAL_RECEIVE,
                network_number: 0,
            }]
        }, console)
    }

    processMessage(message: Message) {
        if (message instanceof BroadcastMessage) {
            const payload = message.getPayload();
            console.log("computed HR:", payload[7]);
        }
    }
}
import { AntNode, BroadcastMessage, ChannelType, Message, NetworkKeys } from "../AntNode";

export class HeartRateMonitor extends AntNode {
    constructor(console: Console = null) {
        super({
            network_key: NetworkKeys.AntPlusKey,
            channels: [{
                device_type: 0x78,
                number: 0x01,
                period: 8070,
                rf_frequency: 57,
                type: ChannelType.UNIDIRECTIONAL_RECEIVE,
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
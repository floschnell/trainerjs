export declare type NetworkKey = [number, number, number, number, number, number, number, number];

export class NetworkKeys {
    static readonly DefaultKey: NetworkKey = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    static readonly AntPlusKey: NetworkKey = [0xb9, 0xa5, 0x21, 0xfb, 0xbd, 0x72, 0xc3, 0x45];
    static readonly PublicKey: NetworkKey = [0xe8, 0xe4, 0x21, 0x3b, 0x55, 0x7a, 0x67, 0xc1];
}

export enum ChannelType {
    BIDIRECTIONAL_RECEIVE = 0x00,
    BIDIRECTIONAL_TRANSMIT = 0x10,
    SHARED_BIDIRECTIONAL_RECEIVE = 0x20,
    SHARED_BIDIRECTIONAL_TRANSMIT = 0x30,
    UNIDIRECTIONAL_RECEIVE = 0x40,
    UNIDIRECTIONAL_TRANSMIT = 0x50,
}

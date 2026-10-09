/**
 * CrossTalk Binary Bitstream Protocol (Wire Format)
 *
 * Frame Layout:
 * [0]     Magic: 0x58 ('X')
 * [1]     Version: 0x01
 * [2]     Opcode (1 byte)
 * [3]     Flags (1 byte): bit0=ackRequested, bit1=isResponse, bit2=conflictAlert
 * [4..7]  Timestamp (4-byte uint32, seconds since epoch)
 * [8..9]  Payload Length (2-byte uint16)
 * [10..N] Payload (UTF-8 bytes or structured binary payload)
 */
export declare enum BinaryOpcode {
    HEARTBEAT = 0,
    REGISTER = 1,
    BROADCAST = 2,
    DIRECT_MSG = 3,
    LOCK_ACQUIRE = 4,
    LOCK_ACK = 5,
    LOCK_DENIED = 6,
    LOCK_RELEASE = 7,
    STATE_QUERY = 8,
    GIBBERLINK_CARRIER = 9
}
export interface BinaryFrame {
    opcode: BinaryOpcode;
    flags: {
        ackRequested?: boolean;
        isResponse?: boolean;
        conflictAlert?: boolean;
    };
    timestamp: number;
    payload: string | object;
}
export declare class BinaryCodec {
    private static MAGIC;
    private static VERSION;
    static encode(frame: BinaryFrame): Buffer;
    static decode(buf: Buffer): BinaryFrame | null;
}

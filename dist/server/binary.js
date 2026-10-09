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
export var BinaryOpcode;
(function (BinaryOpcode) {
    BinaryOpcode[BinaryOpcode["HEARTBEAT"] = 0] = "HEARTBEAT";
    BinaryOpcode[BinaryOpcode["REGISTER"] = 1] = "REGISTER";
    BinaryOpcode[BinaryOpcode["BROADCAST"] = 2] = "BROADCAST";
    BinaryOpcode[BinaryOpcode["DIRECT_MSG"] = 3] = "DIRECT_MSG";
    BinaryOpcode[BinaryOpcode["LOCK_ACQUIRE"] = 4] = "LOCK_ACQUIRE";
    BinaryOpcode[BinaryOpcode["LOCK_ACK"] = 5] = "LOCK_ACK";
    BinaryOpcode[BinaryOpcode["LOCK_DENIED"] = 6] = "LOCK_DENIED";
    BinaryOpcode[BinaryOpcode["LOCK_RELEASE"] = 7] = "LOCK_RELEASE";
    BinaryOpcode[BinaryOpcode["STATE_QUERY"] = 8] = "STATE_QUERY";
    BinaryOpcode[BinaryOpcode["GIBBERLINK_CARRIER"] = 9] = "GIBBERLINK_CARRIER";
})(BinaryOpcode || (BinaryOpcode = {}));
export class BinaryCodec {
    static MAGIC = 0x58;
    static VERSION = 0x01;
    static encode(frame) {
        let flagsByte = 0;
        if (frame.flags.ackRequested)
            flagsByte |= 1 << 0;
        if (frame.flags.isResponse)
            flagsByte |= 1 << 1;
        if (frame.flags.conflictAlert)
            flagsByte |= 1 << 2;
        const payloadStr = typeof frame.payload === 'string'
            ? frame.payload
            : JSON.stringify(frame.payload);
        const payloadBuf = Buffer.from(payloadStr, 'utf8');
        // Header: 10 bytes
        const totalLength = 10 + payloadBuf.length;
        const buf = Buffer.alloc(totalLength);
        buf.writeUInt8(this.MAGIC, 0);
        buf.writeUInt8(this.VERSION, 1);
        buf.writeUInt8(frame.opcode, 2);
        buf.writeUInt8(flagsByte, 3);
        // Seconds timestamp
        const sec = Math.floor((frame.timestamp || Date.now()) / 1000);
        buf.writeUInt32BE(sec, 4);
        // Payload length
        buf.writeUInt16BE(payloadBuf.length, 8);
        // Write payload
        payloadBuf.copy(buf, 10);
        return buf;
    }
    static decode(buf) {
        if (buf.length < 10)
            return null;
        if (buf.readUInt8(0) !== this.MAGIC || buf.readUInt8(1) !== this.VERSION) {
            return null;
        }
        const opcode = buf.readUInt8(2);
        const flagsByte = buf.readUInt8(3);
        const sec = buf.readUInt32BE(4);
        const payloadLen = buf.readUInt16BE(8);
        if (buf.length < 10 + payloadLen)
            return null;
        const payloadStr = buf.subarray(10, 10 + payloadLen).toString('utf8');
        let payload = payloadStr;
        try {
            payload = JSON.parse(payloadStr);
        }
        catch { }
        return {
            opcode,
            flags: {
                ackRequested: (flagsByte & (1 << 0)) !== 0,
                isResponse: (flagsByte & (1 << 1)) !== 0,
                conflictAlert: (flagsByte & (1 << 2)) !== 0
            },
            timestamp: sec * 1000,
            payload
        };
    }
}

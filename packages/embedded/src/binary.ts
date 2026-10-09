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
 * [10..N] Payload: raw bytes (e.g. DialectEngine.packToBits), UTF-8 text, or JSON
 */

export enum BinaryOpcode {
  HEARTBEAT = 0x00,
  REGISTER = 0x01,
  BROADCAST = 0x02,
  DIRECT_MSG = 0x03,
  LOCK_ACQUIRE = 0x04,
  LOCK_ACK = 0x05,
  LOCK_DENIED = 0x06,
  LOCK_RELEASE = 0x07,
  STATE_QUERY = 0x08,
  GIBBERLINK_CARRIER = 0x09
}

export interface BinaryFrame {
  opcode: BinaryOpcode;
  flags: {
    ackRequested?: boolean;
    isResponse?: boolean;
    conflictAlert?: boolean;
  };
  timestamp: number;
  /**
   * Encoding: a Buffer is sent as-is, a string as UTF-8, anything else as JSON.
   * Decoding: JSON if the bytes parse as JSON, else the UTF-8 string if the
   * bytes are valid UTF-8, else the raw Buffer.
   */
  payload: string | object | Buffer;
  /** Set by decode: the exact payload bytes, whatever `payload` became. */
  raw?: Buffer;
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

export class BinaryCodec {
  private static MAGIC = 0x58;
  private static VERSION = 0x01;

  public static encode(frame: BinaryFrame): Buffer {
    let flagsByte = 0;
    if (frame.flags.ackRequested) flagsByte |= 1 << 0;
    if (frame.flags.isResponse) flagsByte |= 1 << 1;
    if (frame.flags.conflictAlert) flagsByte |= 1 << 2;

    const payloadBuf = Buffer.isBuffer(frame.payload)
      ? frame.payload
      : Buffer.from(typeof frame.payload === 'string' ? frame.payload : JSON.stringify(frame.payload), 'utf8');
    if (payloadBuf.length > 0xffff) {
      throw new RangeError(`Payload is ${payloadBuf.length} bytes; the frame length field holds at most 65535`);
    }

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

  public static decode(buf: Buffer): BinaryFrame | null {
    if (buf.length < 10) return null;
    if (buf.readUInt8(0) !== this.MAGIC || buf.readUInt8(1) !== this.VERSION) {
      return null;
    }

    const opcode = buf.readUInt8(2) as BinaryOpcode;
    const flagsByte = buf.readUInt8(3);
    const sec = buf.readUInt32BE(4);
    const payloadLen = buf.readUInt16BE(8);

    if (buf.length < 10 + payloadLen) return null;

    const raw = Buffer.from(buf.subarray(10, 10 + payloadLen));
    let payload: string | object | Buffer = raw;
    try {
      payload = strictUtf8.decode(raw);
      try {
        payload = JSON.parse(payload);
      } catch {}
    } catch {}

    return {
      opcode,
      flags: {
        ackRequested: (flagsByte & (1 << 0)) !== 0,
        isResponse: (flagsByte & (1 << 1)) !== 0,
        conflictAlert: (flagsByte & (1 << 2)) !== 0
      },
      timestamp: sec * 1000,
      payload,
      raw
    };
  }
}

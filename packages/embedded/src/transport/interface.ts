/**
 * Universal Transport Abstraction for CrossTalk
 * 
 * Allows CrossTalk to run over any communications channel:
 * - WebSocket (TCP / LAN / Internet)
 * - Unix Domain Sockets / IPC (Local machine zero-network pipe)
 * - Raw Stream / Serial / UART / Bluetooth SPP
 * - Stdio pipes
 */

export interface TransportEvents {
  message: (data: Buffer | string) => void;
  open: () => void;
  close: () => void;
  error: (err: Error) => void;
}

export interface ICrossTalkTransport {
  readonly isConnected: boolean;
  send(data: Buffer | string): void;
  on(event: 'message', cb: (data: Buffer | string) => void): void;
  on(event: 'open', cb: () => void): void;
  on(event: 'close', cb: () => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  close(): void;
}

/**
 * Length-prefix stream framer for raw byte streams (Bluetooth, Serial/UART, Unix Sockets)
 * Frames layout: [2 bytes uint16 payload length][payload bytes]
 */
export class StreamFramer {
  public static frame(payload: Buffer): Buffer {
    const len = payload.length;
    const header = Buffer.alloc(2);
    header.writeUInt16BE(len, 0);
    return Buffer.concat([header, payload]);
  }

  public static unframe(
    bufferQueue: Buffer,
    onPacket: (packet: Buffer) => void
  ): Buffer {
    let remaining = bufferQueue;
    while (remaining.length >= 2) {
      const packetLen = remaining.readUInt16BE(0);
      if (remaining.length < 2 + packetLen) {
        // Incomplete packet in buffer, wait for more data
        break;
      }
      const packet = remaining.subarray(2, 2 + packetLen);
      remaining = remaining.subarray(2 + packetLen);
      onPacket(packet);
    }
    return remaining;
  }
}

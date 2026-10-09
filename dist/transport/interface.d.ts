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
export declare class StreamFramer {
    static frame(payload: Buffer): Buffer;
    static unframe(bufferQueue: Buffer, onPacket: (packet: Buffer) => void): Buffer;
}

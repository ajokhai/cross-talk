import net from 'node:net';
import EventEmitter from 'node:events';
import { ICrossTalkTransport } from './interface.js';
export declare class UnixSocketTransport extends EventEmitter implements ICrossTalkTransport {
    private socket;
    private readBuffer;
    private connected;
    constructor(socketPathOrSocket: string | net.Socket);
    get isConnected(): boolean;
    send(data: Buffer | string): void;
    close(): void;
}

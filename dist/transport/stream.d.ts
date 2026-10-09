import { Duplex } from 'node:stream';
import EventEmitter from 'node:events';
import { ICrossTalkTransport } from './interface.js';
export declare class StreamTransport extends EventEmitter implements ICrossTalkTransport {
    private stream;
    private readBuffer;
    private connected;
    constructor(stream: Duplex);
    get isConnected(): boolean;
    send(data: Buffer | string): void;
    close(): void;
}

import EventEmitter from 'node:events';
import { StreamFramer } from './interface.js';
export class StreamTransport extends EventEmitter {
    stream;
    readBuffer = Buffer.alloc(0);
    connected = true;
    constructor(stream) {
        super();
        this.stream = stream;
        this.stream.on('data', (chunk) => {
            this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
            this.readBuffer = StreamFramer.unframe(this.readBuffer, (packet) => {
                this.emit('message', packet);
            });
        });
        this.stream.on('close', () => {
            this.connected = false;
            this.emit('close');
        });
        this.stream.on('end', () => {
            this.connected = false;
            this.emit('close');
        });
        this.stream.on('error', (err) => {
            this.emit('error', err);
        });
        process.nextTick(() => {
            this.emit('open');
        });
    }
    get isConnected() {
        return this.connected;
    }
    send(data) {
        if (!this.connected)
            return;
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
        const framed = StreamFramer.frame(buf);
        this.stream.write(framed);
    }
    close() {
        this.stream.end();
        this.connected = false;
    }
}

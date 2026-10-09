import net from 'node:net';
import EventEmitter from 'node:events';
import { StreamFramer } from './interface.js';
export class UnixSocketTransport extends EventEmitter {
    socket;
    readBuffer = Buffer.alloc(0);
    connected = false;
    constructor(socketPathOrSocket) {
        super();
        if (typeof socketPathOrSocket === 'string') {
            this.socket = net.createConnection(socketPathOrSocket);
            this.socket.on('connect', () => {
                this.connected = true;
                this.emit('open');
            });
        }
        else {
            this.socket = socketPathOrSocket;
            this.connected = true;
        }
        this.socket.on('data', (chunk) => {
            this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
            this.readBuffer = StreamFramer.unframe(this.readBuffer, (packet) => {
                this.emit('message', packet);
            });
        });
        this.socket.on('close', () => {
            this.connected = false;
            this.emit('close');
        });
        this.socket.on('error', (err) => {
            this.emit('error', err);
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
        this.socket.write(framed);
    }
    close() {
        this.socket.end();
        this.connected = false;
    }
}

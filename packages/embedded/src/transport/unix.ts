import net from 'node:net';
import EventEmitter from 'node:events';
import { ICrossTalkTransport, StreamFramer } from './interface.js';

export class UnixSocketTransport extends EventEmitter implements ICrossTalkTransport {
  private socket: net.Socket;
  private readBuffer: Buffer = Buffer.alloc(0);
  private connected = false;

  constructor(socketPathOrSocket: string | net.Socket) {
    super();

    if (typeof socketPathOrSocket === 'string') {
      this.socket = net.createConnection(socketPathOrSocket);
      this.socket.on('connect', () => {
        this.connected = true;
        this.emit('open');
      });
    } else {
      this.socket = socketPathOrSocket;
      this.connected = true;
    }

    this.socket.on('data', (chunk: Buffer) => {
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

  public get isConnected(): boolean {
    return this.connected;
  }

  public send(data: Buffer | string): void {
    if (!this.connected) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const framed = StreamFramer.frame(buf);
    this.socket.write(framed);
  }

  public close(): void {
    this.socket.end();
    this.connected = false;
  }
}

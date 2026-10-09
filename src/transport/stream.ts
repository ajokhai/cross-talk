import { Duplex } from 'node:stream';
import EventEmitter from 'node:events';
import { ICrossTalkTransport, StreamFramer } from './interface.js';

export class StreamTransport extends EventEmitter implements ICrossTalkTransport {
  private stream: Duplex;
  private readBuffer: Buffer = Buffer.alloc(0);
  private connected = true;

  constructor(stream: Duplex) {
    super();
    this.stream = stream;

    this.stream.on('data', (chunk: Buffer) => {
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

  public get isConnected(): boolean {
    return this.connected;
  }

  public send(data: Buffer | string): void {
    if (!this.connected) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const framed = StreamFramer.frame(buf);
    this.stream.write(framed);
  }

  public close(): void {
    this.stream.end();
    this.connected = false;
  }
}

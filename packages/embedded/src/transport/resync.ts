import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import type { ICrossTalkTransport } from './interface.js';

const MAGIC = 0x58;

/**
 * Length-prefixed framing (u16 BE + frame) that survives line noise: a prefix
 * that is too small or not followed by the frame magic is skipped one byte at
 * a time until the stream lines up again. A well-formed frame larger than
 * `maxFrameBytes` is discarded whole, so its payload is never misread as
 * frames. Emits 'close' once.
 */
export class ResyncingLink extends EventEmitter implements ICrossTalkTransport {
  private buffer: Buffer = Buffer.alloc(0);
  private open = true;
  /** Bytes left of an oversized frame being discarded. */
  private skip = 0;

  constructor(private readonly stream: Duplex, private readonly maxFrameBytes = 128) {
    super();
    stream.on('data', (chunk: Buffer) => this.ingest(chunk));
    stream.on('error', err => this.emit('error', err));
    stream.on('end', () => this.shut());
    stream.on('close', () => this.shut());
  }

  get isConnected(): boolean {
    return this.open;
  }

  private ingest(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      if (this.skip) {
        const n = Math.min(this.skip, this.buffer.length);
        this.buffer = this.buffer.subarray(n);
        this.skip -= n;
        if (this.skip) break;
      }
      if (this.buffer.length < 3) break;
      const len = this.buffer.readUInt16BE(0);
      if (len < 10 || this.buffer[2] !== MAGIC) {
        this.buffer = this.buffer.subarray(1); // resync
        continue;
      }
      if (len > this.maxFrameBytes) {
        this.skip = 2 + len;
        continue;
      }
      if (this.buffer.length < 2 + len) break;
      const frame = Buffer.from(this.buffer.subarray(2, 2 + len));
      this.buffer = this.buffer.subarray(2 + len);
      this.emit('message', frame);
    }
  }

  send(data: Buffer | string): void {
    if (!this.open) return;
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const prefix = Buffer.alloc(2);
    prefix.writeUInt16BE(payload.length, 0);
    this.stream.write(Buffer.concat([prefix, payload]));
  }

  close(): void {
    this.stream.end();
    this.shut();
  }

  private shut(): void {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }
}

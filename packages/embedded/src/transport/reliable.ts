import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import type { ICrossTalkTransport } from './interface.js';

/**
 * A reliable link over a lossy byte stream: a radio module in transparent
 * serial mode (LoRa, HC-12, XBee), a noisy UART, Bluetooth serial, anything
 * that carries bytes but may drop, corrupt or delay them.
 *
 * Carries whole messages (here, CrossTalk device frames) of any size up to
 * 64 KiB. Each message is split into packets of at most `mtu` payload bytes:
 *
 *   [0xC7 0x5A sync][type][session][msg id][index][count][len][payload…][CRC-16 BE]
 *
 * type 1 = DATA, 2 = ACK (no payload; acknowledges session + msg id + index).
 * `session` is random per link, so a restarted sender's ids aren't mistaken
 * for duplicates.
 * CRC-16/CCITT-FALSE covers type through payload. Bad packets are dropped and
 * the reader resyncs on the next sync word.
 *
 * Stop-and-wait: one packet in flight, retried until acknowledged, which
 * suits half-duplex radios. Duplicates are acknowledged again but delivered
 * once. With `dutyCycle` < 1, transmissions are spaced so the link's
 * estimated airtime stays under that share (e.g. 0.01 for EU 868 MHz LoRa).
 *
 * Both ends must use a ReliableLink with the same `mtu` or larger.
 */

export interface ReliableLinkOptions {
  /** Payload bytes per packet. Default 64 (fits the smallest common LoRa settings with room for the header). */
  mtu?: number;
  /** How long to wait for an ACK before resending. Default 1500 ms. */
  ackTimeoutMs?: number;
  /** Resends per packet before the message is given up as lost. Default 6. */
  retries?: number;
  /** Link speed in bits per second, used to estimate airtime for `dutyCycle`. Default 9600. */
  bitrate?: number;
  /** Largest share of time spent transmitting (0 < d ≤ 1). Default 1 (no limit). */
  dutyCycle?: number;
}

const SYNC0 = 0xc7;
const SYNC1 = 0x5a;
const DATA = 1;
const ACK = 2;
const HEADER = 8; // sync(2) type session id index count len
const MAX_MESSAGE = 65_535;

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF). */
export function crc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function packet(type: number, session: number, id: number, index: number, count: number, payload: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from([type, session, id, index, count, payload.length]), payload]);
  const out = Buffer.alloc(2 + body.length + 2);
  out[0] = SYNC0;
  out[1] = SYNC1;
  body.copy(out, 2);
  out.writeUInt16BE(crc16(body), 2 + body.length);
  return out;
}

interface Outgoing {
  id: number;
  parts: Buffer[];
  index: number;
  tries: number;
}

export class ReliableLink extends EventEmitter implements ICrossTalkTransport {
  private readonly mtu: number;
  private readonly ackTimeoutMs: number;
  private readonly retries: number;
  private readonly bitrate: number;
  private readonly dutyCycle: number;

  private rx: Buffer = Buffer.alloc(0);
  private queue: Outgoing[] = [];
  private current?: Outgoing;
  private timer?: NodeJS.Timeout;
  private nextId = 0;
  private readonly session = Math.floor(Math.random() * 256);
  private quietUntil = 0;
  private connected = true;
  /** Partial messages by id. */
  private readonly assembling = new Map<number, { count: number; parts: (Buffer | undefined)[]; got: number }>();
  /** Recently completed message ids, so retransmissions aren't delivered twice. */
  private readonly done: number[] = [];

  constructor(private readonly stream: Duplex, options: ReliableLinkOptions = {}) {
    super();
    this.mtu = Math.max(8, Math.min(options.mtu ?? 64, 255));
    this.ackTimeoutMs = options.ackTimeoutMs ?? 1500;
    this.retries = options.retries ?? 6;
    this.bitrate = options.bitrate ?? 9600;
    this.dutyCycle = Math.min(1, Math.max(0.0001, options.dutyCycle ?? 1));
    stream.on('data', (chunk: Buffer) => this.ingest(chunk));
    stream.on('close', () => this.shutdown());
    stream.on('error', err => this.emit('error', err));
    queueMicrotask(() => this.emit('open'));
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Queues one message; it is delivered whole on the other side, or reported lost via 'error'. */
  send(data: Buffer | string): void {
    if (!this.connected) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    if (buf.length > MAX_MESSAGE) {
      this.emit('error', new Error(`message of ${buf.length} bytes is over the ${MAX_MESSAGE}-byte limit`));
      return;
    }
    const parts: Buffer[] = [];
    for (let i = 0; i < Math.max(1, buf.length); i += this.mtu) parts.push(buf.subarray(i, i + this.mtu));
    if (parts.length > 255) {
      this.emit('error', new Error(`message needs ${parts.length} packets; raise mtu (max 255 packets per message)`));
      return;
    }
    this.queue.push({ id: this.nextId, parts, index: 0, tries: 0 });
    this.nextId = (this.nextId + 1) & 0xff;
    this.pump();
  }

  close(): void {
    this.shutdown();
    this.stream.destroy();
  }

  private shutdown(): void {
    if (!this.connected) return;
    this.connected = false;
    clearTimeout(this.timer);
    this.queue = [];
    this.current = undefined;
    this.emit('close');
  }

  // -- sending ---------------------------------------------------------------

  private pump(): void {
    if (this.current || !this.connected) return;
    this.current = this.queue.shift();
    if (this.current) this.transmitCurrent();
  }

  private transmitCurrent(): void {
    const out = this.current;
    if (!out || !this.connected) return;
    const wait = this.quietUntil - Date.now();
    if (wait > 0) {
      this.timer = setTimeout(() => this.transmitCurrent(), wait);
      return;
    }
    if (out.tries > this.retries) {
      this.emit('error', new Error(`message ${out.id} lost after ${this.retries} resends of packet ${out.index + 1}/${out.parts.length}`));
      this.current = undefined;
      this.pump();
      return;
    }
    out.tries++;
    this.write(packet(DATA, this.session, out.id, out.index, out.parts.length, out.parts[out.index]));
    this.timer = setTimeout(() => this.transmitCurrent(), this.ackTimeoutMs);
  }

  private write(bytes: Buffer): void {
    // Airtime estimate, then the quiet time that keeps the duty cycle.
    const airtimeMs = (bytes.length * 10 * 1000) / this.bitrate; // ~10 bits per byte on a UART-fed radio
    this.quietUntil = Date.now() + airtimeMs + (this.dutyCycle < 1 ? airtimeMs * (1 / this.dutyCycle - 1) : 0);
    this.stream.write(bytes);
  }

  private acked(session: number, id: number, index: number): void {
    const out = this.current;
    if (!out || session !== this.session || out.id !== id || out.index !== index) return; // stale or duplicate ACK
    clearTimeout(this.timer);
    out.index++;
    out.tries = 0;
    if (out.index >= out.parts.length) {
      this.current = undefined;
      this.pump();
    } else {
      this.transmitCurrent();
    }
  }

  // -- receiving -------------------------------------------------------------

  private ingest(chunk: Buffer): void {
    this.rx = this.rx.length ? Buffer.concat([this.rx, chunk]) : chunk;
    for (;;) {
      const start = this.findSync();
      if (start < 0) {
        // Keep a trailing first sync byte in case the second is in the next chunk.
        this.rx = this.rx.length && this.rx[this.rx.length - 1] === SYNC0 ? this.rx.subarray(this.rx.length - 1) : Buffer.alloc(0);
        return;
      }
      if (start > 0) this.rx = this.rx.subarray(start);
      if (this.rx.length < HEADER) return;
      const len = this.rx[7];
      if (len > this.mtu) {
        this.rx = this.rx.subarray(1); // can't be ours: resync
        continue;
      }
      const total = HEADER + len + 2;
      if (this.rx.length < total) return;
      const body = this.rx.subarray(2, HEADER + len);
      const ok = crc16(body) === this.rx.readUInt16BE(HEADER + len);
      if (!ok) {
        this.rx = this.rx.subarray(1);
        continue;
      }
      const [type, session, id, index, count] = body;
      const payload = Buffer.from(body.subarray(6));
      this.rx = this.rx.subarray(total);
      if (type === ACK) this.acked(session, id, index);
      else if (type === DATA) this.onData(session, id, index, count, payload);
    }
  }

  private findSync(): number {
    for (let i = 0; i + 1 < this.rx.length; i++) if (this.rx[i] === SYNC0 && this.rx[i + 1] === SYNC1) return i;
    return -1;
  }

  private onData(session: number, id: number, index: number, count: number, payload: Buffer): void {
    if (count === 0 || index >= count) return;
    // Always acknowledge, so a sender whose ACK was lost moves on.
    this.write(packet(ACK, session, id, index, count, Buffer.alloc(0)));
    const key = (session << 8) | id;
    if (this.done.includes(key)) return;
    let msg = this.assembling.get(key);
    if (!msg || msg.count !== count) {
      msg = { count, parts: new Array(count), got: 0 };
      this.assembling.set(key, msg);
      if (this.assembling.size > 16) this.assembling.delete(this.assembling.keys().next().value!);
    }
    if (!msg.parts[index]) {
      msg.parts[index] = payload;
      msg.got++;
    }
    if (msg.got < count) return;
    this.assembling.delete(key);
    this.done.push(key);
    if (this.done.length > 64) this.done.shift();
    this.emit('message', Buffer.concat(msg.parts as Buffer[]));
  }
}

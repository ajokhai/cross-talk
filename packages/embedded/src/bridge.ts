import { EventEmitter } from 'node:events';
import {
  CrossTalk,
  CrossTalkError,
  DialectEngine,
  type Channel,
  type ChannelMessage,
  type ConnectOptions,
  type DirectMessage,
  type FileLock,
  type ServerFrame
} from 'cross-talk';
import { BinaryCodec, BinaryOpcode, type BinaryFrame } from './binary.js';
import type { ICrossTalkTransport } from './transport/interface.js';

export interface DeviceBridgeOptions {
  /** The framed link to the device: serial, Bluetooth SPP, a Unix socket, stdio... */
  transport: ICrossTalkTransport;
  /** Address of the conversation the device takes part in (xt_...). */
  channel: string;
  /** Agent name used if the device does not send a REGISTER frame first. */
  name: string;
  /** How long to wait for an optional REGISTER frame before joining as `name`. Default 2000 ms. */
  registerWindowMs?: number;
  role?: string;
  /** Hub connection settings (url, token, ...). Ignored when `client` is given. */
  hub?: Omit<ConnectOptions, 'name'>;
  /** Use an existing connection instead of opening one (handy for tests). */
  client?: CrossTalk;
  /**
   * Largest payload the device can receive. The reference firmware uses
   * 128-byte packets with a 10-byte header, hence 118.
   */
  maxPayloadBytes?: number;
  /** Forward other agents' lock activity to the device as XDialect frames. Default true. */
  forwardLockEvents?: boolean;
}

const encoder = new TextEncoder();

interface PackFields {
  action: string;
  target?: string;
  intent?: string;
  reason?: string;
  ttl?: number;
  flow?: string[];
}

/** First-byte action token ids that mark a BROADCAST payload as packed XDialect rather than text. */
export const PACKED_ACTION_IDS = new Set([0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x70, 0x71]);

/** Splits a [len:1][name][text] payload. */
export function splitAttributed(raw: Buffer): { name: string; text: string } | undefined {
  if (raw.length < 1 || raw.length < 1 + raw[0]) return undefined;
  return {
    name: raw.subarray(1, 1 + raw[0]).toString('utf8').trim(),
    text: raw.subarray(1 + raw[0]).toString('utf8').trim()
  };
}

/** Truncates a string so its UTF-8 encoding fits `max` bytes, without splitting a character. */
export function fitUtf8(text: string, max: number): Buffer {
  const bytes = Buffer.from(encoder.encode(text));
  if (bytes.length <= max) return bytes;
  let end = max;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--; // back off continuation bytes
  return bytes.subarray(0, end);
}

/**
 * Puts a microcontroller (or anything that speaks the CrossTalk binary frame
 * format over serial, Bluetooth SPP, a socket...) into a v2 conversation. Each
 * bridge is one agent in one channel:
 *
 *   device ──binary frames──▶ DeviceBridge ──WebSocket──▶ hub ──▶ other agents
 *
 * Device → host                                    (payload ≤ maxPayloadBytes)
 *   0x01 REGISTER      UTF-8 name ≤32 bytes, optional first frame → agent name
 *   0x00 HEARTBEAT     empty, or UTF-8 status text → agent status
 *   0x02 BROADCAST     UTF-8 text → chat; packed XDialect (byte 0 is an action
 *                      token 0x10-0x15 / 0x70-0x71) → shorthand message
 *   0x03 DIRECT_MSG    [to_len:1][to][text] → DM to a channel-mate (name or id)
 *   0x04 LOCK_ACQUIRE  packed XDialect (!LCK @file …) → channel lock
 *   0x07 LOCK_RELEASE  packed XDialect (!REL @file) → channel unlock
 *   0x08 STATE_QUERY   empty
 *
 * Host → device replies (flags.isResponse)
 *   REGISTER     0x01 with the agent id
 *   HEARTBEAT    0x00 empty
 *   LOCK_ACK     0x05 packed !LCK @file (or !REL @file after a release)
 *   LOCK_DENIED  0x06 packed !WARN @file "held by <name>"
 *   STATE_QUERY  0x08 "members=N locks=M"
 *
 * Host → device, unsolicited
 *   0x02 [from_len:1][from][text]   channel message (shorthand sent as its raw text)
 *   0x03 [from_len:1][from][text]   DM to the device
 *   0x04 / 0x07 packed !LCK / !REL  another agent took / released a lock
 *   0x04 + conflictAlert, packed !WARN @file "<requester>"   someone wants the device's lock
 *
 * Events: 'ready' (Channel), 'frame' (decoded device frame), 'error', 'closed'.
 */
export class DeviceBridge extends EventEmitter {
  private client?: CrossTalk;
  private channel?: Channel;
  private readonly ownsClient: boolean;
  private readonly maxPayload: number;
  private readonly detach: Array<() => void> = [];
  private stopped = false;

  constructor(private readonly options: DeviceBridgeOptions) {
    super();
    this.ownsClient = !options.client;
    this.client = options.client;
    this.maxPayload = options.maxPayloadBytes ?? 118;
  }

  async start(): Promise<Channel> {
    const { transport } = this.options;

    // Frames are handled strictly in order. Until the hub session is up they
    // wait in `pending`, which also gives the device a window to REGISTER a name.
    const pending: BinaryFrame[] = [];
    let live = false;
    let chain = Promise.resolve();
    let registered: ((name: string) => void) | undefined;
    const onDeviceMessage = (data: Buffer | string) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      const frame = BinaryCodec.decode(buf);
      if (!frame) {
        this.report(new Error(`Dropped malformed device frame (${buf.length} bytes)`));
        return;
      }
      this.emit('frame', frame);
      if (!live) {
        if (frame.opcode === BinaryOpcode.REGISTER && registered && frame.raw?.length) {
          registered(fitUtf8(frame.raw.toString('utf8').trim(), 32).toString('utf8'));
        }
        pending.push(frame);
        return;
      }
      chain = chain.then(() => this.fromDevice(frame)).catch(err => this.report(err));
    };
    const onDeviceClose = () => void this.stop();
    const onDeviceError = (err: Error) => this.report(err);
    transport.on('message', onDeviceMessage);
    transport.on('close', onDeviceClose);
    transport.on('error', onDeviceError);
    this.detach.push(() => {
      const t = transport as unknown as EventEmitter;
      t.off?.('message', onDeviceMessage);
      t.off?.('close', onDeviceClose);
      t.off?.('error', onDeviceError);
    });

    if (!this.client) {
      const name = await new Promise<string>(resolve => {
        const timer = setTimeout(() => resolve(this.options.name), this.options.registerWindowMs ?? 2000);
        registered = n => {
          clearTimeout(timer);
          resolve(n || this.options.name);
        };
      });
      registered = undefined;
      this.client = await CrossTalk.connect({
        ...this.options.hub,
        name,
        role: this.options.role ?? 'device',
        environment: 'bot'
      });
    }
    const client = this.client;
    const channel = client.channel(this.options.channel) ?? (await client.joinChannel(this.options.channel));
    this.channel = channel;

    const onMessage = (m: ChannelMessage) =>
      this.toDevice(BinaryOpcode.BROADCAST, this.attributed(m.from.name, m.kind === 'shorthand' && m.shorthand ? m.shorthand.raw : m.content));
    const onDm = (m: DirectMessage) => this.toDevice(BinaryOpcode.DIRECT_MSG, this.attributed(m.from.name, m.content));
    const onEvent = (f: ServerFrame) => this.toDeviceEvent(f);
    channel.on('message', onMessage);
    client.on('dm', onDm);
    client.on('event', onEvent);
    this.detach.push(() => {
      channel.off('message', onMessage);
      client.off('dm', onDm);
      client.off('event', onEvent);
    });

    live = true;
    for (const frame of pending.splice(0)) {
      chain = chain.then(() => this.fromDevice(frame)).catch(err => this.report(err));
    }
    this.emit('ready', channel);
    return channel;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    for (const undo of this.detach.splice(0)) undo();
    if (this.ownsClient) await this.client?.close().catch(() => {});
    this.options.transport.close();
    this.emit('closed');
  }

  private report(err: unknown): void {
    if (this.listenerCount('error') > 0) this.emit('error', err);
  }

  // -------------------------------------------------------------------------
  // Device → channel
  // -------------------------------------------------------------------------

  private async fromDevice(frame: BinaryFrame): Promise<void> {
    const channel = this.channel!;
    const raw = frame.raw ?? Buffer.alloc(0);

    switch (frame.opcode) {
      case BinaryOpcode.LOCK_ACQUIRE: {
        const { parsed } = DialectEngine.unpackFromBits(raw);
        if (!parsed.target) return this.deny('', 'malformed lock request');
        const reason = parsed.reason || (parsed.intent ? parsed.intent.slice(1).toLowerCase() : 'device task');
        try {
          const lock = await channel.lock(parsed.target, reason, parsed.ttl);
          const ttl = Math.max(0, Math.round((lock.expiresAt - Date.now()) / 1000));
          this.replyPacked(BinaryOpcode.LOCK_ACK, { action: '!LCK', target: lock.file, ttl });
        } catch (err) {
          if (err instanceof CrossTalkError && err.code === 'lock_held') {
            const held = err.details as FileLock;
            this.deny(parsed.target, `held by ${held.holder.name}`);
          } else {
            this.deny(parsed.target, err instanceof Error ? err.message : 'lock failed');
          }
        }
        return;
      }

      case BinaryOpcode.LOCK_RELEASE: {
        const { parsed } = DialectEngine.unpackFromBits(raw);
        if (!parsed.target) return;
        await channel.unlock(parsed.target);
        this.replyPacked(BinaryOpcode.LOCK_ACK, { action: '!REL', target: parsed.target, flow: ['&DONE'] });
        return;
      }

      case BinaryOpcode.BROADCAST: {
        if (!raw.length) return;
        if (PACKED_ACTION_IDS.has(raw[0])) {
          const { shorthand } = DialectEngine.unpackFromBits(raw);
          if (shorthand) await channel.shorthand(shorthand);
        } else {
          const text = raw.toString('utf8').trim();
          if (text) await channel.send(text);
        }
        return;
      }

      case BinaryOpcode.DIRECT_MSG: {
        const split = splitAttributed(raw);
        if (!split || !split.name || !split.text) {
          this.report(new Error('DIRECT_MSG payload must be [to_len:1][to][text]'));
          return;
        }
        await this.client!.dm(split.name, split.text);
        return;
      }

      case BinaryOpcode.REGISTER:
        // The name was taken during the register window; later REGISTERs just get the id back.
        this.reply(BinaryOpcode.REGISTER, Buffer.from(this.client!.agent.id));
        return;

      case BinaryOpcode.HEARTBEAT: {
        const task = raw.length ? raw.toString('utf8').trim() : '';
        await this.client!.setStatus('working', task || undefined);
        this.reply(BinaryOpcode.HEARTBEAT, Buffer.alloc(0));
        return;
      }

      case BinaryOpcode.STATE_QUERY: {
        await channel.refresh();
        this.reply(BinaryOpcode.STATE_QUERY, Buffer.from(`members=${channel.members.size} locks=${channel.locks.size}`));
        return;
      }

      default:
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Channel → device
  // -------------------------------------------------------------------------

  /** [name_len:1][name][text], trimmed to fit the device's payload limit. */
  private attributed(name: string, text: string): Buffer {
    const who = fitUtf8(name, Math.min(32, this.maxPayload - 1));
    const body = fitUtf8(text, this.maxPayload - 1 - who.length);
    return Buffer.concat([Buffer.from([who.length]), who, body]);
  }

  private toDeviceEvent(f: ServerFrame): void {
    const address = this.channel?.address;
    if (this.options.forwardLockEvents === false || !address) return;
    switch (f.type) {
      case 'lock.acquired':
        if (f.lock.channel === address) {
          this.sendPacked(BinaryOpcode.LOCK_ACQUIRE, { action: '!LCK', target: f.lock.file, reason: f.lock.holder.name, flow: ['&WAIT'] });
        }
        return;
      case 'lock.released':
        if (f.channel === address) this.sendPacked(BinaryOpcode.LOCK_RELEASE, { action: '!REL', target: f.file, flow: ['&DONE'] });
        return;
      case 'lock.contended':
        if (f.lock.channel === address) {
          this.sendPacked(BinaryOpcode.LOCK_ACQUIRE, { action: '!WARN', target: f.lock.file, reason: f.requester.name }, { conflictAlert: true });
        }
        return;
    }
  }

  private deny(file: string, why: string): void {
    this.replyPacked(BinaryOpcode.LOCK_DENIED, { action: '!WARN', target: file, reason: why });
  }

  /**
   * Packs XDialect fields directly (no string round trip, so paths with spaces
   * or quotes survive) and shrinks them to fit the device: the reason is
   * trimmed first, then the frame is dropped if the path alone doesn't fit.
   * A packed payload is never cut blindly, since its length fields would lie.
   */
  private pack(fields: PackFields): Buffer | undefined {
    const ttl = Math.max(0, Math.min(Math.round(fields.ttl ?? 0), 0xffff));
    const target = fields.target ?? '';
    // Fixed layout: 5 header bytes + target len + target + reason len + reason.
    const targetBytes = Buffer.byteLength(target);
    const room = this.maxPayload - 7 - targetBytes;
    if (targetBytes > 255 || room < 0) {
      this.report(new Error(`Skipped ${fields.action} for a ${targetBytes}-byte path that does not fit a ${this.maxPayload}-byte device frame`));
      return undefined;
    }
    const reason = fields.reason ? fitUtf8(fields.reason, Math.min(room, 255)).toString('utf8') : undefined;
    return DialectEngine.packToBits({
      action: fields.action,
      target,
      intent: fields.intent,
      reason,
      ttl,
      flow: fields.flow ?? [],
      rawShorthand: ''
    });
  }

  private sendPacked(opcode: BinaryOpcode, fields: PackFields, flags: BinaryFrame['flags'] = {}): void {
    const payload = this.pack(fields);
    if (payload) this.toDevice(opcode, payload, flags);
  }

  private replyPacked(opcode: BinaryOpcode, fields: PackFields): void {
    this.sendPacked(opcode, fields, { isResponse: true });
  }

  private reply(opcode: BinaryOpcode, payload: Buffer): void {
    this.toDevice(opcode, payload, { isResponse: true });
  }

  private toDevice(opcode: BinaryOpcode, payload: Buffer, flags: BinaryFrame['flags'] = {}): void {
    if (this.stopped || !this.options.transport.isConnected) return;
    if (payload.length > this.maxPayload) {
      // Callers size payloads to fit; this only guards against a bug turning into a malformed frame.
      this.report(new Error(`Refused to send a ${payload.length}-byte payload (device limit ${this.maxPayload})`));
      return;
    }
    this.options.transport.send(BinaryCodec.encode({ opcode, flags, timestamp: Date.now(), payload }));
  }
}

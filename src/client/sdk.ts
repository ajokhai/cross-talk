import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import {
  PROTOCOL_VERSION,
  type AgentEnvironment,
  type AgentInfo,
  type AgentStatus,
  type ChannelInfo,
  type ChannelMessage,
  type ChannelSnapshot,
  type DirectMessage,
  type ErrorCode,
  type FileLock,
  type RequestFrame,
  type ResultData,
  type ServerFrame
} from '../protocol.js';

export const DEFAULT_URL = 'ws://localhost:4488';

/**
 * Maps `localhost` to 127.0.0.1. The hub binds IPv4 loopback by default, and
 * Node 18 resolves `localhost` to ::1 first without falling back, so a plain
 * `localhost` URL would never reach a default hub there.
 */
export function pinLoopback(url: string): string {
  return url.replace(/^(wss?|https?):\/\/localhost(?=[:/]|$)/i, '$1://127.0.0.1');
}

export interface ConnectOptions {
  name: string;
  /** Hub WebSocket URL. Defaults to $CROSSTALK_URL or ws://localhost:4488. */
  url?: string;
  /** Hub token. Defaults to $CROSSTALK_AUTH_TOKEN. */
  token?: string;
  role?: string;
  environment?: AgentEnvironment;
  /** Defaults to the current git branch, if any. */
  branch?: string;
  currentTask?: string;
  /** Lock paths are sent relative to this directory. Defaults to the git root or cwd. */
  workspaceRoot?: string;
  /** Reconnect and rejoin channels after the socket drops. Default true. */
  reconnect?: boolean;
  requestTimeoutMs?: number;
  /** Start an in-process hub if nothing is listening on a localhost URL. Default false. */
  autoStart?: boolean;
}

export class CrossTalkError extends Error {
  constructor(readonly code: ErrorCode | 'timeout' | 'disconnected', message: string, readonly details?: unknown) {
    super(message);
    this.name = 'CrossTalkError';
  }
}

type RequestType = RequestFrame['type'];
type RequestBody<T extends RequestType> = Omit<Extract<RequestFrame, { type: T }>, 'type' | 'id'>;

function git(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * A channel the client has joined. Keeps a live view of members and locks
 * and re-emits the channel's events.
 *
 * Events: 'message', 'member.joined', 'member.left', 'member.updated',
 * 'lock.acquired', 'lock.released', 'lock.contended'.
 */
export class Channel extends EventEmitter {
  info: ChannelInfo;
  readonly members = new Map<string, AgentInfo>();
  readonly locks = new Map<string, FileLock>();
  /** Recent history, starting with what the hub had when we joined. */
  readonly messages: ChannelMessage[] = [];

  constructor(private readonly client: CrossTalk, snapshot: ChannelSnapshot) {
    super();
    this.info = snapshot.channel;
    this.apply(snapshot);
  }

  /** The conversation's address. Share it with the agents you want in this conversation. */
  get address(): string {
    return this.info.id;
  }

  /** Display label; not unique. */
  get name(): string {
    return this.info.name;
  }

  /** @internal */
  apply(snapshot: ChannelSnapshot): void {
    this.info = snapshot.channel;
    this.members.clear();
    for (const m of snapshot.members) this.members.set(m.id, m);
    this.locks.clear();
    for (const l of snapshot.locks) this.locks.set(l.file, l);
    this.messages.splice(0, this.messages.length, ...snapshot.messages);
  }

  /** @internal */
  handle(frame: ServerFrame): void {
    switch (frame.type) {
      case 'message':
        this.messages.push(frame.message);
        if (this.messages.length > 500) this.messages.shift();
        this.emit('message', frame.message);
        break;
      case 'member.joined':
      case 'member.updated':
        this.members.set(frame.agent.id, frame.agent);
        this.emit(frame.type, frame.agent);
        break;
      case 'member.left':
        this.members.delete(frame.agent.id);
        this.emit('member.left', frame.agent, frame.reason);
        break;
      case 'lock.acquired':
        this.locks.set(frame.lock.file, frame.lock);
        this.emit('lock.acquired', frame.lock);
        break;
      case 'lock.released':
        this.locks.delete(frame.file);
        this.emit('lock.released', frame);
        break;
      case 'lock.contended':
        this.emit('lock.contended', frame);
        break;
    }
  }

  async send(content: string, metadata?: Record<string, unknown>): Promise<ChannelMessage> {
    const message = await this.client.request('message.send', { channel: this.address, content, metadata });
    this.messages.push(message);
    return message;
  }

  /** Sends XDialect shorthand, e.g. `!LCK @src/auth.ts #REF "jwt" &WAIT`. */
  async shorthand(expression: string): Promise<ChannelMessage> {
    const message = await this.client.request('shorthand.send', { channel: this.address, shorthand: expression });
    this.messages.push(message);
    return message;
  }

  /**
   * Claims an advisory lock on a file. Rejects with code 'lock_held' (and the
   * current lock in `details`) when someone else holds it.
   */
  async lock(file: string, reason: string, ttlSeconds?: number): Promise<FileLock> {
    const lock = await this.client.request('lock.acquire', {
      channel: this.address,
      file: this.client.relativePath(file),
      reason,
      ttlSeconds
    });
    this.locks.set(lock.file, lock);
    return lock;
  }

  async unlock(file: string): Promise<void> {
    const { file: released } = await this.client.request('lock.release', {
      channel: this.address,
      file: this.client.relativePath(file)
    });
    this.locks.delete(released);
  }

  /** Re-fetches members, locks and recent history from the hub. */
  async refresh(): Promise<this> {
    this.apply(await this.client.request('channel.state', { channel: this.address }));
    return this;
  }

  async leave(): Promise<void> {
    await this.client.request('channel.leave', { channel: this.address });
    this.client.forget(this.address);
  }
}

/**
 * A CrossTalk agent connection.
 *
 * ```ts
 * const ct = await CrossTalk.connect({ name: 'Claude' });
 * const ch = await ct.createChannel('auth-refactor');
 * console.log('share this address:', ch.address);   // others: ct.joinChannel(address)
 * ch.on('message', m => console.log(m.from.name, m.content));
 * await ch.send('Starting on the token refresh flow');
 * ```
 *
 * Events: 'message' (ChannelMessage, any channel), 'dm' (DirectMessage),
 * 'event' (every raw ServerFrame), 'disconnected', 'reconnected', 'error'.
 */
export class CrossTalk extends EventEmitter {
  agent!: AgentInfo;
  /** Joined channels by address. */
  readonly channels = new Map<string, Channel>();
  private ws?: WebSocket;
  private readonly pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private readonly options: Required<Omit<ConnectOptions, 'branch' | 'currentTask'>> & Pick<ConnectOptions, 'branch' | 'currentTask'>;
  private closed = false;
  private reconnectDelay = 500;
  /** Messages and DMs not yet consumed by waitForMessage(), so nothing arriving between calls is lost. */
  private unread: Array<ChannelMessage | DirectMessage> = [];
  private readonly wakeWaiters = new Set<() => void>();

  private constructor(options: ConnectOptions) {
    super();
    this.options = {
      url: options.url ?? process.env.CROSSTALK_URL ?? DEFAULT_URL,
      token: options.token ?? process.env.CROSSTALK_AUTH_TOKEN ?? '',
      role: options.role ?? 'agent',
      environment: options.environment ?? 'bot',
      workspaceRoot: options.workspaceRoot ?? git(['rev-parse', '--show-toplevel']) ?? process.cwd(),
      reconnect: options.reconnect ?? true,
      requestTimeoutMs: options.requestTimeoutMs ?? 10_000,
      autoStart: options.autoStart ?? false,
      name: options.name,
      branch: options.branch ?? git(['rev-parse', '--abbrev-ref', 'HEAD']),
      currentTask: options.currentTask
    };
  }

  static async connect(options: ConnectOptions): Promise<CrossTalk> {
    const client = new CrossTalk(options);
    try {
      await client.open();
    } catch (err: any) {
      const local = /^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/.test(client.options.url);
      if (!client.options.autoStart || !local || err?.code !== 'ECONNREFUSED') throw err;
      const { startServer } = await import('../server/index.js');
      const port = Number(new URL(client.options.url).port) || 4488;
      try {
        await startServer({ port, quiet: true });
      } catch (startErr: any) {
        // Another process won the race to start a hub; just use theirs.
        if (startErr?.code !== 'EADDRINUSE') throw startErr;
      }
      await client.open();
    }
    return client;
  }

  get url(): string {
    return this.options.url;
  }

  /** Emits 'error' only when someone listens, so a stray error never crashes the host process. */
  private report(err: unknown): void {
    if (this.listenerCount('error') > 0) this.emit('error', err);
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(pinLoopback(this.options.url));
      const headers: Record<string, string> = {};
      if (this.options.token) {
        headers.Authorization = `Bearer ${this.options.token}`;
        const loopback = /^(localhost|127\.|\[::1\])/.test(url.hostname);
        if (url.protocol === 'ws:' && !loopback) {
          console.warn('[crosstalk] sending the hub token over unencrypted ws:// to a remote host; prefer wss://');
        }
      }
      const ws = new WebSocket(url, { headers, handshakeTimeout: 10_000 });
      let welcomed = false;
      const giveUp = setTimeout(() => {
        if (welcomed) return;
        reject(new CrossTalkError('timeout', 'Hub did not answer hello within 10s'));
        ws.terminate();
      }, 10_000);

      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          agent: {
            name: this.options.name,
            role: this.options.role,
            environment: this.options.environment,
            branch: this.options.branch,
            currentTask: this.options.currentTask
          }
        }));
      });

      ws.on('message', data => {
        let frame: ServerFrame;
        try {
          frame = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (!welcomed) {
          if (frame.type === 'welcome') {
            welcomed = true;
            clearTimeout(giveUp);
            this.ws = ws;
            this.agent = frame.agent;
            this.reconnectDelay = 500;
            resolve();
          } else if (frame.type === 'error') {
            reject(new CrossTalkError(frame.error.code, frame.error.message));
            ws.close();
          }
          return;
        }
        try {
          this.dispatch(frame);
        } catch (err) {
          this.report(err);
        }
      });

      ws.on('unexpected-response', (_req, res) => {
        reject(new CrossTalkError('unauthorized', `Hub refused the connection (HTTP ${res.statusCode})`));
      });

      ws.on('error', err => {
        if (!welcomed) reject(err);
        else this.report(err);
      });

      ws.on('close', (code, reason) => {
        if (!welcomed) {
          clearTimeout(giveUp);
          reject(new CrossTalkError('disconnected', `Hub closed the connection (${code}${reason.length ? `: ${reason}` : ''})`));
          return;
        }
        this.ws = undefined;
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new CrossTalkError('disconnected', 'Connection closed'));
          this.pending.delete(id);
        }
        this.emit('disconnected');
        if (!this.closed && this.options.reconnect) this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect(): void {
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15_000);
    setTimeout(async () => {
      if (this.closed) return;
      try {
        await this.open();
        // A reconnect gets a new agent id; rejoin everything and drop stale locks.
        for (const channel of [...this.channels.values()]) {
          try {
            channel.apply(await this.request('channel.join', { channel: channel.address }));
          } catch (err) {
            this.channels.delete(channel.address);
            this.report(err);
          }
        }
        this.emit('reconnected', this.agent);
      } catch {
        this.scheduleReconnect();
      }
    }, delay).unref();
  }

  private dispatch(frame: ServerFrame): void {
    if (frame.type === 'result') {
      const p = this.pending.get(frame.id);
      if (!p) return;
      this.pending.delete(frame.id);
      clearTimeout(p.timer);
      if (frame.ok) p.resolve(frame.data);
      else p.reject(new CrossTalkError(frame.error.code, frame.error.message, frame.error.details));
      return;
    }

    this.emit('event', frame);
    switch (frame.type) {
      case 'dm':
        this.queue(frame.message);
        this.emit('dm', frame.message);
        return;
      case 'error':
        this.report(new CrossTalkError(frame.error.code, frame.error.message));
        return;
      case 'message':
        this.queue(frame.message);
        this.channels.get(frame.message.channel)?.handle(frame);
        this.emit('message', frame.message);
        return;
      case 'lock.contended':
        this.channels.get(frame.lock.channel)?.handle(frame);
        this.emit('lock.contended', frame);
        return;
      case 'member.joined':
      case 'member.left':
      case 'member.updated':
      case 'lock.released':
        this.channels.get(frame.channel)?.handle(frame);
        return;
      case 'lock.acquired':
        this.channels.get(frame.lock.channel)?.handle(frame);
        return;
    }
  }

  /** Low-level request. Prefer the typed helpers. */
  request<T extends RequestType>(type: T, body: RequestBody<T>): Promise<ResultData[T]> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new CrossTalkError('disconnected', 'Not connected to a hub'));
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CrossTalkError('timeout', `${type} timed out`));
      }, this.options.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ ...body, type, id }));
    });
  }

  private track(snapshot: ChannelSnapshot): Channel {
    const existing = this.channels.get(snapshot.channel.id);
    if (existing) {
      existing.apply(snapshot);
      return existing;
    }
    const channel = new Channel(this, snapshot);
    this.channels.set(channel.address, channel);
    return channel;
  }

  /** @internal */
  forget(address: string): void {
    this.channels.delete(address);
  }

  /** @internal Converts absolute paths inside the workspace to repo-relative ones. */
  relativePath(file: string): string {
    if (!path.isAbsolute(file)) return file;
    const rel = path.relative(this.options.workspaceRoot, file);
    return rel.startsWith('..') || path.isAbsolute(rel) ? file : rel.split(path.sep).join('/');
  }

  /**
   * Starts a new conversation at a fresh address and joins it. Channels are
   * private (reachable only by address) unless `public: true`, which also lists
   * them in the hub's discovery directory.
   */
  async createChannel(name?: string, options: { topic?: string; public?: boolean } = {}): Promise<Channel> {
    return this.track(await this.request('channel.create', {
      name,
      topic: options.topic,
      visibility: options.public ? 'public' : 'private'
    }));
  }

  /** Joins a conversation by its address (`xt_...`). */
  async joinChannel(address: string): Promise<Channel> {
    return this.track(await this.request('channel.join', { channel: address.trim() }));
  }

  static isAddress(value: string): boolean {
    return /^xt_[A-Za-z0-9_-]{22}$/.test(value.trim());
  }

  /** A joined channel by address, or by label when exactly one joined channel has it. */
  channel(addressOrName: string): Channel | undefined {
    const key = addressOrName.trim();
    const byAddress = this.channels.get(key);
    if (byAddress) return byAddress;
    const byName = [...this.channels.values()].filter(c => c.name.toLowerCase() === key.toLowerCase());
    return byName.length === 1 ? byName[0] : undefined;
  }

  /** Channels you are in. */
  async listChannels(): Promise<ChannelInfo[]> {
    return (await this.request('channel.list', { scope: 'joined' })).channels;
  }

  /** The hub's directory of public channels, most recently active first. */
  async listPublicChannels(options: { limit?: number; cursor?: string } = {}): Promise<{ channels: ChannelInfo[]; cursor?: string }> {
    return this.request('channel.list', { scope: 'public', ...options });
  }

  /** Direct message to an agent (id or name) that shares a channel with you. */
  dm(to: string, content: string, options: { replyExpected?: boolean; metadata?: Record<string, unknown> } = {}): Promise<DirectMessage> {
    return this.request('dm.send', { to, content, ...options });
  }

  async setStatus(status: AgentStatus, currentTask?: string): Promise<AgentInfo> {
    this.agent = await this.request('status.update', { status, currentTask });
    return this.agent;
  }

  private queue(message: ChannelMessage | DirectMessage): void {
    this.unread.push(message);
    if (this.unread.length > 500) this.unread.shift();
    for (const wake of this.wakeWaiters) wake();
  }

  /**
   * Resolves with the oldest unconsumed channel message or DM matching the
   * filter (waiting up to `timeoutMs` if there is none), or `undefined` on
   * timeout. Messages are buffered from connect, so a turn-taking agent never
   * misses one that arrived while it was busy.
   */
  waitForMessage(
    /** `channel` is an address. */
    options: { channel?: string; includeDms?: boolean; timeoutMs?: number } = {}
  ): Promise<ChannelMessage | DirectMessage | undefined> {
    const { channel, includeDms = true, timeoutMs = 60_000 } = options;
    const take = () => {
      const i = this.unread.findIndex(m => ('channel' in m ? !channel || m.channel === channel : includeDms));
      return i === -1 ? undefined : this.unread.splice(i, 1)[0];
    };
    const ready = take();
    if (ready) return Promise.resolve(ready);
    return new Promise(resolve => {
      const done = (value?: ChannelMessage | DirectMessage) => {
        clearTimeout(timer);
        this.wakeWaiters.delete(check);
        resolve(value);
      };
      const check = () => {
        const next = take();
        if (next) done(next);
      };
      const timer = setTimeout(() => done(), timeoutMs);
      this.wakeWaiters.add(check);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const ws = this.ws;
    if (!ws) return;
    await new Promise<void>(resolve => {
      ws.once('close', () => resolve());
      ws.close(1000, 'client closed');
    });
  }
}

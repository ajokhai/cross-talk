import crypto from 'node:crypto';
import {
  PROTOCOL_VERSION,
  type AgentInfo,
  type AgentRef,
  type ChannelInfo,
  type ChannelMessage,
  type ChannelSnapshot,
  type ChannelVisibility,
  type DirectMessage,
  type ErrorCode,
  type FileLock,
  type HelloFrame,
  type HubError,
  type RequestFrame,
  type ResultData,
  type ServerFrame
} from '../protocol.js';
import { LockManager, type LockManagerOptions } from './locks.js';
import { DialectEngine } from '../dialect/engine.js';

export const SERVER_VERSION = '1.0.0';

/** Anything that can carry hub frames to an agent: a WebSocket, an HTTP long-poll queue, a test double. */
export interface Peer {
  send(frame: ServerFrame): void;
  close(code?: number, reason?: string): void;
}

export interface HubOptions {
  /** Messages kept per channel and returned in snapshots. */
  historyLimit?: number;
  maxChannelsPerAgent?: number;
  maxMembersPerChannel?: number;
  maxChannels?: number;
  /** Live channels that can be created from one network address. */
  maxChannelsPerAddress?: number;
  maxAgents?: number;
  /** Simultaneous connections (WebSocket + HTTP sessions) from one network address. */
  maxConnectionsPerAddress?: number;
  maxMessageChars?: number;
  /** How long an empty channel with history survives before it is deleted. */
  emptyChannelTtlMs?: number;
  /** Grace period for an empty channel nobody has written in yet (e.g. created, address shared, creator gone). */
  unusedChannelTtlMs?: number;
  /** Token bucket per connection: burst size and refill per second. */
  rateLimit?: { burst: number; perSecond: number };
  locks?: LockManagerOptions;
  /** Persistence hook, called for every channel message (e.g. write to a database). */
  onMessage?: (message: ChannelMessage) => void;
  now?: () => number;
}

export class HubFailure extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly details?: unknown) {
    super(message);
  }
}

const fail = (code: ErrorCode, message: string, details?: unknown): never => {
  throw new HubFailure(code, message, details);
};

interface Channel {
  id: string;
  name: string;
  topic: string;
  visibility: ChannelVisibility;
  createdBy: AgentRef;
  createdFrom: string;
  createdAt: number;
  lastActivity: number;
  members: Set<string>;
  history: ChannelMessage[];
  emptySince?: number;
}

export class Connection {
  agent?: AgentInfo;
  readonly channels = new Set<string>();
  /** @internal */ released = false;
  private tokens: number;
  private refilledAt: number;

  constructor(
    readonly peer: Peer,
    readonly address: string,
    private readonly limit: { burst: number; perSecond: number },
    now: number
  ) {
    this.tokens = limit.burst;
    this.refilledAt = now;
  }

  get ref(): AgentRef {
    return { id: this.agent!.id, name: this.agent!.name };
  }

  /** Returns false when the connection has exhausted its rate budget. */
  take(now: number): boolean {
    const elapsed = (now - this.refilledAt) / 1000;
    this.tokens = Math.min(this.limit.burst, this.tokens + elapsed * this.limit.perSecond);
    this.refilledAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Strips control and invisible formatting characters (bidi overrides, zero-width) and clamps length. */
const cleanText = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

/**
 * The CrossTalk hub: agents connect, create or join channels, and talk,
 * DM and coordinate file locks inside those channels.
 *
 * Transport-agnostic: callers hand it a `Peer` per connection and feed it
 * decoded frames. See `server/index.ts` for the WebSocket and HTTP bindings.
 */
export class MeshHub {
  readonly locks: LockManager;
  private readonly channels = new Map<string, Channel>(); // address -> channel
  private readonly agents = new Map<string, Connection>(); // agent id -> connection
  private readonly perAddress = new Map<string, number>(); // address -> open connections
  private readonly opts: Required<Omit<HubOptions, 'locks' | 'onMessage' | 'now'>>;
  private readonly onMessage?: (message: ChannelMessage) => void;
  private readonly now: () => number;
  private sweeper?: NodeJS.Timeout;

  constructor(options: HubOptions = {}) {
    this.now = options.now ?? Date.now;
    this.locks = new LockManager({ now: this.now, ...options.locks });
    this.onMessage = options.onMessage;
    this.opts = {
      historyLimit: options.historyLimit ?? 100,
      maxChannelsPerAgent: options.maxChannelsPerAgent ?? 32,
      maxMembersPerChannel: options.maxMembersPerChannel ?? 50,
      maxChannels: options.maxChannels ?? 10_000,
      maxChannelsPerAddress: options.maxChannelsPerAddress ?? 32,
      maxAgents: options.maxAgents ?? 10_000,
      maxConnectionsPerAddress: options.maxConnectionsPerAddress ?? 64,
      maxMessageChars: options.maxMessageChars ?? 16_000,
      emptyChannelTtlMs: options.emptyChannelTtlMs ?? 60 * 60 * 1000,
      unusedChannelTtlMs: options.unusedChannelTtlMs ?? 10 * 60 * 1000,
      rateLimit: options.rateLimit ?? { burst: 60, perSecond: 20 }
    };
  }

  /** Starts the periodic sweep for expired locks and abandoned channels. */
  start(intervalMs = 5000): this {
    this.sweeper ??= setInterval(() => this.sweep(), intervalMs);
    this.sweeper.unref?.();
    return this;
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = undefined;
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  /**
   * Admits a new connection from `address` (an IP, or any stable client key).
   * Throws a HubFailure with code 'rate_limited' when the address or hub is at capacity.
   */
  connect(peer: Peer, address = 'unknown'): Connection {
    const open = this.perAddress.get(address) ?? 0;
    if (open >= this.opts.maxConnectionsPerAddress) fail('rate_limited', 'Too many connections from your address');
    if (this.agents.size >= this.opts.maxAgents) fail('rate_limited', 'Hub is at capacity');
    this.perAddress.set(address, open + 1);
    return new Connection(peer, address, this.opts.rateLimit, this.now());
  }

  /** Handles a raw text frame from a streaming transport (WebSocket). */
  async receive(conn: Connection, raw: string): Promise<void> {
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      conn.peer.send({ type: 'error', error: { code: 'bad_request', message: 'Frame is not valid JSON' } });
      return;
    }
    if (!isPlainObject(frame) || typeof frame.type !== 'string') {
      conn.peer.send({ type: 'error', error: { code: 'bad_request', message: 'Frame must be an object with a "type"' } });
      return;
    }
    if (frame.type === 'hello') {
      try {
        conn.peer.send(this.hello(conn, frame as unknown as HelloFrame));
      } catch (err) {
        conn.peer.send({ type: 'error', error: this.toHubError(err) });
      }
      return;
    }
    conn.peer.send(await this.request(conn, frame));
  }

  hello(conn: Connection, frame: HelloFrame): Extract<ServerFrame, { type: 'welcome' }> {
    if (conn.agent) fail('bad_request', 'Already registered');
    if (conn.released) fail('not_registered', 'Connection is closed');
    if (frame.protocol !== PROTOCOL_VERSION) {
      fail('bad_request', `Unsupported protocol ${frame.protocol}; this hub speaks ${PROTOCOL_VERSION}`);
    }
    const raw: Record<string, unknown> = isPlainObject(frame.agent) ? frame.agent : {};
    const name = cleanText(raw.name, 64);
    if (!name) fail('bad_request', 'agent.name is required');
    const environments = ['ide', 'terminal', 'bot', 'web'] as const;
    const now = this.now();
    const agent: AgentInfo = {
      id: newId('ag'),
      name,
      role: cleanText(raw.role, 64) || 'agent',
      environment: environments.includes(raw.environment as any) ? (raw.environment as AgentInfo['environment']) : 'bot',
      branch: cleanText(raw.branch, 128) || undefined,
      status: 'idle',
      currentTask: cleanText(raw.currentTask, 280),
      connectedAt: now,
      lastSeen: now
    };
    conn.agent = agent;
    this.agents.set(agent.id, conn);
    return { type: 'welcome', protocol: PROTOCOL_VERSION, agent, serverVersion: SERVER_VERSION };
  }

  /** Removes the agent from every channel, releasing its locks. Safe to call twice. */
  disconnect(conn: Connection): void {
    if (conn.released) return;
    conn.released = true;
    const open = (this.perAddress.get(conn.address) ?? 1) - 1;
    if (open > 0) this.perAddress.set(conn.address, open);
    else this.perAddress.delete(conn.address);
    if (!conn.agent) return;
    for (const name of [...conn.channels]) this.removeMember(conn, name, 'disconnected');
    this.agents.delete(conn.agent.id);
  }

  /** Dispatches one request frame and returns its `result` frame. */
  async request(conn: Connection, frame: Record<string, unknown>): Promise<ServerFrame> {
    const id = typeof frame.id === 'string' && frame.id.length <= 128 ? frame.id : '';
    try {
      if (!id) fail('bad_request', 'Requests need a string "id" (max 128 chars)');
      if (!conn.agent) fail('not_registered', 'Send "hello" first');
      if (!conn.take(this.now())) fail('rate_limited', 'Too many requests; slow down');
      conn.agent!.lastSeen = this.now();
      const data = await this.dispatch(conn, frame as unknown as RequestFrame);
      return { type: 'result', id, ok: true, data };
    } catch (err) {
      return { type: 'result', id, ok: false, error: this.toHubError(err) };
    }
  }

  private toHubError(err: unknown): HubError {
    if (err instanceof HubFailure) {
      return err.details === undefined
        ? { code: err.code, message: err.message }
        : { code: err.code, message: err.message, details: err.details };
    }
    console.error('[crosstalk] internal error:', err);
    return { code: 'internal', message: 'Internal hub error' };
  }

  private async dispatch(conn: Connection, f: RequestFrame): Promise<unknown> {
    switch (f.type) {
      case 'channel.create': return this.createChannel(conn, f.name, f.topic, f.visibility);
      case 'channel.join': return this.joinChannel(conn, f.channel);
      case 'channel.leave': return this.leaveChannel(conn, f.channel);
      case 'channel.list': return this.listChannels(conn, f.scope ?? 'joined', f.limit, f.cursor);
      case 'channel.state': return this.snapshot(this.memberChannel(conn, f.channel));
      case 'message.send': return this.postMessage(conn, f.channel, f.content, f.metadata);
      case 'shorthand.send': return this.postShorthand(conn, f.channel, f.shorthand);
      case 'dm.send': return this.sendDirect(conn, f.to, f.content, f.replyExpected, f.metadata);
      case 'lock.acquire': return this.acquireLock(conn, f.channel, f.file, f.reason, f.ttlSeconds);
      case 'lock.release': return this.releaseLock(conn, f.channel, f.file);
      case 'status.update': return this.updateStatus(conn, f.status, f.currentTask);
      default: return fail('bad_request', `Unknown request type "${(f as { type: string }).type}"`);
    }
  }

  // -------------------------------------------------------------------------
  // Channels
  // -------------------------------------------------------------------------

  static isAddress(value: unknown): value is string {
    return typeof value === 'string' && /^xt_[A-Za-z0-9_-]{22}$/.test(value);
  }

  /** Creates a conversation with a fresh, unguessable address and joins the creator to it. */
  private createChannel(conn: Connection, rawName: unknown, topic: unknown, visibility: unknown): ChannelSnapshot {
    if (visibility !== undefined && visibility !== 'public' && visibility !== 'private') {
      fail('bad_request', 'visibility must be "public" or "private"');
    }
    if (this.channels.size >= this.opts.maxChannels) fail('quota_exceeded', 'Hub channel limit reached');
    let fromAddress = 0;
    for (const c of this.channels.values()) if (c.createdFrom === conn.address) fromAddress++;
    if (fromAddress >= this.opts.maxChannelsPerAddress) {
      fail('quota_exceeded', `At most ${this.opts.maxChannelsPerAddress} live channels per network address`);
    }
    this.ensureRoom(conn);

    const now = this.now();
    const channel: Channel = {
      id: `xt_${crypto.randomBytes(16).toString('base64url')}`,
      name: cleanText(rawName, 64) || 'untitled',
      topic: cleanText(topic, 280),
      visibility: visibility === 'public' ? 'public' : 'private',
      createdBy: conn.ref,
      createdFrom: conn.address,
      createdAt: now,
      lastActivity: now,
      members: new Set(),
      history: []
    };
    this.channels.set(channel.id, channel);
    this.addMember(conn, channel);
    return this.snapshot(channel);
  }

  private joinChannel(conn: Connection, address: unknown): ChannelSnapshot {
    const channel = MeshHub.isAddress(address) ? this.channels.get(address) : undefined;
    if (!channel) return fail('not_found', 'No conversation at that address');
    if (!channel.members.has(conn.agent!.id)) {
      if (channel.members.size >= this.opts.maxMembersPerChannel) fail('quota_exceeded', 'Channel is full');
      this.ensureRoom(conn);
      this.addMember(conn, channel);
    }
    return this.snapshot(channel);
  }

  private leaveChannel(conn: Connection, address: unknown): { channel: string } {
    const channel = this.memberChannel(conn, address);
    this.removeMember(conn, channel.id, 'left');
    return { channel: channel.id };
  }

  private ensureRoom(conn: Connection): void {
    if (conn.channels.size >= this.opts.maxChannelsPerAgent) {
      fail('quota_exceeded', `An agent can be in at most ${this.opts.maxChannelsPerAgent} channels`);
    }
  }

  private addMember(conn: Connection, channel: Channel): void {
    channel.members.add(conn.agent!.id);
    channel.emptySince = undefined;
    conn.channels.add(channel.id);
    this.emit(channel, { type: 'member.joined', channel: channel.id, agent: conn.agent! }, conn.agent!.id);
  }

  private removeMember(conn: Connection, id: string, reason: 'left' | 'disconnected'): void {
    const channel = this.channels.get(id);
    conn.channels.delete(id);
    if (!channel) return;
    channel.members.delete(conn.agent!.id);

    for (const lock of this.locks.releaseAllBy(conn.agent!.id, id)) {
      this.emit(channel, { type: 'lock.released', channel: id, file: lock.file, by: conn.ref, reason: 'disconnected' });
    }
    this.emit(channel, { type: 'member.left', channel: id, agent: conn.ref, reason });
    if (channel.members.size === 0) channel.emptySince = this.now();
  }

  private deleteChannel(channel: Channel): void {
    this.channels.delete(channel.id);
    this.locks.releaseChannel(channel.id);
  }

  private memberChannel(conn: Connection, address: unknown): Channel {
    const channel = MeshHub.isAddress(address) ? this.channels.get(address) : undefined;
    if (!channel || !channel.members.has(conn.agent!.id)) {
      return fail('not_member', 'You are not in that channel. Join it by its address first.');
    }
    return channel;
  }

  private info(channel: Channel): ChannelInfo {
    return {
      id: channel.id,
      name: channel.name,
      topic: channel.topic,
      visibility: channel.visibility,
      createdBy: channel.createdBy,
      createdAt: channel.createdAt,
      lastActivity: channel.lastActivity,
      memberCount: channel.members.size,
      maxMembers: this.opts.maxMembersPerChannel
    };
  }

  private snapshot(channel: Channel): ChannelSnapshot {
    return {
      channel: this.info(channel),
      members: [...channel.members].map(id => this.agents.get(id)?.agent).filter((a): a is AgentInfo => !!a),
      locks: this.locks.list(channel.id),
      messages: channel.history.slice(-this.opts.historyLimit)
    };
  }

  /**
   * `joined`: the caller's channels. `public`: the opt-in discovery directory,
   * most recently active first, paginated with an opaque cursor.
   */
  listChannels(conn: Connection | undefined, scope: unknown = 'joined', limit?: unknown, cursor?: unknown): ResultData['channel.list'] {
    if (scope === 'joined') {
      const mine = conn ? [...conn.channels].map(id => this.channels.get(id)).filter((c): c is Channel => !!c) : [];
      return { channels: mine.map(c => this.info(c)) };
    }
    if (scope !== 'public') fail('bad_request', 'scope must be "joined" or "public"');
    const size = Math.max(1, Math.min(typeof limit === 'number' ? Math.floor(limit) : 50, 100));
    const offset = typeof cursor === 'string' && /^\d+$/.test(cursor) ? Number(cursor) : 0;
    const listed = [...this.channels.values()]
      .filter(c => c.visibility === 'public')
      .sort((a, b) => b.lastActivity - a.lastActivity || a.id.localeCompare(b.id));
    const page = listed.slice(offset, offset + size).map(c => this.info(c));
    return offset + size < listed.length ? { channels: page, cursor: String(offset + size) } : { channels: page };
  }

  /** Read-only view for HTTP observers. Knowing the address is the capability. */
  snapshotByAddress(address: string): ChannelSnapshot | undefined {
    const channel = MeshHub.isAddress(address) ? this.channels.get(address) : undefined;
    return channel ? this.snapshot(channel) : undefined;
  }

  /** Lock lookup for editor hooks. */
  checkLock(address: string, rawFile: string): { locked: boolean; lock?: FileLock } | undefined {
    const channel = MeshHub.isAddress(address) ? this.channels.get(address) : undefined;
    if (!channel) return undefined;
    const lock = this.locks.get(channel.id, LockManager.normalizePath(rawFile));
    return lock ? { locked: true, lock } : { locked: false };
  }

  stats() {
    return {
      agents: this.agents.size,
      channels: this.channels.size,
      locks: this.locks.list().length
    };
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  private messageText(content: unknown): string {
    if (typeof content !== 'string' || !content.trim()) fail('bad_request', 'content must be a non-empty string');
    const text = content as string;
    if (text.length > this.opts.maxMessageChars) {
      fail('bad_request', `content exceeds ${this.opts.maxMessageChars} characters`);
    }
    return text;
  }

  private metadata(value: unknown): Record<string, unknown> | undefined {
    if (value === undefined) return undefined;
    if (!isPlainObject(value)) fail('bad_request', 'metadata must be an object');
    if (JSON.stringify(value).length > this.opts.maxMessageChars) fail('bad_request', 'metadata is too large');
    return value as Record<string, unknown>;
  }

  private record(channel: Channel, message: ChannelMessage, sender: Connection): ChannelMessage {
    channel.history.push(message);
    if (channel.history.length > this.opts.historyLimit) channel.history.shift();
    channel.lastActivity = message.timestamp;
    this.emit(channel, { type: 'message', message }, sender.agent!.id);
    try {
      this.onMessage?.(message);
    } catch (err) {
      console.error('[crosstalk] onMessage hook failed:', err);
    }
    return message;
  }

  private postMessage(conn: Connection, address: unknown, content: unknown, metadata: unknown): ChannelMessage {
    const channel = this.memberChannel(conn, address);
    const message: ChannelMessage = {
      id: newId('msg'),
      channel: channel.id,
      kind: 'chat',
      from: conn.ref,
      content: this.messageText(content),
      timestamp: this.now()
    };
    const meta = this.metadata(metadata);
    if (meta) message.metadata = meta;
    return this.record(channel, message, conn);
  }

  /** XDialect shorthand. `!LCK` / `!REL` with a target also take or release the lock. */
  private postShorthand(conn: Connection, address: unknown, shorthand: unknown): ChannelMessage {
    const channel = this.memberChannel(conn, address);
    const raw = this.messageText(shorthand);
    const parsed = DialectEngine.parse(raw);

    if (parsed.action === '!LCK' && parsed.target) {
      this.acquireLock(conn, channel.id, parsed.target, parsed.reason || parsed.intent || 'XDialect lock', parsed.ttl);
    } else if (parsed.action === '!REL' && parsed.target) {
      this.releaseLock(conn, channel.id, parsed.target);
    }

    return this.record(channel, {
      id: newId('msg'),
      channel: channel.id,
      kind: 'shorthand',
      from: conn.ref,
      content: DialectEngine.toHuman(parsed),
      timestamp: this.now(),
      shorthand: { raw, action: parsed.action, target: parsed.target, intent: parsed.intent }
    }, conn);
  }

  /** DMs are only allowed between agents that share at least one channel. */
  private sendDirect(conn: Connection, to: unknown, content: unknown, replyExpected: unknown, metadata: unknown): DirectMessage {
    const target = this.resolvePeer(conn, to);
    const message: DirectMessage = {
      id: newId('dm'),
      from: conn.ref,
      to: target.ref,
      content: this.messageText(content),
      timestamp: this.now(),
      replyExpected: replyExpected !== false
    };
    const meta = this.metadata(metadata);
    if (meta) message.metadata = meta;
    target.peer.send({ type: 'dm', message });
    return message;
  }

  /** Finds a reachable agent by id, or by case-insensitive name among channel-mates. */
  private resolvePeer(conn: Connection, to: unknown): Connection {
    const key = cleanText(to, 128);
    if (!key) fail('bad_request', '"to" must be an agent id or name');

    const reachable = new Map<string, Connection>();
    for (const name of conn.channels) {
      for (const id of this.channels.get(name)?.members ?? []) {
        const other = this.agents.get(id);
        if (other && id !== conn.agent!.id) reachable.set(id, other);
      }
    }

    const byId = reachable.get(key);
    if (byId) return byId;
    const byName = [...reachable.values()].filter(c => c.agent!.name.toLowerCase() === key.toLowerCase());
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) {
      fail('bad_request', `Several agents are named "${key}"; use an id`, { ids: byName.map(c => c.agent!.id) });
    }
    return fail('not_found', `No agent "${key}" shares a channel with you`);
  }

  // -------------------------------------------------------------------------
  // Locks & presence
  // -------------------------------------------------------------------------

  private acquireLock(conn: Connection, address: unknown, rawFile: unknown, reason: unknown, ttlSeconds: unknown): FileLock {
    const channel = this.memberChannel(conn, address);
    const file = LockManager.normalizePath(rawFile as string);
    if (!file) fail('bad_request', 'file must be a non-empty path');
    const why = cleanText(reason, 280) || 'editing';
    const result = this.locks.acquire(channel.id, file, conn.ref, why, typeof ttlSeconds === 'number' ? ttlSeconds : undefined);

    if (!result.ok && result.reason === 'quota') {
      return fail('quota_exceeded', `An agent can hold at most ${result.limit} locks`);
    }
    if (!result.ok) {
      const holder = this.agents.get(result.lock.holder.id);
      holder?.peer.send({ type: 'lock.contended', lock: result.lock, requester: conn.ref, reason: why });
      return fail('lock_held', `${file} is locked by ${result.lock.holder.name}: ${result.lock.reason}`, result.lock);
    }
    channel.lastActivity = this.now();
    this.emit(channel, { type: 'lock.acquired', lock: result.lock }, conn.agent!.id);
    return result.lock;
  }

  private releaseLock(conn: Connection, address: unknown, rawFile: unknown): { channel: string; file: string } {
    const channel = this.memberChannel(conn, address);
    const file = LockManager.normalizePath(rawFile as string);
    if (!file) fail('bad_request', 'file must be a non-empty path');
    const { released, heldBy } = this.locks.release(channel.id, file, conn.agent!.id);
    if (heldBy) fail('forbidden', `${file} is held by ${heldBy.holder.name}, not you`, heldBy);
    if (released) {
      this.emit(channel, { type: 'lock.released', channel: channel.id, file, by: conn.ref, reason: 'released' }, conn.agent!.id);
    }
    return { channel: channel.id, file };
  }

  private updateStatus(conn: Connection, status: unknown, currentTask: unknown): AgentInfo {
    const agent = conn.agent!;
    if (status !== undefined) {
      if (status !== 'idle' && status !== 'working' && status !== 'waiting') {
        fail('bad_request', 'status must be idle, working or waiting');
      }
      agent.status = status as AgentInfo['status'];
    }
    if (currentTask !== undefined) agent.currentTask = cleanText(currentTask, 280);
    for (const name of conn.channels) {
      const channel = this.channels.get(name);
      if (channel) this.emit(channel, { type: 'member.updated', channel: name, agent }, agent.id);
    }
    return agent;
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private emit(channel: Channel, frame: ServerFrame, exceptId?: string): void {
    for (const id of channel.members) {
      if (id !== exceptId) this.agents.get(id)?.peer.send(frame);
    }
  }

  /** Expires stale locks and deletes channels that have been empty too long. */
  sweep(): void {
    for (const lock of this.locks.sweepExpired()) {
      const channel = this.channels.get(lock.channel);
      if (channel) {
        this.emit(channel, { type: 'lock.released', channel: lock.channel, file: lock.file, by: lock.holder, reason: 'expired' });
      }
    }
    const now = this.now();
    for (const channel of [...this.channels.values()]) {
      if (channel.members.size > 0 || channel.emptySince === undefined) continue;
      const ttl = channel.history.length ? this.opts.emptyChannelTtlMs : this.opts.unusedChannelTtlMs;
      if (channel.emptySince + ttl <= now) this.deleteChannel(channel);
    }
  }
}

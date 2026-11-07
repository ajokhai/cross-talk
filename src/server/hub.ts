import crypto from 'node:crypto';
import { channelId, isAddress as isAnyAddress } from '../address.js';
import {
  PROTOCOL_VERSION,
  type AgentInfo,
  type AgentRef,
  type ChannelInfo,
  type ChannelLimits,
  type ChannelMessage,
  type ChannelSnapshot,
  type ChannelVisibility,
  type CreatedChannel,
  type DirectMessage,
  type ErrorCode,
  type FileLock,
  type HelloFrame,
  type InviteInfo,
  type HubError,
  type MemberAttention,
  type MessageReceipt,
  type RequestFrame,
  type ResultData,
  type ServerFrame,
  type Slot,
  type SlotHold,
  type TaskClaim,
  type UserQuestion,
  type WakeHook,
  type WakePayload,
  type ChannelBan,
  type Knock,
  STAY_AWAKE_GUIDANCE
} from '../protocol.js';
import { LockManager, type LockManagerOptions } from './locks.js';
import { DialectEngine } from '../dialect/engine.js';
import { VERSION } from '../version.js';

export const SERVER_VERSION = VERSION;

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
  /** Ceiling for any message or DM, and for what a channel creator can ask for. */
  maxMessageChars?: number;
  /** What a new channel gets unless its creator asks for other limits (defaults: 1000 chars, 120 messages/min, burst 30). */
  channelLimits?: Partial<ChannelLimits>;
  /** The most messages per minute a channel creator can allow. */
  maxMessagesPerMinute?: number;
  /** Open questions one agent can have in one channel, and per channel in total. */
  maxQuestionsPerAgent?: number;
  maxQuestionsPerChannel?: number;
  /** Open claims one agent can hold in one channel. */
  maxClaimsPerAgent?: number;
  /** How long an empty channel with history survives before it is deleted. */
  emptyChannelTtlMs?: number;
  /** Grace period for an empty channel nobody has written in yet (e.g. created, address shared, creator gone). */
  unusedChannelTtlMs?: number;
  /**
   * How long an agent whose transport dropped (not a deliberate leave) stays
   * present, holding its channels and locks, so it can reconnect with its
   * resume token and pick up the frames it missed. 0 disables.
   */
  presenceGraceMs?: number;
  /** A member that hasn't read a channel for this long is shown as idle, and senders who @mention it are warned. */
  idleAfterMs?: number;
  /**
   * A member that has listened by long-polling GET /v1/events and then has no
   * poll open for this long is announced in its channels as no longer
   * listening (default 5 minutes, under the 10-minute HTTP session expiry; 0 disables).
   */
  listenerGraceMs?: number;
  /**
   * An HTTP session with no long-poll open that has been quiet this long is a
   * leftover (a one-shot CLI run that never logged out, a listener that was
   * killed). It is retired when a session with the same name joins, or starts
   * listening, from the same address, and when the sweep would otherwise
   * announce it as not listening while such a twin is present. Default 10
   * seconds; 0 keeps every session.
   */
  retireTwinsAfterMs?: number;
  /** Token bucket per connection, over every request: burst size and refill per second. */
  rateLimit?: { burst: number; perSecond: number };
  /**
   * Enforce rate limits: the per-connection request bucket, each channel's
   * per-member message rate, and the DM rate. Default true; switch off only
   * on a hub where every client is trusted.
   */
  rateLimits?: boolean;
  locks?: LockManagerOptions;
  /** Persistence hook, called for every channel message (e.g. write to a database). */
  onMessage?: (message: ChannelMessage) => void;
  now?: () => number;
  /**
   * Wake hooks (`wake.set`): 'public' (default) accepts only https URLs whose
   * host is not localhost or a private/link-local IP literal; 'any' accepts
   * http and private hosts too (for a hub on your own machine or LAN); 'off'
   * refuses wake.set.
   */
  webhooks?: 'public' | 'any' | 'off';
  /** How wake hooks are delivered; defaults to the global fetch. Tests inject a stub. */
  fetch?: (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number }>;
  /** The hub's own public address, put in wake payloads so a receiver knows where to reconnect. */
  publicUrl?: string;
}

interface BanState extends Omit<ChannelBan, 'ipCount'> {
  ips: string[];
}

interface WakeState extends WakeHook {
  secret?: string;
  /** Messages since the hook last fired. */
  pending: number;
  /**
   * A wake that came in during the cooldown: sent by the sweep once the
   * cooldown is over, so the last mention is never dropped. A mention or DM
   * outranks a plain message; the newest of equal rank wins.
   */
  deferred?: { reason: WakePayload['reason']; message: { id: string; from: AgentRef; content: string; timestamp: number } };
}

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|::1?|f[cd][0-9a-f]{2}:.*|fe80:.*|::ffff:.*)$/i;

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
  /** SHA-256 of the owner key; the key itself is never stored. */
  ownerKeyHash: Buffer;
  questionsMode: 'on' | 'off';
  /** Open questions by id. */
  questions: Map<string, UserQuestion>;
  /** Messages ever posted here; a message's sequence number is its position in that count. */
  posted: number;
  /** Per member: when it last read, and the sequence number it had read up to. */
  reads: Map<string, { at: number; seq: number }>;
  /** Active and stalled claims by id. */
  claims: Map<string, TaskClaim>;
  /** Fixed at creation. */
  limits: ChannelLimits;
  /** Per member: its message allowance here. */
  senders: Map<string, Bucket>;
  /** Counted semaphores by name. */
  slots: Map<string, SlotState>;
  /** Wake hooks by lowercased agent name. In memory only. */
  wakes: Map<string, WakeState>;
  /** Bans by lowercased name (2.17+); `ips` are kept here only, never shown. */
  bans: Map<string, BanState>;
  /** Approve new members (2.20+): someone new knocks and the owner admits them. */
  approval: boolean;
  /** Passes that let admitted members back in, by SHA-256 (hex) of the pass; the pass itself is never stored. */
  passes: Map<string, PassState>;
  /** Who is waiting to be let in, by agent id. In memory only. */
  knocks: Map<string, { knock: Knock; conn: Connection }>;
}

interface PassState {
  /** The name it was issued to, and every agent id it has let in (so a kick can revoke it). */
  name: string;
  ids: string[];
  at: number;
}

interface SlotState {
  name: string;
  capacity: number;
  holds: SlotHold[];
  waiters: { agentId: string; ttlSeconds?: number }[];
}

/** A token bucket: `burst` at once, refilled at `perSecond`. */
class Bucket {
  private tokens: number;
  private refilledAt: number;

  constructor(private readonly burst: number, private readonly perSecond: number, now: number) {
    this.tokens = burst;
    this.refilledAt = now;
  }

  /** Takes one token, or returns how many ms until one is available. */
  take(now: number): true | number {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.refilledAt) / 1000) * this.perSecond);
    this.refilledAt = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return Math.ceil(((1 - this.tokens) / this.perSecond) * 1000);
  }

  /** True when `count` tokens are available now; takes none. */
  canTake(count: number, now: number): boolean {
    return Math.min(this.burst, this.tokens + ((now - this.refilledAt) / 1000) * this.perSecond) >= count;
  }
}

/**
 * Cuts `text` into parts of at most `max` characters, each prefixed `[i/n] `,
 * breaking at a newline or space near the end of a part when there is one.
 */
export function splitText(text: string, max: number): string[] {
  const prefixRoom = 12; // "[999/999] " plus slack
  const room = Math.max(1, max - prefixRoom);
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > room) {
    let cut = rest.lastIndexOf('\n', room);
    if (cut < room * 0.5) cut = rest.lastIndexOf(' ', room);
    if (cut < room * 0.5) cut = room;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^[ \n]+/, '');
  }
  if (rest) chunks.push(rest);
  return chunks.map((chunk, i) => `[${i + 1}/${chunks.length}] ${chunk}`);
}

/** Channel limits unless the hub or the channel's creator says otherwise. */
const DEFAULT_LIMITS: ChannelLimits = { maxMessageChars: 1000, messagesPerMinute: 120, messageBurst: 30 };

/** Frames kept for a dropped agent before it is evicted instead of resumed. */
const REPLAY_LIMIT = 1000;
/** The address of an agent restored from state saved before hubs kept addresses (2.20): unknown. */
const RESTORED_ADDRESS = 'restored';
/** Agents that can queue for one file with `lock.wait`, or for one slot. */
const MAX_LOCK_WAITERS = 50;
const MAX_SLOTS_PER_CHANNEL = 100;
const MAX_SLOT_CAPACITY = 64;
const SLOT_NAME = /^[A-Za-z0-9._:-]{1,64}$/;

const lockKey = (channel: string, file: string) => `${channel}\u0000${file}`;

interface LockWaiter {
  agentId: string;
  reason: string;
  ttlSeconds?: number;
}

/** What `GET /api/locks/check` returns for a channel the hub has. */
export type LockCheck =
  | { locked: false }
  | {
      locked: true;
      lock: FileLock;
      /** How long the current holder has had it. */
      heldForMs: number;
      /** False while the holder's connection is down (it may still resume). */
      holderConnected: boolean;
      /** When the hub last heard from the holder (ms epoch); missing if the holder has been evicted. */
      holderLastSeenAt?: number;
      /** Agents queued for it with `lock.wait`. */
      waiting: number;
    };

/**
 * A connection's lifecycle. Only these transitions happen (see MeshHub.enter):
 *
 *   pending ──hello──▶ live ──transport drops──▶ parked ──grace ends / leave──▶ closed
 *      │                 │                          │
 *      └──── leaves ─────┴──────── leaves ──────────┴── resumed elsewhere ──▶ closed
 *
 * `pending`: no agent yet, holds a per-address slot. `live`: an agent with a
 * transport. `parked`: the transport is gone but the agent is still present
 * (frames are buffered for a resume); no slot. Restored agents start parked.
 * `closed`: final.
 */
export type ConnectionPhase = 'pending' | 'live' | 'parked' | 'closed';

/**
 * An HTTP agent's listening, tracked from its long-polls:
 *   never ──poll──▶ polling(open) ──last poll ends──▶ idle(since) ──grace passes (sweep)──▶ stopped
 *                      ▲                                  │                                   │
 *                      └───────────── poll ───────────────┴────────────── poll ───────────────┘
 * `stopped` is announced in the agent's channels once; leaving it is announced too.
 */
export type ListenerState =
  | { kind: 'never' }
  | { kind: 'polling'; open: number }
  | { kind: 'idle'; since: number }
  | { kind: 'stopped'; since: number };

const PHASE_MOVES: Record<ConnectionPhase, readonly ConnectionPhase[]> = {
  pending: ['live', 'closed', 'parked'],
  live: ['parked', 'closed'],
  parked: ['closed'],
  closed: []
};

export class Connection {
  agent?: AgentInfo;
  readonly channels = new Set<string>();
  /** @internal Where this connection is in its lifecycle; changed only through MeshHub.enter. */ phase: ConnectionPhase = 'pending';
  /** @internal SHA-256 (hex) of the secret that lets a reconnecting client take over this agent. */ resumeToken?: string;
  /** @internal When it was parked; set exactly while phase is 'parked'. */ droppedAt?: number;
  /** @internal Rebuilt from saved state: never held a per-address slot. */ restored = false;
  /** @internal Frames to send right after a resumed client's welcome. */ replay?: ServerFrame[];
  /** @internal Allowance for DMs this agent sends. */ dms: Bucket;
  /** @internal Set when the connection came in through the public listener with an invite key (#13): it may only use the invite's channel. */ invite?: Invite;
  /** @internal Whether this agent is long-polling GET /v1/events; changed only by pollStarted, pollEnded and sweepListeners. */ listener: ListenerState = { kind: 'never' };
  /** @internal 'http' for a long-poll session (set by the HTTP transport); unset for WebSocket and restored connections. */ transport?: 'http';
  private readonly requests: Bucket;

  constructor(
    public peer: Peer,
    readonly address: string,
    limit: { burst: number; perSecond: number },
    now: number,
    dms: ChannelLimits = DEFAULT_LIMITS
  ) {
    this.requests = new Bucket(limit.burst, limit.perSecond, now);
    this.dms = new Bucket(dms.messageBurst, dms.messagesPerMinute / 60, now);
  }

  /** @internal No longer holds a per-address slot (parked or closed). */
  get released(): boolean {
    return this.phase === 'parked' || this.phase === 'closed';
  }

  get ref(): AgentRef {
    return this.agent!.remote ? { id: this.agent!.id, name: this.agent!.name, remote: true } : { id: this.agent!.id, name: this.agent!.name };
  }

  /** Returns false when the connection has exhausted its rate budget. */
  take(now: number): boolean {
    return this.requests.take(now) === true;
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
  /** `lock.wait` queues, by channel + file, oldest first. Not persisted. */
  private readonly lockQueue = new Map<string, LockWaiter[]>();
  private readonly channels = new Map<string, Channel>(); // address -> channel
  private readonly agents = new Map<string, Connection>(); // agent id -> connection
  private readonly perAddress = new Map<string, number>(); // address -> open connections
  private readonly resumable = new Map<string, Connection>(); // resume token hash -> connection (live or dropped)
  private readonly invites = new Map<string, Invite>(); // key hash -> invite
  private changes = 0;
  private readonly opts: Required<Omit<HubOptions, 'locks' | 'onMessage' | 'now' | 'channelLimits' | 'fetch' | 'publicUrl'>> & { channelLimits: ChannelLimits };
  private readonly deliver: NonNullable<HubOptions['fetch']>;
  private readonly publicUrl: string;
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
      maxMessagesPerMinute: options.maxMessagesPerMinute ?? 600,
      channelLimits: { ...DEFAULT_LIMITS, ...options.channelLimits },
      rateLimits: options.rateLimits ?? true,
      maxQuestionsPerAgent: options.maxQuestionsPerAgent ?? 5,
      maxQuestionsPerChannel: options.maxQuestionsPerChannel ?? 200,
      maxClaimsPerAgent: options.maxClaimsPerAgent ?? 20,
      emptyChannelTtlMs: options.emptyChannelTtlMs ?? 60 * 60 * 1000,
      unusedChannelTtlMs: options.unusedChannelTtlMs ?? 10 * 60 * 1000,
      presenceGraceMs: options.presenceGraceMs ?? 2 * 60 * 1000,
      idleAfterMs: options.idleAfterMs ?? 5 * 60 * 1000,
      listenerGraceMs: options.listenerGraceMs ?? 5 * 60 * 1000,
      retireTwinsAfterMs: options.retireTwinsAfterMs ?? 10_000,
      rateLimit: options.rateLimit ?? { burst: 60, perSecond: 20 },
      webhooks: options.webhooks ?? 'public'
    };
    this.deliver = options.fetch ?? ((url, init) => fetch(url, init));
    this.publicUrl = options.publicUrl ?? '';
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
  connect(peer: Peer, address = 'unknown', options: { inviteKey?: string; transport?: 'http' } = {}): Connection {
    // A remote connection must present a live invite before it takes any slot.
    const invite = options.inviteKey === undefined ? undefined : this.liveInvite(options.inviteKey) ?? fail('unauthorized', 'Missing, expired or revoked invite key');
    const open = this.perAddress.get(address) ?? 0;
    if (open >= this.opts.maxConnectionsPerAddress) fail('rate_limited', 'Too many connections from your address');
    if (this.agents.size >= this.opts.maxAgents) fail('rate_limited', 'Hub is at capacity');
    this.perAddress.set(address, open + 1);
    const conn = new Connection(peer, address, this.opts.rateLimit, this.now(), this.opts.channelLimits);
    conn.invite = invite;
    conn.transport = options.transport;
    return conn;
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
        for (const missed of conn.replay?.splice(0) ?? []) conn.peer.send(missed);
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
    const previous = typeof frame.resume === 'string' && frame.resume ? this.resumable.get(MeshHub.hashToken(frame.resume)) : undefined;
    if (previous?.agent) {
      // A resume never changes which door the agent came in by.
      if (previous.invite?.id !== conn.invite?.id) fail('unauthorized', 'That agent joined with a different invite');
      const agent = this.takeOver(conn, previous);
      return { type: 'welcome', protocol: PROTOCOL_VERSION, agent, serverVersion: SERVER_VERSION, resumeToken: this.issueResumeToken(conn), resumed: true };
    }
    const raw: Record<string, unknown> = isPlainObject(frame.agent) ? frame.agent : {};
    const name = cleanText(raw.name, 64);
    if (!name) fail('bad_request', 'agent.name is required');
    const environments = ['ide', 'terminal', 'bot', 'web'] as const;
    const now = this.now();
    const invite = conn.invite;
    if (invite?.maxAgents !== undefined && invite.agents.length >= invite.maxAgents) {
      fail('quota_exceeded', `This invite admits at most ${invite.maxAgents} agent(s)`);
    }
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
    if (invite) {
      agent.remote = true;
      agent.via = invite.label;
      invite.agents.push(agent.id);
    }
    conn.agent = agent;
    this.agents.set(agent.id, conn);
    this.enter(conn, 'live');
    return { type: 'welcome', protocol: PROTOCOL_VERSION, agent, serverVersion: SERVER_VERSION, resumeToken: this.issueResumeToken(conn) };
  }

  private issueResumeToken(conn: Connection): string {
    const token = crypto.randomBytes(24).toString('base64url');
    conn.resumeToken = MeshHub.hashToken(token);
    this.resumable.set(conn.resumeToken, conn);
    this.changes++;
    return token;
  }

  /** Resume tokens are kept, and saved, only as hashes. */
  static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /** Goes up whenever hub state changes; a persistence layer saves when it moves. */
  get revision(): number {
    return this.changes;
  }

  /**
   * Moves an agent (id, channels, locks) from `previous` onto the new
   * connection and queues the frames it missed. Nobody sees it leave.
   */
  private takeOver(conn: Connection, previous: Connection): AgentInfo {
    this.resumable.delete(previous.resumeToken!);
    const agent = previous.agent!;
    const replay = previous.replay ?? [];
    // The old socket may still be half-open (the client noticed the drop before we did).
    if (previous.phase === 'live') previous.peer.close(4001, 'resumed on another connection');
    for (const id of previous.channels) conn.channels.add(id);
    previous.channels.clear();
    previous.agent = undefined;
    previous.replay = undefined;
    this.enter(previous, 'closed');
    agent.lastSeen = this.now();
    conn.agent = agent;
    conn.replay = replay;
    this.agents.set(agent.id, conn);
    this.enter(conn, 'live');
    return agent;
  }

  /** Removes the agent from every channel, releasing its locks, whether it is live or parked. Safe to call twice. */
  disconnect(conn: Connection): void {
    if (conn.phase === 'closed') return;
    this.evict(conn);
  }

  /**
   * The transport dropped without a deliberate close. Keeps the agent present
   * for `presenceGraceMs`, buffering what it misses, so a reconnect that
   * presents its resume token carries on as if nothing happened.
   */
  drop(conn: Connection): void {
    if (conn.phase !== 'live' || !conn.resumeToken || this.opts.presenceGraceMs <= 0) return this.disconnect(conn);
    this.park(conn, this.now());
  }

  /** Holds a transport-less agent present, buffering what it misses until it resumes or the grace period ends. */
  private park(conn: Connection, at: number): void {
    this.changes++;
    this.enter(conn, 'parked', at);
    const replay: ServerFrame[] = (conn.replay = []);
    conn.peer = {
      send: frame => {
        if (frame.type === 'result' || conn.droppedAt === undefined) return;
        replay.push(frame);
        // Too much to replay faithfully: treat it as a real disconnect.
        if (replay.length === REPLAY_LIMIT) queueMicrotask(() => this.evict(conn));
      },
      close: () => {}
    };
  }

  /**
   * The only place a connection's phase changes. Rejects transitions the
   * lifecycle doesn't have, keeps `droppedAt` set exactly while parked, and
   * frees the per-address slot when a slot-holding connection (pending or
   * live) moves to parked or closed.
   */
  private enter(conn: Connection, next: ConnectionPhase, at?: number): void {
    const from = conn.phase;
    if (from === next) return;
    if (!PHASE_MOVES[from].includes(next)) throw new Error(`connection cannot go from ${from} to ${next}`);
    conn.phase = next;
    conn.droppedAt = next === 'parked' ? at ?? this.now() : undefined;
    const heldSlot = (from === 'pending' || from === 'live') && !conn.restored;
    if (heldSlot && (next === 'parked' || next === 'closed')) {
      const open = (this.perAddress.get(conn.address) ?? 1) - 1;
      if (open > 0) this.perAddress.set(conn.address, open);
      else this.perAddress.delete(conn.address);
    }
  }

  /** Takes the agent out of every channel (they see it leave), forgets it, and closes the connection. */
  private evict(conn: Connection): void {
    if (conn.resumeToken && this.resumable.get(conn.resumeToken) === conn) this.resumable.delete(conn.resumeToken);
    this.enter(conn, 'closed');
    conn.replay = undefined;
    if (!conn.agent) return;
    this.changes++;
    for (const name of [...conn.channels]) this.removeMember(conn, name, 'disconnected');
    for (const channel of this.channels.values()) {
      if (channel.knocks.get(conn.agent.id)?.conn === conn) this.decideKnock(channel, conn.agent.id, null);
    }
    this.agents.delete(conn.agent.id);
    conn.agent = undefined;
  }

  /** Dispatches one request frame and returns its `result` frame. */
  async request(conn: Connection, frame: Record<string, unknown>): Promise<ServerFrame> {
    const id = typeof frame.id === 'string' && frame.id.length <= 128 ? frame.id : '';
    try {
      if (!id) fail('bad_request', 'Requests need a string "id" (max 128 chars)');
      if (!conn.agent) fail('not_registered', 'Send "hello" first');
      if (this.opts.rateLimits && !conn.take(this.now())) fail('rate_limited', 'Too many requests; slow down');
      // One-line addresses (xtl_…, xt_…@hub) name the hub too; this hub only needs the id.
      if (typeof frame.channel === 'string') frame = { ...frame, channel: channelId(frame.channel) ?? frame.channel };
      if (conn.invite) this.checkRemote(conn, frame as unknown as RequestFrame);
      conn.agent!.lastSeen = this.now();
      this.changes++;
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
      case 'channel.create': return this.createChannel(conn, f.name, f.topic, f.visibility, f.limits, f.approval);
      case 'channel.join': return this.joinChannel(conn, f.channel, f.since, f.pass, f.ownerKey);
      case 'member.admit': return this.admitMember(conn, f.channel, f.ownerKey, f.agent, f.allow === true);
      case 'member.knocks': return this.listKnocks(conn, f.channel, f.ownerKey);
      case 'channel.leave': return this.leaveChannel(conn, f.channel);
      case 'channel.list': return this.listChannels(conn, conn.invite ? 'joined' : f.scope ?? 'joined', f.limit, f.cursor);
      case 'invite.create': return this.createInvite(conn, f.channel, f.ownerKey, f.label, f.expiresInSeconds, f.maxAgents);
      case 'invite.list': return { invites: this.listInvites(conn, f.channel, f.ownerKey) };
      case 'invite.revoke': return this.revokeInvites(conn, f.channel, f.ownerKey, f.invite);
      case 'channel.state': {
        const channel = this.memberChannel(conn, f.channel);
        this.markRead(channel, conn.agent!.id);
        return this.snapshot(channel, f.since);
      }
      case 'channel.read': return this.readChannel(conn, f.channel, f.upTo);
      case 'channel.close': return this.closeChannel(conn, f.channel, f.ownerKey);
      case 'channel.receipts': return { receipts: this.receipts(this.memberChannel(conn, f.channel), f.limit) };
      case 'claim.create': return this.createClaim(conn, f.channel, f.task, f.everySeconds, f.paths);
      case 'claim.update': return this.updateClaims(conn, f.channel, f.claim, f.note, f.status);
      case 'message.send': return this.postMessage(conn, f.channel, f.content ?? f.text, f.metadata, f.split === true);
      case 'shorthand.send': return this.postShorthand(conn, f.channel, f.shorthand);
      case 'dm.send': return this.sendDirect(conn, f.to, f.content ?? f.text, f.replyExpected, f.metadata);
      case 'lock.acquire': return this.acquireLock(conn, f.channel, f.file, f.reason, f.ttlSeconds);
      case 'lock.release': return this.releaseLock(conn, f.channel, f.file);
      case 'lock.wait': return this.waitLock(conn, f.channel, f.file, f.reason, f.ttlSeconds);
      case 'slot.acquire': return this.acquireSlot(conn, f.channel, f.name, f.capacity, f.ttlSeconds);
      case 'slot.release': return this.releaseSlot(conn, f.channel, f.name);
      case 'status.update': return this.updateStatus(conn, f.status, f.currentTask);
      case 'question.ask': return this.askQuestion(conn, f.channel, f.question, f.options);
      case 'question.cancel': return this.cancelQuestion(conn, f.channel, f.question);
      case 'question.answer': return this.answerQuestion(conn, f.channel, f.question, f.answer, f.ownerKey);
      case 'channel.configure': return this.configureChannel(conn, f.channel, f.ownerKey, f.questions, f.approval);
      case 'member.kick': return this.kickMember(conn, f.channel, f.ownerKey, f.agent, f.ban === true, f.ip === true, f.reason);
      case 'member.unban': {
        const channel = this.memberChannel(conn, f.channel);
        this.requireOwner(channel, f.ownerKey);
        const key = cleanText(f.agent, 128).toLowerCase();
        let unbanned = 0;
        const ip = key.startsWith('ip:') ? key.slice(3) : undefined;
        for (const [name, ban] of [...channel.bans]) {
          if (name === key || ban.ids.includes(cleanText(f.agent, 128)) || (ip && ban.ips.includes(ip))) { channel.bans.delete(name); unbanned++; }
        }
        if (unbanned) this.changes++;
        return { channel: channel.id, unbanned };
      }
      case 'member.bans': {
        const channel = this.memberChannel(conn, f.channel);
        this.requireOwner(channel, f.ownerKey);
        return { channel: channel.id, bans: [...channel.bans.values()].map(({ ips, ...b }) => ({ ...b, ids: [...b.ids], ipCount: ips.length })) };
      }
      case 'wake.set': return this.setWake(conn, f.channel, f.url, f.on, f.secret, f.cooldownSeconds);
      case 'wake.clear': {
        const channel = this.memberChannel(conn, f.channel);
        const cleared = channel.wakes.delete(conn.agent!.name.toLowerCase());
        if (cleared) this.changes++;
        return { channel: channel.id, cleared };
      }
      case 'wake.get': {
        const hook = this.memberChannel(conn, f.channel).wakes.get(conn.agent!.name.toLowerCase());
        return { hook: hook ? this.wakeView(hook) : null };
      }
      default: return fail('bad_request', `Unknown request type "${(f as { type: string }).type}"`);
    }
  }

  // -------------------------------------------------------------------------
  // Channels
  // -------------------------------------------------------------------------

  static isAddress(value: unknown): value is string {
    return isAnyAddress(value);
  }

  /** The channel an address names, in any form (`xt_…`, `xtl_…`, `xt_…@hub`); see src/address.ts. */
  private channelAt(address: unknown): Channel | undefined {
    const id = channelId(address);
    return id ? this.channels.get(id) : undefined;
  }

  /** Creates a conversation with a fresh, unguessable address and joins the creator to it. */
  private createChannel(conn: Connection, rawName: unknown, topic: unknown, visibility: unknown, limits: unknown, approval?: unknown): CreatedChannel {
    if (visibility !== undefined && visibility !== 'public' && visibility !== 'private') {
      fail('bad_request', 'visibility must be "public" or "private"');
    }
    const fixed = this.channelLimits(limits);
    if (this.channels.size >= this.opts.maxChannels) fail('quota_exceeded', 'Hub channel limit reached');
    let fromAddress = 0;
    for (const c of this.channels.values()) if (c.createdFrom === conn.address) fromAddress++;
    if (fromAddress >= this.opts.maxChannelsPerAddress) {
      fail('quota_exceeded', `At most ${this.opts.maxChannelsPerAddress} live channels per network address`);
    }
    this.ensureRoom(conn);

    const now = this.now();
    const ownerKey = `xk_${crypto.randomBytes(24).toString('base64url')}`;
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
      history: [],
      ownerKeyHash: MeshHub.hashKey(ownerKey),
      questionsMode: 'on',
      questions: new Map(),
      posted: 0,
      reads: new Map(),
      claims: new Map(),
      slots: new Map(),
      wakes: new Map(),
      bans: new Map(),
      limits: fixed,
      senders: new Map(),
      approval: approval === true,
      passes: new Map(),
      knocks: new Map()
    };
    this.channels.set(channel.id, channel);
    this.addMember(conn, channel);
    // The creator holds the owner key, and gets a pass too so a plain rejoin works.
    const pass = channel.approval ? this.issuePass(channel, conn.agent!) : undefined;
    return { ...this.snapshot(channel), ownerKey, ...(pass ? { pass } : {}), guidance: STAY_AWAKE_GUIDANCE };
  }

  private joinChannel(conn: Connection, address: unknown, since?: unknown, pass?: unknown, ownerKey?: unknown): ChannelSnapshot {
    const channel = this.channelAt(address);
    if (!channel) return fail('not_found', 'No conversation at that address');
    if (!channel.members.has(conn.agent!.id)) {
      if (this.isBanned(channel, conn.agent!) || this.isBannedAddress(channel, conn.address)) {
        fail('forbidden', "The channel's owner removed you from this conversation");
      }
      if (channel.members.size >= this.opts.maxMembersPerChannel) fail('quota_exceeded', 'Channel is full');
      // Approval on: only the owner key or a pass gets straight in; anyone else knocks and waits.
      if (channel.approval && !this.isOwnerKey(channel, ownerKey) && !this.usePass(channel, pass, conn.agent!)) {
        this.knock(channel, conn);
        fail('pending_approval', "This channel approves new members: you're waiting for the host to let you in. Stay connected; when you're admitted you'll get channel.admitted with a pass, then join again with it.");
      }
      this.ensureRoom(conn);
      this.addMember(conn, channel);
      // A knock left over from before (say, it reconnected with a pass): it's in now, so the owner stops seeing it wait.
      const waiting = channel.knocks.get(conn.agent!.id);
      if (waiting) {
        channel.knocks.delete(conn.agent!.id);
        this.emit(channel, { type: 'channel.knock', channel: channel.id, knock: { ...waiting.knock, status: 'admitted' } });
      }
      this.retireTwins(conn, [channel.id]);
    }
    this.markRead(channel, conn.agent!.id);
    return { ...this.snapshot(channel, since), guidance: STAY_AWAKE_GUIDANCE };
  }

  private leaveChannel(conn: Connection, address: unknown): { channel: string } {
    const channel = this.memberChannel(conn, address);
    this.removeMember(conn, channel.id, 'left');
    return { channel: channel.id };
  }

  /** Ends the conversation for everyone. Members are told, then removed; locks and open questions go with it. */
  private isBanned(channel: Channel, agent: AgentInfo): boolean {
    if (!channel.bans.size) return false;
    if (channel.bans.has(agent.name.toLowerCase())) return true;
    for (const ban of channel.bans.values()) if (ban.ids.includes(agent.id)) return true;
    return false;
  }

  private isBannedAddress(channel: Channel, address: string): boolean {
    for (const ban of channel.bans.values()) if (ban.ips.includes(address)) return true;
    return false;
  }

  /**
   * The owner removes members by id or name. Each is told (`channel.kicked`)
   * before it leaves; the rest see `member.left` with reason `kicked`. With
   * `ban`, their ids and name are refused on rejoin.
   */
  private kickMember(conn: Connection, address: unknown, ownerKey: unknown, agent: unknown, ban: boolean, byIp: boolean, reason: unknown): ResultData['member.kick'] {
    const channel = this.memberChannel(conn, address);
    this.requireOwner(channel, ownerKey);
    const key = cleanText(agent, 128);
    if (!key) fail('bad_request', 'agent (an id, a name, or ip:<address>) is required');
    const why = cleanText(reason, 280) || undefined;
    if (key.startsWith('ip:')) {
      // Ban an address directly, and remove whoever is here from it.
      const ip = key.slice(3).trim();
      if (!ip || ip === conn.address) fail('bad_request', ip ? "That's your own address" : 'ip:<address> needs an address');
      const here = [...channel.members].map(id => this.agents.get(id)).filter((c): c is Connection => !!c?.agent && c.address === ip);
      const kicked: AgentRef[] = [];
      for (const target of here) {
        kicked.push(target.ref);
        target.peer.send({ type: 'channel.kicked', channel: channel.id, by: conn.ref, reason: why, banned: true });
        this.removeMember(target, channel.id, 'kicked');
      }
      channel.bans.set(key.toLowerCase(), { name: key, ids: [], ips: [ip], at: this.now(), by: conn.ref, reason: why });
      this.changes++;
      return { channel: channel.id, kicked, banned: true };
    }
    if (byIp && !ban) fail('bad_request', 'ip bans need ban: true');
    const targets = [...channel.members]
      .map(id => this.agents.get(id))
      .filter((c): c is Connection => !!c?.agent && (c.agent.id === key || c.agent.name.toLowerCase() === key.toLowerCase()));
    if (targets.some(t => t === conn)) fail('bad_request', "You can't kick yourself; leave the channel instead");
    if (!targets.length && !ban) fail('not_found', `No member called ${key} here`);
    const kicked: AgentRef[] = [];
    // Never ban the owner's own address, even if the target shares it.
    const addresses = byIp ? targets.map(t => t.address).filter(a => a && a !== conn.address && a !== RESTORED_ADDRESS) : [];
    for (const target of targets) {
      kicked.push(target.ref);
      target.peer.send({ type: 'channel.kicked', channel: channel.id, by: conn.ref, reason: why, banned: ban });
      this.removeMember(target, channel.id, 'kicked');
      this.revokePasses(channel, target.agent!);
    }
    if (ban) {
      const name = targets[0]?.agent!.name ?? key;
      const existing = channel.bans.get(name.toLowerCase());
      const ids = new Set([...(existing?.ids ?? []), ...targets.map(t => t.agent!.id), ...(key.startsWith('ag_') ? [key] : [])]);
      const ips = new Set([...(existing?.ips ?? []), ...addresses]);
      channel.bans.set(name.toLowerCase(), { name, ids: [...ids], ips: [...ips], at: this.now(), by: conn.ref, reason: why });
    }
    this.changes++;
    return { channel: channel.id, kicked, banned: ban };
  }

  private closeChannel(conn: Connection, address: unknown, ownerKey: unknown): { channel: string } {
    const channel = this.memberChannel(conn, address);
    this.requireOwner(channel, ownerKey);
    for (const q of [...channel.questions.values()]) this.closeQuestion(channel, q, 'cancelled');
    this.emit(channel, { type: 'channel.closed', channel: channel.id, by: conn.ref });
    for (const id of channel.members) this.agents.get(id)?.channels.delete(channel.id);
    channel.members.clear();
    this.deleteChannel(channel);
    return { channel: channel.id };
  }

  private ensureRoom(conn: Connection): void {
    if (conn.channels.size >= this.opts.maxChannelsPerAgent) {
      fail('quota_exceeded', `An agent can be in at most ${this.opts.maxChannelsPerAgent} channels`);
    }
  }

  private addMember(conn: Connection, channel: Channel): void {
    channel.members.add(conn.agent!.id);
    channel.reads.set(conn.agent!.id, { at: this.now(), seq: channel.posted });
    channel.emptySince = undefined;
    conn.channels.add(channel.id);
    if (this.visible(conn.agent!.id)) this.emit(channel, { type: 'member.joined', channel: channel.id, agent: conn.agent! }, conn.agent!.id);
  }

  private removeMember(conn: Connection, id: string, reason: 'left' | 'disconnected' | 'kicked'): void {
    const channel = this.channels.get(id);
    conn.channels.delete(id);
    if (!channel) return;
    channel.members.delete(conn.agent!.id);
    channel.reads.delete(conn.agent!.id);

    // Nobody is left to receive the answer.
    for (const q of [...channel.questions.values()]) {
      if (q.from.id === conn.agent!.id) this.closeQuestion(channel, q, 'cancelled');
    }
    for (const claim of [...channel.claims.values()]) {
      if (claim.owner.id === conn.agent!.id) this.closeClaim(channel, claim, 'dropped');
    }
    for (const lock of this.locks.releaseAllBy(conn.agent!.id, id)) {
      this.emit(channel, { type: 'lock.released', channel: id, file: lock.file, by: conn.ref, reason: 'disconnected' });
    }
    this.dropWaits(conn.agent!.id, id);
    this.pumpLockQueues();
    this.dropSlotsOf(channel, conn.agent!.id);
    if (this.visible(conn.agent!.id)) this.emit(channel, { type: 'member.left', channel: id, agent: conn.ref, reason });
    if (channel.members.size === 0) channel.emptySince = this.now();
  }

  /** Members named as `@name` (any case, ending at a non-name character). */
  private mentioned(channel: Channel, text: string): AgentRef[] {
    if (!text.includes('@')) return [];
    const lower = text.toLowerCase();
    const out: AgentRef[] = [];
    for (const id of channel.members) {
      const agent = this.agents.get(id)?.agent;
      if (!agent || !this.visible(id)) continue;
      const tag = '@' + agent.name.toLowerCase();
      for (let at = lower.indexOf(tag); at >= 0; at = lower.indexOf(tag, at + 1)) {
        if (!/[\p{L}\p{N}_-]/u.test(lower[at + tag.length] ?? '')) {
          out.push({ id: agent.id, name: agent.name });
          break;
        }
      }
    }
    return out;
  }

  /** The hub's defaults, overridden by what the creator asked for within the hub's ceilings. */
  private channelLimits(asked: unknown): ChannelLimits {
    if (asked !== undefined && !isPlainObject(asked)) fail('bad_request', 'limits must be an object');
    const want = (asked ?? {}) as Record<string, unknown>;
    const pick = (key: keyof ChannelLimits, max: number): number => {
      const value = want[key];
      if (value === undefined) return Math.min(this.opts.channelLimits[key], max);
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
        return fail('bad_request', `limits.${key} must be a whole number from 1 to ${max} on this hub`);
      }
      return value;
    };
    return {
      maxMessageChars: pick('maxMessageChars', this.opts.maxMessageChars),
      messagesPerMinute: pick('messagesPerMinute', this.opts.maxMessagesPerMinute),
      messageBurst: pick('messageBurst', 1000)
    };
  }

  /** Charges one message to `conn` in `channel`, or fails with when it may post again. */
  private spend(channel: Channel, conn: Connection): void {
    if (!this.opts.rateLimits) return;
    const id = conn.agent!.id;
    let bucket = channel.senders.get(id);
    if (!bucket) channel.senders.set(id, (bucket = new Bucket(channel.limits.messageBurst, channel.limits.messagesPerMinute / 60, this.now())));
    const waited = bucket.take(this.now());
    if (waited !== true) {
      fail('rate_limited', `This channel allows ${channel.limits.messagesPerMinute} messages a minute per member (bursts of ${channel.limits.messageBurst}); try again in ${Math.ceil(waited / 1000)}s`, { retryAfterMs: waited });
    }
  }

  private deleteChannel(channel: Channel): void {
    this.channels.delete(channel.id);
    this.locks.releaseChannel(channel.id);
    for (const key of [...this.lockQueue.keys()]) if (key.startsWith(channel.id + '\u0000')) this.lockQueue.delete(key);
  }

  private memberChannel(conn: Connection, address: unknown): Channel {
    const channel = this.channelAt(address);
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
      memberCount: this.visibleMembers(channel).length,
      maxMembers: this.opts.maxMembersPerChannel,
      questions: channel.questionsMode,
      limits: channel.limits,
      approval: channel.approval
    };
  }

  private snapshot(channel: Channel, since?: unknown): ChannelSnapshot {
    const history = channel.history.slice(-this.opts.historyLimit);
    const seen = typeof since === 'string' ? history.findIndex(m => m.id === since) : -1;
    return {
      channel: this.info(channel),
      members: this.visibleMembers(channel).map(id => this.agents.get(id)?.agent).filter((a): a is AgentInfo => !!a),
      locks: this.locks.list(channel.id),
      attention: this.visibleMembers(channel).map(id => this.attention(channel, id)).filter((a): a is MemberAttention => !!a),
      messages: seen >= 0 ? history.slice(seen + 1) : history,
      questions: [...channel.questions.values()],
      claims: [...channel.claims.values()].map(c => ({ ...c })),
      slots: [...channel.slots.values()].map(slot => this.slotView(channel, slot))
    };
  }

  // -------------------------------------------------------------------------
  // Attention: who is actually reading, not just connected
  // -------------------------------------------------------------------------

  /** Records that a member has seen the channel, up to message `upTo` or everything so far. */
  private markRead(channel: Channel, agentId: string, upTo?: unknown): void {
    const read = channel.reads.get(agentId);
    if (!read) return;
    let seq = channel.posted;
    if (typeof upTo === 'string') {
      const at = channel.history.findIndex(m => m.id === upTo);
      if (at >= 0) seq = channel.posted - channel.history.length + 1 + at;
    }
    read.at = this.now();
    read.seq = Math.max(read.seq, seq);
  }

  private readChannel(conn: Connection, address: unknown, upTo: unknown): MemberAttention {
    const channel = this.memberChannel(conn, address);
    this.markRead(channel, conn.agent!.id, upTo);
    return this.attention(channel, conn.agent!.id)!;
  }

  /**
   * An HTTP session long-polling for events is a process that is reading
   * (a `crosstalk wait`, a curl loop): it counts as reading all its channels.
   */
  polled(conn: Connection): void {
    if (!conn.agent) return;
    for (const id of conn.channels) {
      const channel = this.channels.get(id);
      if (channel) this.markRead(channel, conn.agent.id);
    }
  }

  /** An HTTP long-poll opened: the agent is listening. Announces a return after a stopped-listener notice. */
  pollStarted(conn: Connection): void {
    const was = conn.listener;
    conn.listener = { kind: 'polling', open: was.kind === 'polling' ? was.open + 1 : 1 };
    this.polled(conn);
    if (was.kind !== 'polling') this.retireTwins(conn);
    if (was.kind === 'stopped' && conn.agent) this.listenerNotice(conn, `${conn.agent.name} is listening again.`);
  }

  /** An HTTP long-poll ended (events returned or it timed out). */
  pollEnded(conn: Connection): void {
    const was = conn.listener;
    if (was.kind !== 'polling') return; // an end without a start: nothing was open
    conn.listener = was.open > 1 ? { kind: 'polling', open: was.open - 1 } : { kind: 'idle', since: this.now() };
    this.polled(conn);
  }

  /** undefined for members that never long-polled (WebSocket and MCP clients). */
  private isListening(conn: Connection): boolean | undefined {
    const l = conn.listener;
    switch (l.kind) {
      case 'never': return undefined;
      case 'polling': return true;
      case 'idle': return this.now() - l.since < this.opts.listenerGraceMs;
      case 'stopped': return false;
    }
  }

  /** Posts a hub notice in every channel the agent is in. */
  private listenerNotice(conn: Connection, text: string): void {
    for (const id of conn.channels) {
      const channel = this.channels.get(id);
      if (!channel) continue;
      const message: ChannelMessage = {
        id: newId('msg'),
        channel: channel.id,
        kind: 'notice',
        from: { id: 'hub', name: 'hub' },
        content: text,
        timestamp: this.now()
      };
      channel.posted++;
      channel.history.push(message);
      if (channel.history.length > this.opts.historyLimit) channel.history.shift();
      this.changes++;
      this.emit(channel, { type: 'message', message });
    }
  }

  /**
   * After a restart onto a newer CrossTalk: posts a notice in every channel
   * saying what the hub was and is now, where the changes are listed and how
   * clients update. Every client sees it, whatever it runs (CLI, MCP, HTTP,
   * SDKs, devices), because it is an ordinary channel message.
   */
  announceUpdate(previous: string | undefined, installUrl: string, changelogUrl: string): number {
    const text = `CrossTalk hub updated${previous ? ` from ${previous}` : ''} to ${SERVER_VERSION}. What's new: ${changelogUrl}. If you use the crosstalk CLI or crosstalk-mcp, update with \`crosstalk update\` (or npm install -g ${installUrl}) and restart your listener. HTTP agents: nothing to install; re-create your session if it expired.`;
    let posted = 0;
    for (const channel of this.channels.values()) {
      const message: ChannelMessage = { id: newId('msg'), channel: channel.id, kind: 'notice', from: { id: 'hub', name: 'hub' }, content: text, timestamp: this.now() };
      channel.posted++;
      channel.history.push(message);
      if (channel.history.length > this.opts.historyLimit) channel.history.shift();
      this.emit(channel, { type: 'message', message });
      posted++;
    }
    if (posted) this.changes++;
    return posted;
  }

  /** Announces members whose listener has stopped (called from sweep). */
  private sweepListeners(): void {
    if (!this.opts.listenerGraceMs) return;
    const now = this.now();
    for (const conn of new Set(this.agents.values())) {
      const l = conn.listener;
      if (!conn.agent || l.kind !== 'idle' || now - l.since < this.opts.listenerGraceMs) continue;
      // Its client is here under a newer session: this one is a leftover, not an agent gone quiet.
      if (this.presentTwin(conn)) {
        this.retire(conn);
        continue;
      }
      conn.listener = { kind: 'stopped', since: now };
      const minutes = Math.round(this.opts.listenerGraceMs / 60_000);
      this.listenerNotice(conn, `${conn.agent.name} has not been listening for ${minutes}+ minute${minutes === 1 ? '' : 's'} (no open GET /v1/events). @mention them or check on them; they may not see new messages.`);
    }
  }

  /**
   * Whether `conn` is a leftover session of the client that `twin` is: the
   * same name from the same address, holding nothing (locks, claims, slot
   * places, open questions), not remote, and either
   * - over HTTP with no long-poll open, quiet for `retireTwinsAfterMs`: each
   *   `crosstalk send`, `history` or `wait` run that doesn't log out leaves
   *   such a session behind; or
   * - parked: its transport dropped (or the hub restarted) and the client
   *   came back as a new agent instead of resuming.
   * The newer session is the one its user is actually driving.
   */
  private isLeftoverOf(conn: Connection, twin: Connection, now: number): boolean {
    if (!this.opts.retireTwinsAfterMs || conn === twin || !conn.agent || !twin.agent) return false;
    if (conn.invite || twin.invite || conn.address !== twin.address || conn.address === RESTORED_ADDRESS) return false;
    if (conn.agent.name.toLowerCase() !== twin.agent.name.toLowerCase()) return false;
    if (conn.phase === 'parked') return twin.phase === 'live' && !this.holdsWork(conn);
    if (conn.transport !== 'http' || conn.phase !== 'live' || conn.listener.kind === 'polling') return false;
    if (now - this.lastHeard(conn) < this.opts.retireTwinsAfterMs) return false;
    return !this.holdsWork(conn);
  }

  /** When an HTTP session was last heard from: its last request, or the end of its last long-poll. */
  private lastHeard(conn: Connection): number {
    const l = conn.listener;
    return Math.max(conn.agent?.lastSeen ?? 0, l.kind === 'idle' || l.kind === 'stopped' ? l.since : 0);
  }

  /** Locks, open claims, slot places or open questions: a session holding any is kept, whatever its name. */
  private holdsWork(conn: Connection): boolean {
    const me = conn.agent!.id;
    if (this.locks.byHolder(me).length) return true;
    for (const id of conn.channels) {
      const channel = this.channels.get(id);
      if (!channel) continue;
      for (const claim of channel.claims.values()) if (claim.owner.id === me && (claim.status === 'active' || claim.status === 'stalled')) return true;
      for (const q of channel.questions.values()) if (q.from.id === me) return true;
      for (const slot of channel.slots.values()) if (slot.holds.some(h => h.holder.id === me)) return true;
    }
    return false;
  }

  /**
   * Retires the leftover sessions of `conn`'s client (see isLeftoverOf) in
   * the given channels. Called when `conn` joins a channel or starts listening,
   * so a name stays one member however many CLI runs it has had.
   */
  private retireTwins(conn: Connection, channels: Iterable<string> = conn.channels): void {
    if (!this.opts.retireTwinsAfterMs || !conn.agent) return;
    const now = this.now();
    const gone = new Set<Connection>();
    for (const id of channels) {
      const channel = this.channels.get(id);
      if (!channel) continue;
      for (const member of [...channel.members]) {
        const other = this.agents.get(member);
        if (!other || gone.has(other) || !this.isLeftoverOf(other, conn, now)) continue;
        gone.add(other);
        this.retire(other);
      }
    }
  }

  /**
   * A session of `conn`'s client (same name, same address) that is present
   * (listening, or connected over WebSocket) in one of `conn`'s channels, if
   * `conn` is a leftover of it.
   */
  private presentTwin(conn: Connection): Connection | undefined {
    const now = this.now();
    for (const id of conn.channels) {
      const channel = this.channels.get(id);
      if (!channel) continue;
      for (const member of channel.members) {
        const other = this.agents.get(member);
        if (!other || !this.isLeftoverOf(conn, other, now)) continue;
        if (this.isListening(other) === true || (other.transport !== 'http' && other.phase === 'live')) return other;
      }
    }
    return undefined;
  }

  /**
   * Ends a leftover session. Its channels see it leave as `disconnected`, and
   * its HTTP session closes, so the client's next request gets 401 and it
   * registers afresh instead of driving a dead agent.
   */
  private retire(conn: Connection): void {
    if (conn.phase === 'closed') return;
    conn.peer.close(4003, 'replaced by a newer session with the same name');
    this.disconnect(conn);
  }

  /** Per message: which members have read it. Newest last. */
  private receipts(channel: Channel, limit?: unknown): MessageReceipt[] {
    const size = Math.max(1, Math.min(typeof limit === 'number' ? Math.floor(limit) : 20, 100));
    const first = channel.posted - channel.history.length + 1;
    const start = Math.max(0, channel.history.length - size);
    return channel.history.slice(start).map((m, i) => {
      const seq = first + start + i;
      const receipt: MessageReceipt = { message: m.id, from: m.from, timestamp: m.timestamp, readBy: [], unreadBy: [] };
      for (const [id, read] of channel.reads) {
        const conn = this.agents.get(id);
        if (!conn?.agent || id === m.from.id) continue;
        const ref = { id, name: conn.agent.name };
        if (read.seq >= seq) receipt.readBy.push(ref);
        else receipt.unreadBy.push({ agent: ref, connected: conn.droppedAt === undefined });
      }
      return receipt;
    });
  }

  /** Read-only receipts for HTTP observers. Knowing the address is the capability. */
  receiptsByAddress(address: string, limit?: number): MessageReceipt[] | undefined {
    const channel = this.channelAt(address);
    return channel ? this.receipts(channel, limit) : undefined;
  }

  private attention(channel: Channel, agentId: string): MemberAttention | undefined {
    const conn = this.agents.get(agentId);
    const read = channel.reads.get(agentId);
    if (!conn?.agent || !read) return undefined;
    const first = channel.posted - channel.history.length + 1;
    const pending = channel.history.filter((m, i) => first + i > read.seq && m.from.id !== agentId);
    const out: MemberAttention = {
      agent: { id: agentId, name: conn.agent.name },
      connected: conn.droppedAt === undefined,
      lastReadAt: read.at,
      unread: pending.length,
      idle: this.now() - read.at >= this.opts.idleAfterMs
    };
    const listening = this.isListening(conn);
    if (listening !== undefined) out.listening = listening;
    if (pending.length) out.oldestUnreadAt = pending[0].timestamp;
    return out;
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
  snapshotByAddress(address: string, since?: string): ChannelSnapshot | undefined {
    const channel = this.channelAt(address);
    return channel ? this.snapshot(channel, since) : undefined;
  }

  /** Lock lookup for editor hooks. */
  checkLock(address: string, rawFile: string): LockCheck | undefined {
    const channel = this.channelAt(address);
    if (!channel) return undefined;
    const file = LockManager.normalizePath(rawFile);
    const lock = this.locks.get(channel.id, file);
    if (!lock) return { locked: false };
    const holder = this.agents.get(lock.holder.id);
    return {
      locked: true,
      lock,
      heldForMs: Math.max(0, this.now() - lock.acquiredAt),
      holderConnected: !!holder && holder.droppedAt === undefined,
      holderLastSeenAt: holder?.agent?.lastSeen,
      waiting: this.lockQueue.get(lockKey(channel.id, file))?.length ?? 0
    };
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

  /** `max`: the channel's limit, or the hub's ceiling for DMs. */
  private messageText(content: unknown, max = this.opts.maxMessageChars): string {
    if (typeof content !== 'string' || !content.trim()) fail('bad_request', 'content must be a non-empty string');
    const text = content as string;
    if (text.length > max) {
      fail('bad_request', `Message is ${text.length} characters; this ${max === this.opts.maxMessageChars ? 'hub' : 'channel'} allows ${max}. Say it more briefly, split it, or point to a file.`, { maxMessageChars: max });
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
    const mentions = this.mentioned(channel, message.shorthand?.raw ?? message.content);
    if (mentions.length) message.mentions = mentions;
    // A progress post is a heartbeat on the sender's claims here.
    this.heartbeat(channel, sender.agent!.id);
    channel.posted++;
    channel.history.push(message);
    if (channel.history.length > this.opts.historyLimit) channel.history.shift();
    channel.lastActivity = message.timestamp;
    this.emit(channel, { type: 'message', message }, sender.agent!.id);
    this.fireWakes(channel, message);
    try {
      this.onMessage?.(message);
    } catch (err) {
      console.error('[crosstalk] onMessage hook failed:', err);
    }
    const idle = (mentions ?? [])
      .map(m => this.attention(channel, m.id))
      .filter((a): a is MemberAttention => !!a && (a.idle || !a.connected));
    // A copy, so the warning goes back to the sender only and never into history.
    return idle.length ? { ...message, idleMentions: idle } : message;
  }

  private postMessage(conn: Connection, address: unknown, content: unknown, metadata: unknown, split = false): ChannelMessage {
    const channel = this.memberChannel(conn, address);
    const max = channel.limits.maxMessageChars;
    if (split && typeof content === 'string' && content.length > max) {
      return this.postSplit(conn, channel, content, metadata);
    }
    const text = this.messageText(content, max);
    this.spend(channel, conn);
    const message: ChannelMessage = {
      id: newId('msg'),
      channel: channel.id,
      kind: 'chat',
      from: conn.ref,
      content: text,
      timestamp: this.now()
    };
    const meta = this.metadata(metadata);
    if (meta) message.metadata = meta;
    return this.record(channel, message, conn);
  }

  /**
   * Posts text over the channel limit as numbered parts. Every part is checked
   * against the sender's message allowance before any is posted, so a long
   * text is never left half-sent by the rate limit.
   */
  private postSplit(conn: Connection, channel: Channel, content: string, metadata: unknown): ChannelMessage {
    const max = channel.limits.maxMessageChars;
    if (content.length > this.opts.maxMessageChars * 8) {
      fail('bad_request', `Message is ${content.length} characters; split posts allow up to ${this.opts.maxMessageChars * 8}. Point to a file instead.`);
    }
    const meta = this.metadata(metadata);
    const parts = splitText(content, max);
    if (this.opts.rateLimits) {
      const id = conn.agent!.id;
      let bucket = channel.senders.get(id);
      if (!bucket) channel.senders.set(id, (bucket = new Bucket(channel.limits.messageBurst, channel.limits.messagesPerMinute / 60, this.now())));
      if (!bucket.canTake(parts.length, this.now())) {
        fail('rate_limited', `Splitting this message needs ${parts.length} posts; your allowance here is lower right now. Wait and retry, or send less.`, { parts: parts.length });
      }
    }
    let first: ChannelMessage | undefined;
    parts.forEach((text, i) => {
      this.spend(channel, conn);
      const message: ChannelMessage = {
        id: newId('msg'),
        channel: channel.id,
        kind: 'chat',
        from: conn.ref,
        content: text,
        timestamp: this.now()
      };
      if (meta) message.metadata = { ...meta, part: i + 1, parts: parts.length };
      else message.metadata = { part: i + 1, parts: parts.length };
      const recorded = this.record(channel, message, conn);
      first ??= recorded;
    });
    return { ...first!, parts: parts.length };
  }

  // -------------------------------------------------------------------------
  // Wake hooks
  // -------------------------------------------------------------------------

  private setWake(conn: Connection, address: unknown, url: unknown, on: unknown, secret: unknown, cooldown: unknown): WakeHook {
    const channel = this.memberChannel(conn, address);
    if (this.opts.webhooks === 'off') fail('forbidden', 'Wake hooks are switched off on this hub');
    if (conn.invite) fail('forbidden', 'Agents that joined with a remote invite cannot register wake hooks');
    if (typeof url !== 'string' || url.length > 2048) fail('bad_request', 'url must be a string of at most 2048 characters');
    let parsed: URL;
    try {
      parsed = new URL(url as string);
    } catch {
      return fail('bad_request', 'url is not a valid URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') fail('bad_request', 'url must be http(s)');
    if (parsed.username || parsed.password) fail('bad_request', 'url must not contain credentials; use secret to sign requests');
    if (this.opts.webhooks === 'public') {
      if (parsed.protocol !== 'https:') fail('bad_request', 'This hub only calls https wake hooks');
      const host = parsed.hostname.replace(/^\[|\]$/g, '');
      if (PRIVATE_HOST.test(host)) fail('bad_request', 'This hub does not call local or private addresses');
    }
    if (on !== undefined && on !== 'mentions' && on !== 'all') fail('bad_request', 'on must be "mentions" or "all"');
    if (secret !== undefined && (typeof secret !== 'string' || secret.length < 8 || secret.length > 256)) {
      fail('bad_request', 'secret must be 8 to 256 characters');
    }
    const cooldownSeconds = cooldown === undefined ? 30 : Math.round(Number(cooldown));
    if (!Number.isFinite(cooldownSeconds) || cooldownSeconds < 5 || cooldownSeconds > 3600) {
      fail('bad_request', 'cooldownSeconds must be between 5 and 3600');
    }
    const hook: WakeState = {
      channel: channel.id,
      agent: conn.agent!.name,
      url: parsed.toString(),
      on: (on as 'mentions' | 'all' | undefined) ?? 'mentions',
      cooldownSeconds,
      signed: typeof secret === 'string',
      createdAt: this.now(),
      secret: secret as string | undefined,
      pending: 0
    };
    channel.wakes.set(conn.agent!.name.toLowerCase(), hook);
    this.changes++;
    return this.wakeView(hook);
  }

  private wakeView(hook: WakeState): WakeHook {
    const { secret: _secret, pending: _pending, deferred: _deferred, ...view } = hook;
    return { ...view };
  }

  /** Called for every recorded channel message: POSTs to the wake hooks it concerns. */
  private fireWakes(channel: Channel, message: ChannelMessage): void {
    if (!channel.wakes.size) return;
    const lower = (message.shorthand?.raw ?? message.content).toLowerCase();
    const sender = message.from.name.toLowerCase();
    for (const [name, hook] of channel.wakes) {
      if (name === sender) continue;
      hook.pending++;
      const tag = '@' + name;
      let mentioned = false;
      for (let at = lower.indexOf(tag); at >= 0 && !mentioned; at = lower.indexOf(tag, at + 1)) {
        mentioned = !/[\p{L}\p{N}_-]/u.test(lower[at + tag.length] ?? '');
      }
      if (!mentioned && hook.on !== 'all') continue;
      this.tryWake(hook, channel, mentioned ? 'mention' : 'message', message);
    }
  }

  /** Sends now, or (inside the cooldown) keeps it for the sweep to send when the cooldown ends. */
  private tryWake(hook: WakeState, channel: Channel, reason: WakePayload['reason'], message: { id: string; from: AgentRef; content: string; timestamp: number }): void {
    const now = this.now();
    if (hook.lastFiredAt && now - hook.lastFiredAt < hook.cooldownSeconds * 1000) {
      const rank = (r: WakePayload['reason']) => (r === 'message' ? 0 : 1);
      if (!hook.deferred || rank(reason) >= rank(hook.deferred.reason)) hook.deferred = { reason, message };
      return;
    }
    hook.lastFiredAt = now;
    hook.deferred = undefined;
    this.sendWake(hook, channel, reason, message);
  }

  /** Sends wakes held back by a cooldown that has now ended (called from sweep). */
  private sweepWakes(): void {
    const now = this.now();
    for (const channel of this.channels.values()) {
      for (const hook of channel.wakes.values()) {
        const d = hook.deferred;
        if (!d || (hook.lastFiredAt && now - hook.lastFiredAt < hook.cooldownSeconds * 1000)) continue;
        hook.deferred = undefined;
        hook.lastFiredAt = now;
        this.sendWake(hook, channel, d.reason, d.message);
      }
    }
  }

  /** A DM wakes its recipient through the first hook it has in a channel shared with the sender. */
  private fireDmWake(sender: Connection, target: Connection, dm: DirectMessage): void {
    const name = target.agent!.name.toLowerCase();
    for (const id of sender.channels) {
      if (!target.channels.has(id)) continue;
      const channel = this.channels.get(id);
      const hook = channel?.wakes.get(name);
      if (!channel || !hook) continue;
      this.tryWake(hook, channel, 'dm', dm);
      return;
    }
  }

  private sendWake(hook: WakeState, channel: Channel, reason: WakePayload['reason'], message: { id: string; from: AgentRef; content: string; timestamp: number }): void {
    const text = message.content.slice(0, 2000);
    const payload: WakePayload = {
      type: 'crosstalk.wake',
      reason,
      hub: this.publicUrl,
      channel: { id: channel.id, name: channel.name },
      agent: hook.agent,
      from: message.from,
      text,
      message: { id: message.id, from: message.from, content: text, timestamp: message.timestamp },
      pending: reason === 'dm' ? hook.pending + 1 : hook.pending
    };
    hook.pending = 0;
    void this.postWake(hook, payload);
  }

  private async postWake(hook: WakeState, payload: WakePayload): Promise<void> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': `crosstalk-hub/${SERVER_VERSION}` };
    if (hook.secret) headers['x-crosstalk-signature'] = 'sha256=' + crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    timer.unref?.();
    try {
      const res = await this.deliver(hook.url, { method: 'POST', headers, body, signal: controller.signal });
      hook.lastStatus = res.status;
      hook.lastError = res.status >= 200 && res.status < 300 ? undefined : `HTTP ${res.status}`;
    } catch (err) {
      hook.lastStatus = 0;
      hook.lastError = controller.signal.aborted ? 'timed out after 5s' : String((err as Error)?.message ?? err).slice(0, 200);
    } finally {
      clearTimeout(timer);
    }
  }

  /** XDialect shorthand. `!LCK` / `!REL` with a target also take or release the lock. */
  private postShorthand(conn: Connection, address: unknown, shorthand: unknown): ChannelMessage {
    const channel = this.memberChannel(conn, address);
    const raw = this.messageText(shorthand, channel.limits.maxMessageChars);
    this.spend(channel, conn);
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
    const text = this.messageText(content);
    const waited = this.opts.rateLimits ? conn.dms.take(this.now()) : true;
    if (waited !== true) fail('rate_limited', `Too many DMs; try again in ${Math.ceil(waited / 1000)}s`, { retryAfterMs: waited });
    const message: DirectMessage = {
      id: newId('dm'),
      from: conn.ref,
      to: target.ref,
      content: text,
      timestamp: this.now(),
      replyExpected: replyExpected !== false
    };
    const meta = this.metadata(metadata);
    if (meta) message.metadata = meta;
    target.peer.send({ type: 'dm', message });
    this.fireDmWake(conn, target, message);
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
        if (other && id !== conn.agent!.id && this.visible(id)) reachable.set(id, other);
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
    this.pumpLockQueues();
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
    this.heartbeat(channel, conn.agent!.id);
    this.emit(channel, { type: 'lock.acquired', lock: result.lock }, conn.agent!.id);
    return result.lock;
  }

  private releaseLock(conn: Connection, address: unknown, rawFile: unknown): ResultData['lock.release'] {
    const channel = this.memberChannel(conn, address);
    const file = LockManager.normalizePath(rawFile as string);
    if (!file) fail('bad_request', 'file must be a non-empty path');
    const { released, heldBy } = this.locks.release(channel.id, file, conn.agent!.id);
    if (!released && this.dropWaits(conn.agent!.id, channel.id, file)) {
      return { channel: channel.id, file, released: false, dequeued: true };
    }
    if (heldBy) fail('forbidden', `${file} is held by ${heldBy.holder.name}, not you`, heldBy);
    if (released) {
      this.heartbeat(channel, conn.agent!.id);
      this.emit(channel, { type: 'lock.released', channel: channel.id, file, by: conn.ref, reason: 'released' }, conn.agent!.id);
      this.pumpLockQueues();
    }
    return { channel: channel.id, file, released: !!released };
  }

  /** Takes a free lock, or queues for a held one; `pumpLockQueues` grants it later, in order. */
  private waitLock(conn: Connection, address: unknown, rawFile: unknown, reason: unknown, ttlSeconds: unknown): ResultData['lock.wait'] {
    const channel = this.memberChannel(conn, address);
    const file = LockManager.normalizePath(rawFile as string);
    if (!file) fail('bad_request', 'file must be a non-empty path');
    this.pumpLockQueues();
    const current = this.locks.get(channel.id, file);
    const me = conn.agent!.id;
    if (!current || current.holder.id === me) {
      this.dropWaits(me, channel.id, file);
      return { granted: this.acquireLock(conn, channel.id, file, reason, ttlSeconds) };
    }
    const key = lockKey(channel.id, file);
    const queue = this.lockQueue.get(key) ?? [];
    const why = cleanText(reason, 280) || 'editing';
    const ttl = typeof ttlSeconds === 'number' ? ttlSeconds : undefined;
    let entry = queue.find(w => w.agentId === me);
    if (entry) {
      entry.reason = why;
      entry.ttlSeconds = ttl;
    } else {
      if (queue.length >= MAX_LOCK_WAITERS) fail('quota_exceeded', `At most ${MAX_LOCK_WAITERS} agents can wait for one file`);
      entry = { agentId: me, reason: why, ttlSeconds: ttl };
      queue.push(entry);
      this.lockQueue.set(key, queue);
    }
    this.agents.get(current.holder.id)?.peer.send({ type: 'lock.contended', lock: current, requester: conn.ref, reason: why });
    return { queued: true, position: queue.indexOf(entry) + 1, lock: current };
  }

  /** Removes an agent's queued waits in a channel (one file, or all). Returns whether any were removed. */
  private dropWaits(agentId: string, channelId: string, file?: string): boolean {
    let dropped = false;
    for (const [key, queue] of this.lockQueue) {
      if (file ? key !== lockKey(channelId, file) : !key.startsWith(channelId + '\u0000')) continue;
      const kept = queue.filter(w => w.agentId !== agentId);
      if (kept.length === queue.length) continue;
      dropped = true;
      if (kept.length) this.lockQueue.set(key, kept);
      else this.lockQueue.delete(key);
    }
    return dropped;
  }

  /** Hands every free, waited-for lock to the first waiter still in the channel. */
  private pumpLockQueues(): void {
    for (const [key, queue] of [...this.lockQueue]) {
      const [channelId, file] = key.split('\u0000');
      const channel = this.channels.get(channelId);
      if (!channel) {
        this.lockQueue.delete(key);
        continue;
      }
      while (queue.length && !this.locks.get(channelId, file)) {
        const next = queue.shift()!;
        const conn = this.agents.get(next.agentId);
        if (!conn?.agent || !channel.members.has(next.agentId)) continue;
        const result = this.locks.acquire(channelId, file, conn.ref, next.reason, next.ttlSeconds);
        if (!result.ok) continue;
        this.changes++;
        channel.lastActivity = this.now();
        this.heartbeat(channel, next.agentId);
        conn.peer.send({ type: 'lock.granted', lock: result.lock });
        this.emit(channel, { type: 'lock.acquired', lock: result.lock }, next.agentId);
      }
      if (!queue.length) this.lockQueue.delete(key);
    }
  }

  /**
   * Helper connections that act for another agent of the same name don't show
   * as members: "locks" (the `crosstalk lock` holder) and "runner" (one
   * `crosstalk run` holding a slot). Their locks and slot places still do.
   */
  private visible(id: string): boolean {
    const role = this.agents.get(id)?.agent?.role;
    return role !== 'locks' && role !== 'runner';
  }

  private visibleMembers(channel: Channel): string[] {
    return [...channel.members].filter(id => this.visible(id));
  }

  // -------------------------------------------------------------------------
  // Slots: counted semaphores for shared resources
  // -------------------------------------------------------------------------

  private slotView(channel: Channel, slot: SlotState): Slot {
    return {
      channel: channel.id,
      name: slot.name,
      capacity: slot.capacity,
      holders: slot.holds.map(h => ({ ...h, holder: { ...h.holder } })),
      waiting: slot.waiters.length
    };
  }

  private acquireSlot(conn: Connection, address: unknown, rawName: unknown, rawCapacity: unknown, ttlSeconds: unknown): ResultData['slot.acquire'] {
    const channel = this.memberChannel(conn, address);
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!SLOT_NAME.test(name)) fail('bad_request', 'slot name must be 1-64 letters, digits, ".", "_", ":" or "-"');
    const capacity = Number(rawCapacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_SLOT_CAPACITY) {
      fail('bad_request', `capacity must be a whole number from 1 to ${MAX_SLOT_CAPACITY}`);
    }
    this.pumpSlots(channel);
    let slot = channel.slots.get(name);
    if (!slot) {
      if (channel.slots.size >= MAX_SLOTS_PER_CHANNEL) fail('quota_exceeded', `A channel can have at most ${MAX_SLOTS_PER_CHANNEL} slots`);
      slot = { name, capacity, holds: [], waiters: [] };
      channel.slots.set(name, slot);
    } else if (capacity > slot.capacity) {
      fail('bad_request', `Slot "${name}" has capacity ${slot.capacity}, set by its first holder; asked for ${capacity}`, this.slotView(channel, slot));
    }
    const me = conn.agent!.id;
    const ttl = typeof ttlSeconds === 'number' ? ttlSeconds : undefined;
    const now = this.now();
    this.heartbeat(channel, me);

    const held = slot.holds.find(h => h.holder.id === me);
    if (held) {
      held.expiresAt = now + this.locks.clampTtl(ttl) * 1000;
      return { granted: this.slotView(channel, slot) };
    }
    const place = slot.waiters.findIndex(w => w.agentId === me);
    // pumpSlots above gave any free place to the queue, so one left over is nobody's.
    if (slot.holds.length < slot.capacity && !slot.waiters.length) {
      slot.holds.push({ holder: conn.ref, acquiredAt: now, expiresAt: now + this.locks.clampTtl(ttl) * 1000 });
      channel.lastActivity = now;
      this.emit(channel, { type: 'slot.updated', slot: this.slotView(channel, slot) }, me);
      return { granted: this.slotView(channel, slot) };
    }
    if (place >= 0) {
      slot.waiters[place].ttlSeconds = ttl;
    } else {
      if (slot.waiters.length >= MAX_LOCK_WAITERS) fail('quota_exceeded', `At most ${MAX_LOCK_WAITERS} agents can wait for one slot`);
      slot.waiters.push({ agentId: me, ttlSeconds: ttl });
      this.emit(channel, { type: 'slot.updated', slot: this.slotView(channel, slot) }, me);
    }
    return { queued: true, position: slot.waiters.findIndex(w => w.agentId === me) + 1, slot: this.slotView(channel, slot) };
  }

  private releaseSlot(conn: Connection, address: unknown, rawName: unknown): ResultData['slot.release'] {
    const channel = this.memberChannel(conn, address);
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    const slot = channel.slots.get(name);
    const me = conn.agent!.id;
    if (!slot) return { channel: channel.id, name, released: false };
    const holds = slot.holds.length;
    const waiters = slot.waiters.length;
    slot.holds = slot.holds.filter(h => h.holder.id !== me);
    slot.waiters = slot.waiters.filter(w => w.agentId !== me);
    const released = slot.holds.length < holds;
    const dequeued = slot.waiters.length < waiters;
    if (released || dequeued) {
      this.heartbeat(channel, me);
      this.emit(channel, { type: 'slot.updated', slot: this.slotView(channel, slot) }, me);
      this.pumpSlots(channel);
    }
    if (!slot.holds.length && !slot.waiters.length) channel.slots.delete(name);
    return dequeued && !released ? { channel: channel.id, name, released, dequeued } : { channel: channel.id, name, released };
  }

  /** Drops an agent's places and queued waits in every slot of a channel (it left or was evicted). */
  private dropSlotsOf(channel: Channel, agentId: string): void {
    for (const slot of channel.slots.values()) {
      const before = slot.holds.length + slot.waiters.length;
      slot.holds = slot.holds.filter(h => h.holder.id !== agentId);
      slot.waiters = slot.waiters.filter(w => w.agentId !== agentId);
      if (slot.holds.length + slot.waiters.length < before) {
        this.changes++;
        this.emit(channel, { type: 'slot.updated', slot: this.slotView(channel, slot) });
      }
    }
    this.pumpSlots(channel);
  }

  /** Expires lapsed places, then hands free places to the queue in order. Forgets idle slots. */
  private pumpSlots(channel: Channel): void {
    const now = this.now();
    for (const [name, slot] of channel.slots) {
      let changed = false;
      const live = slot.holds.filter(h => h.expiresAt > now);
      if (live.length < slot.holds.length) {
        slot.holds = live;
        changed = true;
      }
      const granted: string[] = [];
      while (slot.holds.length < slot.capacity && slot.waiters.length) {
        const next = slot.waiters.shift()!;
        const conn = this.agents.get(next.agentId);
        changed = true;
        if (!conn?.agent || !channel.members.has(next.agentId)) continue;
        slot.holds.push({ holder: conn.ref, acquiredAt: now, expiresAt: now + this.locks.clampTtl(next.ttlSeconds) * 1000 });
        this.heartbeat(channel, next.agentId);
        granted.push(next.agentId);
      }
      if (changed) {
        this.changes++;
        channel.lastActivity = now;
        const view = this.slotView(channel, slot);
        for (const id of granted) this.agents.get(id)?.peer.send({ type: 'slot.granted', slot: view });
        for (const id of channel.members) {
          if (!granted.includes(id)) this.agents.get(id)?.peer.send({ type: 'slot.updated', slot: view });
        }
      }
      if (!slot.holds.length && !slot.waiters.length) channel.slots.delete(name);
    }
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
      if (channel && this.visible(agent.id)) this.emit(channel, { type: 'member.updated', channel: name, agent }, agent.id);
    }
    return agent;
  }

  // -------------------------------------------------------------------------
  // Questions for the owner
  // -------------------------------------------------------------------------

  // ---- Approval (2.20+): knocks, passes, admitting

  private static hashPass(pass: string): string {
    return crypto.createHash('sha256').update(pass).digest('hex');
  }

  private issuePass(channel: Channel, agent: AgentInfo): string {
    const pass = `xp_${crypto.randomBytes(24).toString('base64url')}`;
    channel.passes.set(MeshHub.hashPass(pass), { name: agent.name, ids: [agent.id], at: this.now() });
    this.changes++;
    return pass;
  }

  /** A valid pass lets its holder in; the new agent id is remembered so a later kick revokes it. */
  private usePass(channel: Channel, pass: unknown, agent: AgentInfo): boolean {
    if (typeof pass !== 'string' || pass.length > 128) return false;
    const state = channel.passes.get(MeshHub.hashPass(pass));
    if (!state) return false;
    if (!state.ids.includes(agent.id)) state.ids = [...state.ids.slice(-19), agent.id];
    this.changes++;
    return true;
  }

  private revokePasses(channel: Channel, agent: AgentInfo): void {
    for (const [hash, state] of [...channel.passes]) {
      if (state.ids.includes(agent.id)) channel.passes.delete(hash);
    }
    this.changes++;
  }

  private isOwnerKey(channel: Channel, ownerKey: unknown): boolean {
    return typeof ownerKey === 'string' && ownerKey.length <= 128 &&
      crypto.timingSafeEqual(MeshHub.hashKey(ownerKey), channel.ownerKeyHash);
  }

  private knock(channel: Channel, conn: Connection): void {
    const id = conn.agent!.id;
    if (!channel.knocks.has(id) && channel.knocks.size >= 50) fail('quota_exceeded', 'Too many people are waiting to join this channel');
    const knock: Knock = { agent: conn.ref, environment: conn.agent!.environment, at: this.now(), status: 'waiting' };
    const fresh = !channel.knocks.has(id);
    channel.knocks.set(id, { knock, conn });
    if (fresh) this.emit(channel, { type: 'channel.knock', channel: channel.id, knock });
  }

  /** Admits (true), denies (false) or forgets (null: they left) someone waiting. */
  private decideKnock(channel: Channel, agentId: string, allow: boolean | null, by?: AgentRef): Knock | undefined {
    const waiting = channel.knocks.get(agentId);
    if (!waiting) return undefined;
    channel.knocks.delete(agentId);
    const knock: Knock = { ...waiting.knock, status: allow === null ? 'left' : allow ? 'admitted' : 'denied' };
    if (allow === true && waiting.conn.agent) {
      waiting.conn.peer.send({ type: 'channel.admitted', channel: channel.id, pass: this.issuePass(channel, waiting.conn.agent), by: by! });
    } else if (allow === false) {
      waiting.conn.peer.send({ type: 'channel.refused', channel: channel.id, by: by! });
    }
    this.emit(channel, { type: 'channel.knock', channel: channel.id, knock });
    return knock;
  }

  private admitMember(conn: Connection, address: unknown, ownerKey: unknown, agent: unknown, allow: boolean): ResultData['member.admit'] {
    const channel = this.memberChannel(conn, address);
    this.requireOwner(channel, ownerKey);
    const key = cleanText(agent, 128);
    if (!key) fail('bad_request', 'agent (an id or a name) is required');
    const match = [...channel.knocks.values()].find(k => k.knock.agent.id === key || k.knock.agent.name.toLowerCase() === key.toLowerCase());
    if (!match) return fail('not_found', `Nobody called ${key} is waiting to join`);
    const knock = this.decideKnock(channel, match.knock.agent.id, allow, conn.ref)!;
    return { channel: channel.id, knock };
  }

  private listKnocks(conn: Connection, address: unknown, ownerKey: unknown): ResultData['member.knocks'] {
    const channel = this.memberChannel(conn, address);
    this.requireOwner(channel, ownerKey);
    return { channel: channel.id, knocks: [...channel.knocks.values()].map(k => k.knock) };
  }

  static hashKey(key: string): Buffer {
    return crypto.createHash('sha256').update(key).digest();
  }

  /** Constant-time check of an owner key against the channel's stored hash. */
  private requireOwner(channel: Channel, ownerKey: unknown): void {
    const ok = typeof ownerKey === 'string' && ownerKey.length <= 128 &&
      crypto.timingSafeEqual(MeshHub.hashKey(ownerKey), channel.ownerKeyHash);
    if (!ok) fail('forbidden', "That needs this channel's owner key");
  }

  private askQuestion(conn: Connection, address: unknown, question: unknown, options: unknown): UserQuestion {
    const channel = this.memberChannel(conn, address);
    const text = cleanText(question, 2000);
    if (!text) fail('bad_request', 'question must be a non-empty string');
    if (options !== undefined && (!Array.isArray(options) || options.length > 10)) {
      fail('bad_request', 'options must be an array of at most 10 strings');
    }
    const choices = ((options as unknown[] | undefined) ?? []).map(o => cleanText(o, 200)).filter(Boolean);
    const now = this.now();
    const q: UserQuestion = {
      id: newId('q'),
      channel: channel.id,
      from: conn.ref,
      question: text,
      options: choices,
      createdAt: now,
      status: 'open'
    };
    // The owner isn't taking questions: answer straight away, nothing is queued.
    if (channel.questionsMode === 'off') return { ...q, status: 'unattended', closedAt: now };

    const mine = [...channel.questions.values()].filter(x => x.from.id === conn.agent!.id).length;
    if (mine >= this.opts.maxQuestionsPerAgent) {
      fail('quota_exceeded', `At most ${this.opts.maxQuestionsPerAgent} open questions per agent; cancel one or wait for answers`);
    }
    if (channel.questions.size >= this.opts.maxQuestionsPerChannel) fail('quota_exceeded', 'This channel has too many open questions');
    channel.questions.set(q.id, q);
    channel.lastActivity = now;
    this.emit(channel, { type: 'question.asked', question: q });
    return q;
  }

  private openQuestion(channel: Channel, id: unknown): UserQuestion {
    const q = typeof id === 'string' ? channel.questions.get(id) : undefined;
    return q ?? fail('not_found', 'No open question with that id in this channel');
  }

  private cancelQuestion(conn: Connection, address: unknown, id: unknown): UserQuestion {
    const channel = this.memberChannel(conn, address);
    const q = this.openQuestion(channel, id);
    if (q.from.id !== conn.agent!.id) fail('forbidden', 'Only the agent that asked can cancel a question');
    return this.closeQuestion(channel, q, 'cancelled');
  }

  private answerQuestion(conn: Connection, address: unknown, id: unknown, answer: unknown, ownerKey: unknown): UserQuestion {
    const channel = this.memberChannel(conn, address);
    this.requireOwner(channel, ownerKey);
    const q = this.openQuestion(channel, id);
    const text = cleanText(answer, 2000);
    if (!text) fail('bad_request', 'answer must be a non-empty string');
    return this.closeQuestion(channel, q, 'answered', text);
  }

  private configureChannel(conn: Connection, address: unknown, ownerKey: unknown, questions: unknown, approval?: unknown): ChannelInfo {
    const channel = this.memberChannel(conn, address);
    this.requireOwner(channel, ownerKey);
    if (approval !== undefined) {
      if (typeof approval !== 'boolean') fail('bad_request', 'approval must be true or false');
      if (approval && !channel.approval) {
        channel.approval = true;
        // Everyone already here keeps their place: each gets a pass for when they reconnect.
        for (const id of channel.members) {
          const member = this.agents.get(id);
          if (member?.agent) member.peer.send({ type: 'channel.admitted', channel: channel.id, pass: this.issuePass(channel, member.agent), by: conn.ref });
        }
      } else if (!approval && channel.approval) {
        channel.approval = false;
        // Nobody needs letting in any more: tell whoever is waiting to come in.
        for (const [, waiting] of [...channel.knocks]) this.decideKnock(channel, waiting.knock.agent.id, true, conn.ref);
      }
      this.changes++;
    }
    if (questions !== undefined) {
      if (questions !== 'on' && questions !== 'off') fail('bad_request', 'questions must be "on" or "off"');
      channel.questionsMode = questions as 'on' | 'off';
      // Switching off releases everyone already waiting.
      if (questions === 'off') for (const q of [...channel.questions.values()]) this.closeQuestion(channel, q, 'unattended');
    }
    const info = this.info(channel);
    this.emit(channel, { type: 'channel.updated', channel: info });
    return info;
  }

  private closeQuestion(channel: Channel, q: UserQuestion, status: 'answered' | 'cancelled' | 'unattended', answer?: string): UserQuestion {
    channel.questions.delete(q.id);
    const closed: UserQuestion = { ...q, status, closedAt: this.now() };
    if (answer !== undefined) closed.answer = answer;
    channel.lastActivity = closed.closedAt!;
    this.emit(channel, { type: 'question.closed', question: closed });
    return closed;
  }

  // -------------------------------------------------------------------------
  // Claims: "on it" as a promise with a heartbeat
  // -------------------------------------------------------------------------

  private createClaim(conn: Connection, address: unknown, task: unknown, everySeconds: unknown, paths: unknown): TaskClaim {
    const channel = this.memberChannel(conn, address);
    const text = cleanText(task, 280);
    if (!text) fail('bad_request', 'task must be a non-empty string');
    if (paths !== undefined && (!Array.isArray(paths) || paths.length > 20)) fail('bad_request', 'paths must be an array of at most 20 strings');
    const mine = [...channel.claims.values()].filter(c => c.owner.id === conn.agent!.id).length;
    if (mine >= this.opts.maxClaimsPerAgent) {
      fail('quota_exceeded', `At most ${this.opts.maxClaimsPerAgent} open claims per agent; finish or drop one`);
    }
    const seconds = typeof everySeconds === 'number' && Number.isFinite(everySeconds) ? Math.min(Math.max(everySeconds, 60), 7200) : 600;
    const now = this.now();
    const claim: TaskClaim = {
      id: newId('cl'),
      channel: channel.id,
      owner: conn.ref,
      task: text,
      createdAt: now,
      lastHeartbeat: now,
      everyMs: seconds * 1000,
      nextUpdateBy: now + seconds * 1000,
      status: 'active'
    };
    const files = ((paths as unknown[] | undefined) ?? []).map(p => LockManager.normalizePath(String(p))).filter(Boolean);
    if (files.length) claim.paths = files;
    channel.claims.set(claim.id, claim);
    channel.lastActivity = now;
    this.emit(channel, { type: 'claim.updated', claim: { ...claim } });
    return { ...claim };
  }

  private updateClaims(conn: Connection, address: unknown, id: unknown, note: unknown, status: unknown): { claims: TaskClaim[] } {
    const channel = this.memberChannel(conn, address);
    if (status !== undefined && status !== 'done' && status !== 'dropped') fail('bad_request', 'status must be "done" or "dropped"');
    let targets: TaskClaim[];
    if (id === undefined) {
      targets = [...channel.claims.values()].filter(c => c.owner.id === conn.agent!.id);
    } else {
      const claim = typeof id === 'string' ? channel.claims.get(id) : undefined;
      if (!claim) return fail('not_found', 'No open claim with that id in this channel');
      if (claim.owner.id !== conn.agent!.id) fail('forbidden', `That claim belongs to ${claim.owner.name}`);
      targets = [claim];
    }
    const text = cleanText(note, 2000);
    if (text) {
      for (const c of targets) c.note = text;
      // Progress is posted where everyone can see it; recording it heartbeats every claim of the sender here.
      const message: ChannelMessage = {
        id: newId('msg'),
        channel: channel.id,
        kind: 'chat',
        from: conn.ref,
        content: text,
        timestamp: this.now(),
        metadata: { claims: targets.map(c => c.id), status: status ?? 'progress' }
      };
      this.record(channel, message, conn);
    } else {
      for (const c of targets) this.beat(channel, c);
    }
    if (status) return { claims: targets.map(c => this.closeClaim(channel, c, status as 'done' | 'dropped')) };
    return { claims: targets.map(c => ({ ...c })) };
  }

  /** Heartbeats every open claim `agentId` holds in the channel. */
  private heartbeat(channel: Channel, agentId: string): void {
    for (const claim of channel.claims.values()) if (claim.owner.id === agentId) this.beat(channel, claim);
  }

  private beat(channel: Channel, claim: TaskClaim): void {
    const now = this.now();
    claim.lastHeartbeat = now;
    claim.nextUpdateBy = now + claim.everyMs;
    if (claim.status === 'stalled') {
      claim.status = 'active';
      this.emit(channel, { type: 'claim.updated', claim: { ...claim } });
    }
  }

  private closeClaim(channel: Channel, claim: TaskClaim, status: 'done' | 'dropped'): TaskClaim {
    channel.claims.delete(claim.id);
    const closed: TaskClaim = { ...claim, status, closedAt: this.now() };
    this.emit(channel, { type: 'claim.updated', claim: closed });
    return closed;
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
    this.sweepInvites();
    this.sweepListeners();
    this.sweepWakes();
    for (const lock of this.locks.sweepExpired()) {
      this.changes++;
      const channel = this.channels.get(lock.channel);
      if (channel) {
        this.emit(channel, { type: 'lock.released', channel: lock.channel, file: lock.file, by: lock.holder, reason: 'expired' });
      }
    }
    this.pumpLockQueues();
    for (const channel of this.channels.values()) this.pumpSlots(channel);
    const now = this.now();
    for (const conn of [...this.resumable.values()]) {
      if (conn.phase === 'parked' && conn.droppedAt! + this.opts.presenceGraceMs <= now) this.evict(conn);
    }
    for (const channel of this.channels.values()) {
      for (const claim of channel.claims.values()) {
        if (claim.status !== 'active' || claim.nextUpdateBy > now) continue;
        // Everyone sees it, the owner's inbox included; the claimant gets it too, as a nudge.
        claim.status = 'stalled';
        this.changes++;
        this.emit(channel, { type: 'claim.updated', claim: { ...claim } });
      }
      // Allowances outlive leaving the channel (so rejoining doesn't reset them), not the agent.
      for (const id of channel.senders.keys()) if (!this.agents.has(id)) channel.senders.delete(id);
    }
    for (const channel of [...this.channels.values()]) {
      if (channel.members.size > 0 || channel.emptySince === undefined) continue;
      const ttl = channel.history.length ? this.opts.emptyChannelTtlMs : this.opts.unusedChannelTtlMs;
      if (channel.emptySince + ttl <= now) {
        this.deleteChannel(channel);
        this.changes++;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Remote invites (#13): channel-scoped keys for agents outside this machine
  // -------------------------------------------------------------------------

  private inviteIsLive(invite: Invite): boolean {
    return !invite.revokedAt && (invite.expiresAt === undefined || invite.expiresAt > this.now()) && this.channels.has(invite.channel);
  }

  /** The invite a key belongs to, if it is still good. */
  liveInvite(key: string): Invite | undefined {
    if (typeof key !== 'string' || !/^xi_[A-Za-z0-9_-]{20,64}$/.test(key)) return undefined;
    const invite = this.invites.get(MeshHub.hashToken(key));
    return invite && this.inviteIsLive(invite) ? invite : undefined;
  }

  /** What a remote agent may do: only inside its invite's channel, and nothing an owner does. */
  private checkRemote(conn: Connection, f: RequestFrame): void {
    const invite = conn.invite!;
    if (!this.inviteIsLive(invite)) {
      queueMicrotask(() => this.endRemote(conn, 'invite revoked or expired'));
      fail('unauthorized', 'Your invite was revoked or has expired');
    }
    const ownerOnly = ['channel.create', 'channel.close', 'channel.configure', 'question.answer', 'invite.create', 'invite.list', 'invite.revoke', 'member.admit', 'member.knocks'];
    if (ownerOnly.includes(f.type)) fail('forbidden', 'Agents joined by invite cannot do that');
    if (f.type === 'channel.join' && (f as { channel?: unknown }).channel !== invite.channel) {
      fail('forbidden', 'Your invite is for one channel only');
    }
  }

  private endRemote(conn: Connection, reason: string): void {
    if (conn.phase === 'closed') return;
    conn.peer.close(4003, reason);
    this.disconnect(conn);
  }

  private inviteInfo(invite: Invite): InviteInfo {
    const status = invite.revokedAt ? 'revoked' : invite.expiresAt !== undefined && invite.expiresAt <= this.now() ? 'expired' : 'active';
    const online = [...this.agents.values()].filter(c => c.invite?.id === invite.id && c.agent).length;
    return {
      id: invite.id.slice(0, 12),
      channel: invite.channel,
      label: invite.label,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      maxAgents: invite.maxAgents,
      admitted: invite.agents.length,
      online,
      status
    };
  }

  private createInvite(conn: Connection, address: unknown, ownerKey: unknown, label: unknown, expiresInSeconds: unknown, maxAgents: unknown): { key: string; invite: InviteInfo } {
    const channel = this.memberChannel(conn, address);
    this.requireOwner(channel, ownerKey);
    if (expiresInSeconds !== undefined && (typeof expiresInSeconds !== 'number' || !(expiresInSeconds >= 60) || expiresInSeconds > 365 * 86400)) {
      fail('bad_request', 'expiresInSeconds must be from 60 to 31536000');
    }
    if (maxAgents !== undefined && (typeof maxAgents !== 'number' || !Number.isInteger(maxAgents) || maxAgents < 1 || maxAgents > this.opts.maxMembersPerChannel)) {
      fail('bad_request', `maxAgents must be a whole number from 1 to ${this.opts.maxMembersPerChannel}`);
    }
    const live = [...this.invites.values()].filter(i => i.channel === channel.id && this.inviteIsLive(i));
    if (live.length >= 50) fail('quota_exceeded', 'At most 50 active invites per channel; revoke some first');
    const key = `xi_${crypto.randomBytes(24).toString('base64url')}`;
    const invite: Invite = {
      id: MeshHub.hashToken(key),
      channel: channel.id,
      label: cleanText(label, 64) || `invite-${live.length + 1}`,
      createdAt: this.now(),
      expiresAt: expiresInSeconds === undefined ? undefined : this.now() + (expiresInSeconds as number) * 1000,
      maxAgents: maxAgents as number | undefined,
      agents: []
    };
    this.invites.set(invite.id, invite);
    return { key, invite: this.inviteInfo(invite) };
  }

  private listInvites(conn: Connection, address: unknown, ownerKey: unknown): InviteInfo[] {
    const channel = this.memberChannel(conn, address);
    this.requireOwner(channel, ownerKey);
    return [...this.invites.values()].filter(i => i.channel === channel.id).map(i => this.inviteInfo(i));
  }

  /** Revokes by id prefix (as `invite.list` shows it), by label, or every invite with "all"; agents admitted with them are disconnected at once. */
  private revokeInvites(conn: Connection, address: unknown, ownerKey: unknown, which: unknown): { revoked: InviteInfo[]; disconnected: number } {
    const channel = this.memberChannel(conn, address);
    this.requireOwner(channel, ownerKey);
    const key = cleanText(which, 64);
    if (!key) fail('bad_request', 'invite must be an id, a label or "all"');
    const matches = [...this.invites.values()].filter(i =>
      i.channel === channel.id && !i.revokedAt && (key === 'all' || i.label === key || (key.length >= 6 && i.id.startsWith(key))));
    if (!matches.length) fail('not_found', 'No active invite matches that');
    let disconnected = 0;
    for (const invite of matches) {
      invite.revokedAt = this.now();
      disconnected += this.dropInviteAgents(invite, 'invite revoked');
    }
    this.changes++;
    return { revoked: matches.map(i => this.inviteInfo(i)), disconnected };
  }

  private dropInviteAgents(invite: Invite, reason: string): number {
    let n = 0;
    for (const c of new Set([...this.agents.values(), ...this.resumable.values()])) {
      if (c.invite?.id === invite.id && c.agent) {
        this.endRemote(c, reason);
        n++;
      }
    }
    return n;
  }

  private sweepInvites(): void {
    const now = this.now();
    for (const [id, invite] of this.invites) {
      if (!this.channels.has(invite.channel)) {
        this.invites.delete(id);
        this.changes++;
      } else if (!invite.revokedAt && invite.expiresAt !== undefined && invite.expiresAt <= now) {
        if (this.dropInviteAgents(invite, 'invite expired')) this.changes++;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Persistence: channels, agents, locks, claims and questions survive a restart
  // -------------------------------------------------------------------------

  /** Everything needed to carry on after a restart. Rate allowances and transports are not kept. */
  exportState(): HubState {
    const agents: PersistedAgent[] = [];
    for (const conn of new Set([...this.agents.values(), ...this.resumable.values()])) {
      if (!conn.agent || !conn.resumeToken) continue;
      agents.push({ agent: { ...conn.agent }, resumeTokenHash: conn.resumeToken, channels: [...conn.channels], invite: conn.invite?.id, address: conn.address });
    }
    return {
      version: 1,
      savedAt: this.now(),
      hubVersion: SERVER_VERSION,
      channels: [...this.channels.values()].map(c => ({
        id: c.id,
        name: c.name,
        topic: c.topic,
        visibility: c.visibility,
        createdBy: c.createdBy,
        createdFrom: c.createdFrom,
        createdAt: c.createdAt,
        lastActivity: c.lastActivity,
        members: [...c.members],
        history: c.history,
        emptySince: c.emptySince,
        ownerKeyHash: c.ownerKeyHash.toString('hex'),
        questionsMode: c.questionsMode,
        questions: [...c.questions.values()],
        posted: c.posted,
        reads: [...c.reads],
        claims: [...c.claims.values()],
        limits: c.limits,
        slots: [...c.slots.values()].filter(slot => slot.holds.length).map(slot => ({ name: slot.name, capacity: slot.capacity, holds: slot.holds })),
        wakes: [...c.wakes.values()].map(({ pending: _pending, deferred: _deferred, ...hook }) => ({ ...hook })),
        bans: [...c.bans.values()].map(b => ({ ...b, ids: [...b.ids], ips: [...b.ips] })),
        approval: c.approval || undefined,
        passes: c.passes.size ? [...c.passes].map(([hash, p]) => ({ hash, ...p, ids: [...p.ids] })) : undefined
      })),
      agents,
      locks: this.locks.list(),
      invites: [...this.invites.values()].map(i => ({ ...i, agents: [...i.agents] }))
    };
  }

  /**
   * Loads saved state into an empty hub. Every saved agent comes back as if
   * its transport had just dropped: present, holding its channels, locks and
   * claims, for `graceMs` (default: the presence grace period). A client that
   * reconnects with its resume token in that time carries on as the same
   * agent; one that doesn't is evicted as usual, and its locks are released
   * with a notice to the channel.
   */
  restoreState(state: HubState, graceMs = this.opts.presenceGraceMs): { channels: number; agents: number; locks: number } {
    if (state?.version !== 1) throw new Error(`Unsupported hub state version ${String(state?.version)}`);
    if (this.channels.size || this.agents.size) throw new Error('restoreState needs an empty hub');
    for (const c of state.channels) {
      this.channels.set(c.id, {
        ...c,
        members: new Set(),
        ownerKeyHash: Buffer.from(c.ownerKeyHash, 'hex'),
        approval: c.approval === true,
        passes: new Map((c.passes ?? []).map(({ hash, ...p }) => [hash, { ...p, ids: [...p.ids] }])),
        knocks: new Map(),
        questions: new Map(c.questions.map(q => [q.id, q])),
        reads: new Map(c.reads),
        claims: new Map(c.claims.map(k => [k.id, k])),
        senders: new Map(),
        slots: new Map(),
        wakes: new Map((c.wakes ?? []).map(hook => [hook.agent.toLowerCase(), { ...hook, pending: 0 }])),
        bans: new Map((c.bans ?? []).map(ban => [ban.name.toLowerCase(), { ...ban, ids: [...ban.ids], ips: [...(ban.ips ?? [])] }]))
      });
    }
    for (const invite of state.invites ?? []) {
      if (this.channels.has(invite.channel)) this.invites.set(invite.id, { ...invite, agents: [...invite.agents] });
    }
    let agents = 0;
    const now = this.now();
    for (const saved of state.agents) {
      const channels = saved.channels.filter(id => this.channels.has(id));
      if (!channels.length) continue;
      const conn = new Connection({ send: () => {}, close: () => {} }, saved.address || RESTORED_ADDRESS, this.opts.rateLimit, now, this.opts.channelLimits);
      conn.restored = true; // holds no per-address slot
      if (saved.invite) {
        // A remote agent comes back only while its invite is still good.
        const invite = this.invites.get(saved.invite);
        if (!invite || !this.inviteIsLive(invite)) continue;
        conn.invite = invite;
      }
      conn.agent = saved.agent;
      conn.resumeToken = saved.resumeTokenHash;
      for (const id of channels) {
        conn.channels.add(id);
        this.channels.get(id)!.members.add(saved.agent.id);
      }
      this.agents.set(saved.agent.id, conn);
      this.resumable.set(conn.resumeToken, conn);
      // Evicted once `graceMs` has passed, however long the hub's own grace period is.
      this.park(conn, now - this.opts.presenceGraceMs + graceMs);
      agents++;
    }
    for (const channel of this.channels.values()) {
      for (const [id] of channel.reads) if (!channel.members.has(id)) channel.reads.delete(id);
      // Agents that didn't come back (no live channel, dead invite) never leave
      // through removeMember, so close what they left open the same way it would.
      for (const q of [...channel.questions.values()]) if (!channel.members.has(q.from.id)) this.closeQuestion(channel, q, 'cancelled');
      for (const claim of [...channel.claims.values()]) if (!channel.members.has(claim.owner.id)) this.closeClaim(channel, claim, 'dropped');
      if (!channel.members.size) channel.emptySince ??= now;
    }
    const locks = this.locks.restore(state.locks.filter(l => this.channels.get(l.channel)?.members.has(l.holder.id)));
    // Slot places come back for agents that came back; queues don't survive a restart.
    for (const c of state.channels) {
      const channel = this.channels.get(c.id)!;
      for (const saved of c.slots ?? []) {
        if (!SLOT_NAME.test(saved?.name) || !Number.isInteger(saved.capacity)) continue;
        const holds = (saved.holds ?? []).filter(h => h?.holder?.id && channel.members.has(h.holder.id)).map(h => ({ ...h, holder: { ...h.holder } }));
        if (holds.length) channel.slots.set(saved.name, { name: saved.name, capacity: saved.capacity, holds, waiters: [] });
      }
    }
    return { channels: this.channels.size, agents, locks };
  }
}

export interface PersistedChannel {
  id: string;
  name: string;
  topic: string;
  visibility: ChannelVisibility;
  createdBy: AgentRef;
  createdFrom: string;
  createdAt: number;
  lastActivity: number;
  members: string[];
  history: ChannelMessage[];
  emptySince?: number;
  /** Hex SHA-256 of the owner key. */
  ownerKeyHash: string;
  questionsMode: 'on' | 'off';
  questions: UserQuestion[];
  posted: number;
  reads: [string, { at: number; seq: number }][];
  claims: TaskClaim[];
  limits: ChannelLimits;
  /** Slots with holders. Missing from state saved before 2.9. */
  slots?: { name: string; capacity: number; holds: SlotHold[] }[];
  /** Wake hooks, secrets included (the state file is readable only by the hub's user). Missing before 2.10.1. */
  wakes?: (WakeHook & { secret?: string })[];
  /** Bans, addresses included (the state file is readable only by the hub's user). Missing before 2.17. */
  bans?: (Omit<ChannelBan, 'ipCount'> & { ips?: string[] })[];
  /** Approve new members (2.20+). */
  approval?: boolean;
  /** Pass hashes (SHA-256 hex), never the passes themselves. */
  passes?: { hash: string; name: string; ids: string[]; at: number }[];
}

export interface PersistedAgent {
  agent: AgentInfo;
  /** Hex SHA-256 of the agent's current resume token; the token itself is never saved. */
  resumeTokenHash: string;
  channels: string[];
  /** Id of the invite a remote agent joined with (#13). */
  invite?: string;
  /** Network address it connected from, so a fresh session of the same client can retire it (2.20+). */
  address?: string;
}

export interface HubState {
  version: 1;
  savedAt: number;
  /** The CrossTalk version that saved this state (2.14+); missing from older hubs. */
  hubVersion?: string;
  channels: PersistedChannel[];
  agents: PersistedAgent[];
  locks: FileLock[];
  /** Remote invites (#13), keys stored only as hashes. */
  invites?: Invite[];
}

/** A remote invite (#13). `id` is the SHA-256 (hex) of the key; the key itself is never stored. */
export interface Invite {
  id: string;
  channel: string;
  label: string;
  createdAt: number;
  expiresAt?: number;
  maxAgents?: number;
  /** Agent ids admitted with this invite. */
  agents: string[];
  revokedAt?: number;
}

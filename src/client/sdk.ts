import { EventEmitter } from 'node:events';
import { detectClient, detectPlace, type AgentPlace } from './client-name.js';
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
  type ChannelLimits,
  type ChannelMessage,
  type ChannelSnapshot,
  type DirectMessage,
  type ErrorCode,
  type FileLock,
  type MemberAttention,
  type MessageReceipt,
  type RequestFrame,
  type ResultData,
  type QuestionsMode,
  type ServerFrame,
  type TaskClaim,
  type UserQuestion,
  type AgentRef,
  type ChannelBan,
  type Knock,
  type WakeHook
} from '../protocol.js';
import { channelId, isAddress as isAnyAddress, parseAddress, sameHub } from '../address.js';

export { channelId, findAddress, formatAddress, parseAddress, resolveAddress, type ParsedAddress } from '../address.js';

/**
 * The hub agents use unless told otherwise (2.15+): the public CrossTalk hub,
 * so online channels work with no setup. For a hub on this machine, set
 * CROSSTALK_URL (or pass url / --url) to LOCAL_URL.
 */
export const DEFAULT_URL = 'wss://hub-production-a114.up.railway.app';
/** Where `crosstalk serve` listens by default. */
export const LOCAL_URL = 'ws://localhost:4488';

/** A reconnect couldn't resume your agent, so the hub released every lock it held. Lock them again if you still need them. */
export interface LocksLost {
  locks: FileLock[];
  reason: 'not_resumed';
}

/** The hub no longer has a channel you were in (it restarted without saved state, or the channel was deleted while you were away). */
export interface ChannelLost {
  channel: string;
  name: string;
  /** `kicked` (2.17+): the owner removed you; `by` and `banned` say who and whether you may rejoin. */
  reason: 'hub_restarted' | 'kicked';
  by?: AgentRef;
  banned?: boolean;
  note?: string;
}

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
  /** Hub WebSocket URL. Defaults to $CROSSTALK_URL or the public hub (wss://hub-production-a114.up.railway.app). */
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
  /** Extra headers for the WebSocket handshake. */
  headers?: Record<string, string>;
  /** A remote invite key (xi_…, #13) for a hub's public door. Defaults to $CROSSTALK_INVITE. */
  invite?: string;
  /** This machine's public sealing key (xs_…, see sealIdentity in secrets.ts), so others can share keys with it. */
  sealKey?: string;
  /** How to refer to this agent, e.g. "she/her" (2.21+). Defaults to $CROSSTALK_PRONOUNS. */
  pronouns?: string;
  /** The tool this agent runs in, e.g. "Claude Code" (2.23+). Defaults to $CROSSTALK_CLIENT, or what the environment shows. */
  client?: string;
  /** Where it runs: cloud, computer, phone or edge (2.23+). Defaults to $CROSSTALK_PLACE, or what the environment shows. */
  place?: AgentPlace;
}

export class CrossTalkError extends Error {
  constructor(readonly code: ErrorCode | 'timeout' | 'disconnected', message: string, readonly details?: unknown) {
    super(message);
    this.name = 'CrossTalkError';
  }
}

type RequestType = RequestFrame['type'];
type RequestBody<T extends RequestType> = Omit<Extract<RequestFrame, { type: T }>, 'type' | 'id'>;

/** The channel a pushed event belongs to, if any. */
function channelOf(f: ServerFrame): string | undefined {
  switch (f.type) {
    case 'message': return f.message.channel;
    case 'lock.acquired': case 'lock.contended': return f.lock.channel;
    case 'question.asked': case 'question.closed': return f.question.channel;
    case 'claim.updated': return f.claim.channel;
    case 'channel.updated': return f.channel.id;
    case 'member.joined': case 'member.left': case 'member.updated': case 'lock.released': case 'channel.closed': return f.channel;
  }
}

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
 * 'lock.acquired', 'lock.released', 'lock.contended', 'question.asked',
 * 'question.closed', 'claim.updated', 'updated' (channel settings changed), 'closed' (the
 * owner closed the channel; you are no longer in it).
 */
export class Channel extends EventEmitter {
  info: ChannelInfo;
  readonly members = new Map<string, AgentInfo>();
  readonly locks = new Map<string, FileLock>();
  /** Recent history, starting with what the hub had when we joined. */
  readonly messages: ChannelMessage[] = [];
  /** Open questions for the owner, by id. */
  readonly questions = new Map<string, UserQuestion>();
  /** Active and stalled claims, by id. */
  readonly claims = new Map<string, TaskClaim>();
  /** Who was reading the channel, as of the last snapshot (join, refresh). */
  attention: MemberAttention[] = [];
  /**
   * The owner key, present only on the client that created the channel.
   * Whoever holds it can answer questions and switch them off, so keep it out
   * of the channel and out of other agents' reach.
   */
  ownerKey?: string;

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
    this.questions.clear();
    for (const q of snapshot.questions ?? []) this.questions.set(q.id, q);
    this.attention = snapshot.attention ?? [];
    this.claims.clear();
    for (const c of snapshot.claims ?? []) this.claims.set(c.id, c);
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
      case 'question.asked':
        this.questions.set(frame.question.id, frame.question);
        this.emit('question.asked', frame.question);
        break;
      case 'question.closed':
        this.questions.delete(frame.question.id);
        this.emit('question.closed', frame.question);
        break;
      case 'channel.updated':
        this.info = frame.channel;
        this.emit('updated', frame.channel);
        break;
      case 'channel.closed':
        this.emit('closed', frame.by);
        break;
      case 'claim.updated':
        if (frame.claim.status === 'done' || frame.claim.status === 'dropped') this.claims.delete(frame.claim.id);
        else this.claims.set(frame.claim.id, frame.claim);
        this.emit('claim.updated', frame.claim);
        break;
    }
  }

  /**
   * Asks the channel's owner (your person) a question and waits for the
   * outcome. Resolves with the question: `answered` (see `answer`),
   * `unattended` (questions are off: use your own judgement), `cancelled`, or
   * still `open` if `timeoutMs` passes first; the answer can still arrive later
   * as a 'question.closed' event.
   */
  async ask(question: string, options: { options?: string[]; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<UserQuestion> {
    const asked = await this.client.request('question.ask', { channel: this.address, question, options: options.options });
    if (asked.status !== 'open') return asked;
    return this.client.waitForQuestion(asked, options.timeoutMs ?? 120_000, options.signal);
  }

  /** Withdraws one of your open questions. */
  cancelQuestion(id: string): Promise<UserQuestion> {
    return this.client.request('question.cancel', { channel: this.address, question: id });
  }

  /** Answers an open question. Needs the owner key (defaults to this.ownerKey). */
  answer(id: string, answer: string, ownerKey = this.ownerKey): Promise<UserQuestion> {
    if (!ownerKey) return Promise.reject(new CrossTalkError('forbidden', "Answering needs this channel's owner key"));
    return this.client.request('question.answer', { channel: this.address, question: id, answer, ownerKey });
  }

  /** Turns questions on or off. Off answers new and waiting questions `unattended`. Needs the owner key. */
  async setQuestions(mode: QuestionsMode, ownerKey = this.ownerKey): Promise<ChannelInfo> {
    if (!ownerKey) throw new CrossTalkError('forbidden', "Changing settings needs this channel's owner key");
    this.info = await this.client.request('channel.configure', { channel: this.address, ownerKey, questions: mode });
    return this.info;
  }

  /**
   * Posts a message. With `split: true`, text over the channel's limit is
   * posted as numbered parts (`[1/3] …`) and the result is the first part,
   * with `parts` set; without it, oversize text rejects with `bad_request`.
   */
  async send(content: string, metadata?: Record<string, unknown>, options: { split?: boolean } = {}): Promise<ChannelMessage> {
    const message = await this.client.request('message.send', { channel: this.address, content, metadata, ...(options.split ? { split: true } : {}) });
    this.messages.push(message);
    return message;
  }

  /**
   * Registers your wake hook here: the hub POSTs a `crosstalk.wake` body to
   * `url` when you are @mentioned (or, with `on: 'all'`, on any message from
   * someone else), even while you are disconnected. Hub 2.10+.
   */
  setWakeHook(url: string, options: { on?: 'mentions' | 'all'; secret?: string; cooldownSeconds?: number } = {}): Promise<WakeHook> {
    return this.client.request('wake.set', { channel: this.address, url, ...options });
  }

  /** Removes your wake hook here. */
  async clearWakeHook(): Promise<boolean> {
    return (await this.client.request('wake.clear', { channel: this.address })).cleared;
  }

  /** Your wake hook here, with the result of its last delivery, or null. */
  async wakeHook(): Promise<WakeHook | null> {
    return (await this.client.request('wake.get', { channel: this.address })).hook;
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

  /**
   * Releases your lock on a file. `released` is false when you held none
   * (it had expired, was already released, or was never taken); older hubs
   * leave it undefined. Rejects with 'forbidden' when someone else holds it.
   */
  async unlock(file: string): Promise<{ channel: string; file: string; released?: boolean }> {
    const result = await this.client.request('lock.release', {
      channel: this.address,
      file: this.client.relativePath(file)
    });
    this.locks.delete(result.file);
    return result;
  }

  /** Locks you hold in this channel, from the live view. */
  myLocks(): FileLock[] {
    const me = this.client.agent?.id;
    return [...this.locks.values()].filter(l => l.holder.id === me);
  }

  /**
   * Tells the hub your agent has actually read the channel, up to message
   * `upTo` (default: everything). Being connected isn't reading: call this
   * when the messages reach the model, so others can see you're attending.
   */
  markRead(upTo?: string): Promise<MemberAttention> {
    return this.client.request('channel.read', { channel: this.address, upTo });
  }

  /**
   * Takes on a task: "on it" as a promise others can track. Post progress at
   * least every `everySeconds` (default 600) or the claim shows as stalled.
   */
  async claim(task: string, options: { everySeconds?: number; paths?: string[] } = {}): Promise<TaskClaim> {
    const claim = await this.client.request('claim.create', { channel: this.address, task, ...options });
    this.claims.set(claim.id, claim);
    return claim;
  }

  /**
   * A heartbeat on one claim (or all of yours here, when `claim` is omitted).
   * `note` is posted to the channel; `status` finishes or drops the claim.
   */
  async updateClaim(options: { claim?: string; note?: string; status?: 'done' | 'dropped' } = {}): Promise<TaskClaim[]> {
    const { claims } = await this.client.request('claim.update', { channel: this.address, ...options });
    for (const c of claims) {
      if (c.status === 'done' || c.status === 'dropped') this.claims.delete(c.id);
      else this.claims.set(c.id, c);
    }
    return claims;
  }

  /** Who has read each of the newest `limit` messages. */
  async receipts(limit?: number): Promise<MessageReceipt[]> {
    return (await this.client.request('channel.receipts', { channel: this.address, limit })).receipts;
  }

  /** Ends the conversation for every member. Needs the owner key (defaults to this.ownerKey). */
  async close(ownerKey = this.ownerKey): Promise<void> {
    if (!ownerKey) throw new CrossTalkError('forbidden', "Closing needs this channel's owner key");
    await this.client.request('channel.close', { channel: this.address, ownerKey });
    this.client.forget(this.address);
  }

  /**
   * Removes members by agent id or name, or bans an address with `ip:<address>`
   * (hub 2.17+). Needs the owner key. `ban` stops them rejoining; `ip` bans
   * their network addresses too.
   */
  kick(agent: string, options: { ban?: boolean; ip?: boolean; reason?: string } = {}, ownerKey = this.ownerKey): Promise<ResultData['member.kick']> {
    if (!ownerKey) throw new CrossTalkError('forbidden', "Kicking needs this channel's owner key");
    return this.client.request('member.kick', { channel: this.address, ownerKey, agent, ...options });
  }

  /** Lifts a ban by agent id, name or `ip:<address>`. Needs the owner key. */
  async unban(agent: string, ownerKey = this.ownerKey): Promise<number> {
    if (!ownerKey) throw new CrossTalkError('forbidden', "Unbanning needs this channel's owner key");
    return (await this.client.request('member.unban', { channel: this.address, ownerKey, agent })).unbanned;
  }

  /** The channel's bans (addresses are counted, not shown). Needs the owner key. */
  async bans(ownerKey = this.ownerKey): Promise<ChannelBan[]> {
    if (!ownerKey) throw new CrossTalkError('forbidden', "Listing bans needs this channel's owner key");
    return (await this.client.request('member.bans', { channel: this.address, ownerKey })).bans;
  }

  /**
   * Turns approval on or off (2.20+). On: someone new knocks and you admit
   * them; everyone already here gets a pass. Off: whoever is waiting comes in.
   */
  async setApproval(on: boolean, ownerKey = this.ownerKey): Promise<ChannelInfo> {
    if (!ownerKey) throw new CrossTalkError('forbidden', "Changing settings needs this channel's owner key");
    this.info = await this.client.request('channel.configure', { channel: this.address, ownerKey, approval: on });
    return this.info;
  }

  /**
   * Sets the channel's rules (2.31+): how agents here must work. Everyone is
   * shown them when they join and again when they change. Empty clears them.
   */
  async setRules(rules: string, ownerKey = this.ownerKey): Promise<ChannelInfo> {
    if (!ownerKey) throw new CrossTalkError('forbidden', "Changing settings needs this channel's owner key");
    this.info = await this.client.request('channel.configure', { channel: this.address, ownerKey, rules });
    return this.info;
  }

  /** The owner's rules for this channel, if any (2.31+). */
  get rules(): string | undefined {
    return this.info.rules;
  }

  /** Who is waiting to be let in. Needs the owner key. */
  async knocks(ownerKey = this.ownerKey): Promise<Knock[]> {
    if (!ownerKey) throw new CrossTalkError('forbidden', "Seeing who is waiting needs this channel's owner key");
    return (await this.client.request('member.knocks', { channel: this.address, ownerKey })).knocks;
  }

  /**
   * Makes another member (by name or agent id) an owner too: the hub hands
   * them this channel's owner key privately, and the channel sees a notice.
   * Use it to give the person you made a channel for control of it (e.g.
   * answering your questions from the web app). Needs the owner key.
   */
  async grantOwner(agent: string, ownerKey = this.ownerKey): Promise<AgentRef> {
    if (!ownerKey) throw new CrossTalkError('forbidden', "Making someone an owner needs this channel's owner key");
    return (await this.client.request('owner.grant', { channel: this.address, ownerKey, agent })).agent;
  }

  /** Lets someone waiting in (by name or agent id), or turns them away with `allow: false`. */
  async admit(agent: string, allow = true, ownerKey = this.ownerKey): Promise<Knock> {
    if (!ownerKey) throw new CrossTalkError('forbidden', "Letting people in needs this channel's owner key");
    return (await this.client.request('member.admit', { channel: this.address, ownerKey, agent, allow })).knock;
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
 * 'event' (every raw ServerFrame), 'disconnected', 'reconnected', 'error',
 * and after a reconnect that couldn't resume (the hub restarted without its
 * state, or the grace period passed): 'locks.lost' (LocksLost: the locks you
 * held, now released) and 'channel.lost' (ChannelLost: a channel the hub no
 * longer has, so you are no longer in it).
 */
export class CrossTalk extends EventEmitter {
  agent!: AgentInfo;
  /** The hub's CrossTalk version, from its welcome. */
  serverVersion?: string;
  /** Joined channels by address. */
  readonly channels = new Map<string, Channel>();
  /**
   * Passes for channels that approve new members (2.20+), by address. Filled
   * when you're admitted (or when approval is turned on while you're in);
   * listen for 'pass' to keep them across runs, and seed them with setPass().
   */
  readonly passes = new Map<string, string>();

  /** Remember a pass from an earlier run, so joining doesn't knock again. */
  setPass(address: string, pass: string): void {
    this.passes.set(address, pass);
  }
  private ws?: WebSocket;
  private readonly pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private readonly options: Required<Omit<ConnectOptions, 'branch' | 'currentTask' | 'sealKey' | 'pronouns' | 'client' | 'place'>> & Pick<ConnectOptions, 'branch' | 'currentTask' | 'sealKey' | 'pronouns' | 'client' | 'place'>;
  /**
   * connecting ──welcome──▶ open ──socket drops──▶ reconnecting ──welcome──▶ open
   *      │                    │                        │
   *      └────────────── close() from any state ───────┴──▶ closed (final)
   * Changed only in open(), the socket's close handler, scheduleReconnect and close().
   */
  private state: 'connecting' | 'open' | 'reconnecting' | 'closed' = 'connecting';
  /** The socket still saying hello, so close() can stop a handshake in flight. */
  private handshake?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectDelay = 500;
  /** Lets a reconnect carry on as the same agent (same id, channels, locks) within the hub's grace period. */
  private resumeToken?: string;
  /** Set when connect() found no hub on a localhost URL and started one in this process (autoStart). */
  hostedHub?: { url: string; stateFile?: string };
  /** Messages and DMs not yet consumed by waitForMessage(), so nothing arriving between calls is lost. */
  private unread: Array<ChannelMessage | DirectMessage> = [];
  private readonly wakeWaiters = new Set<() => void>();
  /** Recently closed questions, so an answer arriving between calls isn't missed. */
  private readonly closedQuestions = new Map<string, UserQuestion>();

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
      headers: { ...(options.invite ?? process.env.CROSSTALK_INVITE ? { 'X-CrossTalk-Invite': (options.invite ?? process.env.CROSSTALK_INVITE)! } : {}), ...options.headers },
      invite: options.invite ?? process.env.CROSSTALK_INVITE ?? '',
      name: options.name,
      branch: options.branch ?? git(['rev-parse', '--abbrev-ref', 'HEAD']),
      currentTask: options.currentTask,
      sealKey: options.sealKey,
      pronouns: options.pronouns ?? (process.env.CROSSTALK_PRONOUNS || undefined),
      client: options.client ?? detectClient(),
      place: options.place ?? detectPlace()
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
        const hub = await startServer({ port, quiet: true });
        client.hostedHub = { url: hub.url, stateFile: hub.stateFile };
        // Every other agent on this machine now depends on this process; say so.
        console.error(`[crosstalk] no hub was running on ${hub.url}, so this process (pid ${process.pid}) started one. ` +
          `It stops when this process exits${hub.stateFile ? `; channels and locks are saved to ${hub.stateFile} and come back when a hub starts again` : ''}. ` +
          'Run `crosstalk serve` for a hub that outlives sessions.');
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
      const headers: Record<string, string> = { ...this.options.headers };
      if (this.options.token) {
        headers.Authorization = `Bearer ${this.options.token}`;
        const loopback = /^(localhost|127\.|\[::1\])/.test(url.hostname);
        if (url.protocol === 'ws:' && !loopback) {
          console.warn('[crosstalk] sending the hub token over unencrypted ws:// to a remote host; prefer wss://');
        }
      }
      const ws = new WebSocket(url, { headers, handshakeTimeout: 10_000 });
      this.handshake = ws;
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
            currentTask: this.options.currentTask,
            sealKey: this.options.sealKey,
            pronouns: this.options.pronouns,
            client: this.options.client,
            place: this.options.place
          },
          resume: this.resumeToken
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
            if (this.handshake === ws) this.handshake = undefined;
            if (this.state === 'closed') {
              // close() was called while we were saying hello: leave, deliberately.
              ws.close(1000, 'client closed');
              reject(new CrossTalkError('disconnected', 'Client closed'));
              return;
            }
            this.state = 'open';
            this.ws = ws;
            this.agent = frame.agent;
            this.serverVersion = frame.serverVersion;
            this.resumeToken = frame.resumeToken;
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
        if (this.handshake === ws) this.handshake = undefined;
        if (!welcomed) {
          clearTimeout(giveUp);
          reject(new CrossTalkError('disconnected', `Hub closed the connection (${code}${reason.length ? `: ${reason}` : ''})`));
          return;
        }
        if (this.ws !== ws) return; // an old socket, already replaced
        this.ws = undefined;
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new CrossTalkError('disconnected', 'Connection closed'));
          this.pending.delete(id);
        }
        this.emit('disconnected');
        if (this.state === 'closed') return;
        if (this.options.reconnect) {
          this.state = 'reconnecting';
          this.scheduleReconnect();
        } else {
          this.state = 'closed';
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.state !== 'reconnecting' || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.reconnect();
    }, delay);
    this.reconnectTimer.unref();
  }

  private async reconnect(): Promise<void> {
    if (this.state !== 'reconnecting') return;
    const before = this.agent?.id;
    const held = [...this.channels.values()].flatMap(ch => [...ch.locks.values()].filter(l => l.holder.id === before));
    try {
      await this.open();
    } catch {
      this.scheduleReconnect(); // no-op once closed
      return;
    }
    const resumed = this.agent.id === before;
    // Resumed within the grace period: same agent, and missed frames were
    // replayed. Otherwise this is a new agent id. Either way, rejoining
    // (a no-op for channels we're still in) refreshes every snapshot.
    for (const channel of [...this.channels.values()]) {
      if (!this.isOpen()) return; // dropped again: the next reconnect rejoins what's left
      try {
        channel.apply(await this.request('channel.join', { channel: channel.address, pass: this.passes.get(channel.address), ownerKey: channel.ownerKey }));
      } catch (err) {
        if (err instanceof CrossTalkError && (err.code === 'not_found' || err.code === 'forbidden')) {
          // Only a channel the hub no longer has, or won't let us back into, is forgotten.
          this.channels.delete(channel.address);
          const lost: ChannelLost = err.code === 'forbidden'
            ? { channel: channel.address, name: channel.name, reason: 'kicked', banned: true }
            : { channel: channel.address, name: channel.name, reason: 'hub_restarted' };
          this.safeEmit('channel.lost', lost);
          this.safeEmit.call(channel, 'lost', lost);
        } else if (!this.isOpen()) {
          return; // dropped mid-rejoin: keep the channel for the next attempt
        } else {
          this.report(err);
        }
      }
    }
    if (!resumed && held.length) this.safeEmit('locks.lost', { locks: held, reason: 'not_resumed' } satisfies LocksLost);
    this.safeEmit('reconnected', this.agent);
  }

  /** Read fresh each time: open() and the socket's close handler change the state between awaits. */
  private isOpen(): boolean {
    return this.state === 'open';
  }

  /** Emits without letting a throwing listener disturb the connection (it is reported instead). */
  private safeEmit(this: EventEmitter, event: string, ...args: unknown[]): void {
    try {
      this.emit(event, ...args);
    } catch (err) {
      if (this.listenerCount('error') > 0) this.emit('error', err);
    }
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
    if (frame.type === 'error') return this.report(new CrossTalkError(frame.error.code, frame.error.message));
    if (frame.type === 'channel.admitted') {
      this.passes.set(frame.channel, frame.pass);
      this.safeEmit('pass', { channel: frame.channel, pass: frame.pass });
    }
    if (frame.type === 'channel.owner') {
      // Made an owner by another owner: keep the key on the channel; listeners may save it.
      const ch = this.channels.get(frame.channel);
      if (ch) ch.ownerKey = frame.ownerKey;
      this.safeEmit('owner', { channel: frame.channel, ownerKey: frame.ownerKey, by: frame.by });
    }
    if (frame.type === 'dm' || frame.type === 'message') this.queue(frame.message);
    if (frame.type === 'question.closed') {
      this.closedQuestions.set(frame.question.id, frame.question);
      if (this.closedQuestions.size > 200) this.closedQuestions.delete(this.closedQuestions.keys().next().value!);
    }
    const address = channelOf(frame);
    if (address) this.channels.get(address)?.handle(frame);
    switch (frame.type) {
      case 'dm': case 'message': return void this.emit(frame.type, frame.message);
      case 'lock.contended': return void this.emit(frame.type, frame);
      case 'question.asked': return void this.emit(frame.type, frame.question);
      case 'claim.updated': return void this.emit(frame.type, frame.claim);
      case 'channel.closed': return this.forget(frame.channel);
      case 'channel.kicked': {
        const ch = this.channels.get(frame.channel);
        this.forget(frame.channel);
        const lost: ChannelLost = { channel: frame.channel, name: ch?.name ?? frame.channel, reason: 'kicked', by: frame.by, banned: frame.banned, note: frame.reason };
        this.safeEmit('channel.lost', lost);
        if (ch) this.safeEmit.call(ch, 'lost', lost);
        return;
      }
      case 'question.closed':
        this.emit(frame.type, frame.question);
        for (const wake of this.wakeWaiters) wake();
    }
  }

  /** @internal Waits for an open question to close, up to `timeoutMs` or until `signal` aborts. */
  waitForQuestion(question: UserQuestion, timeoutMs: number, signal?: AbortSignal): Promise<UserQuestion> {
    const closed = () => this.closedQuestions.get(question.id);
    if (closed() || signal?.aborted) return Promise.resolve(closed() ?? question);
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        this.wakeWaiters.delete(check);
        signal?.removeEventListener('abort', done);
        resolve(closed() ?? question);
      };
      const check = () => closed() && done();
      const timer = setTimeout(done, timeoutMs);
      this.wakeWaiters.add(check);
      signal?.addEventListener('abort', done, { once: true });
    });
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
  /** `limits`: message length and rate for this channel, fixed for its life; unset ones take the hub's defaults. */
  async createChannel(name?: string, options: { topic?: string; public?: boolean; limits?: Partial<ChannelLimits>; approval?: boolean } = {}): Promise<Channel> {
    const created = await this.request('channel.create', {
      limits: options.limits,
      name,
      topic: options.topic,
      visibility: options.public ? 'public' : 'private',
      ...(options.approval ? { approval: true } : {})
    });
    const channel = this.track(created);
    channel.ownerKey = created.ownerKey;
    if (created.pass) {
      this.passes.set(channel.address, created.pass);
      this.safeEmit('pass', { channel: channel.address, pass: created.pass });
    }
    return channel;
  }

  /** Joins a conversation by its address (`xt_...`). */
  /** `since`: a message id you already have; the snapshot then holds only newer messages. */
  /**
   * In a channel that approves new members, joining knocks and (by default)
   * waits until the owner lets you in, then joins with the pass you were
   * given; 'knocking' is emitted while you wait. A refusal throws
   * `CrossTalkError('forbidden')`. `wait: false` throws `pending_approval`
   * at once instead; `waitMs` gives up after that long.
   */
  async joinChannel(address: string, options: { since?: string; pass?: string; ownerKey?: string; wait?: boolean; waitMs?: number } = {}): Promise<Channel> {
    const parsed = parseAddress(address);
    if (parsed?.hub && !sameHub(parsed.hub, this.url)) {
      throw new CrossTalkError('bad_request', `${address.trim()} is on the hub at ${parsed.hub}, but this client is connected to ${this.url}. Connect to that hub to join it.`);
    }
    const channel = parsed?.channel ?? address.trim();
    const attempt = () => this.request('channel.join', { channel, since: options.since, pass: options.pass ?? this.passes.get(channel), ownerKey: options.ownerKey });
    try {
      return this.track(await attempt());
    } catch (err) {
      if (!(err instanceof CrossTalkError) || err.code !== 'pending_approval' || options.wait === false) throw err;
    }
    this.safeEmit('knocking', { channel });
    const pass = await new Promise<string>((resolve, reject) => {
      const timer = options.waitMs ? setTimeout(() => { this.off('event', on); reject(new CrossTalkError('pending_approval', 'Still waiting for the host to let you in')); }, options.waitMs) : undefined;
      const on = (f: ServerFrame) => {
        if ((f.type === 'channel.admitted' || f.type === 'channel.refused') && f.channel === channel) {
          this.off('event', on);
          if (timer) clearTimeout(timer);
          if (f.type === 'channel.admitted') resolve(f.pass);
          else reject(new CrossTalkError('forbidden', `${f.by.name} didn't let you in to this channel`));
        }
      };
      this.on('event', on);
    });
    return this.track(await this.request('channel.join', { channel, since: options.since, pass, ownerKey: options.ownerKey }));
  }

  static isAddress(value: string): boolean {
    return isAnyAddress(value);
  }

  /** A joined channel by address, or by label when exactly one joined channel has it. */
  channel(addressOrName: string): Channel | undefined {
    const key = addressOrName.trim();
    const byAddress = this.channels.get(channelId(key) ?? key);
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

  async setStatus(status: AgentStatus | undefined, currentTask?: string, options: { pronouns?: string; name?: string; client?: string; place?: AgentPlace; bio?: string } = {}): Promise<AgentInfo> {
    this.agent = await this.request('status.update', { status, currentTask, ...(options.pronouns !== undefined ? { pronouns: options.pronouns } : {}), ...(options.name ? { name: options.name } : {}), ...(options.client ? { client: options.client } : {}), ...(options.place ? { place: options.place } : {}), ...(options.bio !== undefined ? { bio: options.bio } : {}) });
    if (options.client) (this.options as { client?: string }).client = options.client;
    // Reconnects keep the new name.
    if (options.name) (this.options as { name: string }).name = this.agent.name;
    if (options.pronouns !== undefined) this.options.pronouns = options.pronouns || undefined;
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
    this.state = 'closed';
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    // A hello in flight is let finish: its welcome (which may resume our parked
    // agent) is answered with a deliberate close in open(), so the hub sees us
    // leave instead of holding a parked agent for its grace period.
    const greeting = this.handshake;
    if (greeting) await new Promise<void>(resolve => greeting.once('close', () => resolve()));
    const ws = this.ws;
    if (!ws) return;
    await new Promise<void>(resolve => {
      ws.once('close', () => resolve());
      ws.close(1000, 'client closed');
    });
  }
}

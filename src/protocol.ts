/**
 * CrossTalk wire protocol (v2).
 *
 * Every frame is a single JSON object. Client frames that carry an `id` are
 * requests: the hub answers each with exactly one `result` frame echoing that
 * `id`. Everything else the hub sends is an unsolicited event.
 *
 * The first frame on a connection must be `hello`.
 *
 * Every conversation (channel) has its own unguessable address, e.g.
 * `xt_Qm9r3vKx1pZ8aT2cL5nWdA`. The address is how agents join and how every
 * request names the channel; the channel's `name` is only a display label.
 * Private channels (the default) are reachable only by agents who are given
 * the address. Public channels are additionally listed for discovery.
 *
 * Questions for the user: an agent that needs its person (an approval, a
 * decision) asks with `question.ask`. Only someone holding the channel's
 * owner key (returned once, to the creator, by `channel.create`) can answer
 * or switch questions off. With questions off, a new question comes straight
 * back `unattended`, telling the agent to use its own judgement.
 *
 * Attention: being connected is not the same as reading. A client reports
 * that its agent has actually seen the channel with `channel.read` (joining
 * and `channel.state` count too). The hub tracks each member's last read and
 * unread count, shows them in snapshots as `attention`, and warns a sender
 * when an `@mention` names someone who hasn't read in a while.
 *
 * Claims: "on it" is only a promise once it is a claim (`claim.create`): a
 * task, an owner, and when the next update is due. Progress posts in the
 * channel, `claim.update` and lock activity are heartbeats. A claim that
 * misses its heartbeat turns `stalled`, which the channel (and so its owner's
 * `crosstalk inbox`) and the claiming agent are told about.
 */

export const PROTOCOL_VERSION = 2;

export type AgentEnvironment = 'ide' | 'terminal' | 'bot' | 'web';
export type AgentStatus = 'idle' | 'working' | 'waiting';
export type ChannelVisibility = 'public' | 'private';
/** Whether agents can put questions to the channel's owner. */
export type QuestionsMode = 'on' | 'off';

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  environment: AgentEnvironment;
  branch?: string;
  status: AgentStatus;
  currentTask: string;
  connectedAt: number;
  lastSeen: number;
  /** Joined from outside this hub's machine with a remote invite (#13). */
  remote?: boolean;
  /** The label of the invite a remote agent joined with. */
  via?: string;
}

/** A reference to the sender embedded in messages; kept small on purpose. */
export interface AgentRef {
  id: string;
  name: string;
  /**
   * Set when the agent joined from outside the hub's machine with a remote
   * invite (#13), on everything it sends: messages, DMs, locks, claims,
   * questions. A name is just a label anyone can pick; this is the hub's word.
   */
  remote?: true;
}

/**
 * A channel's message limits. They are set when the channel is created and
 * never change: a mesh has no owner to change them later. The hub caps what
 * a creator can ask for.
 */
export interface ChannelLimits {
  /** Longest message, in characters. */
  maxMessageChars: number;
  /** Messages one member may post per minute. */
  messagesPerMinute: number;
  /** Messages one member may post back to back before the per-minute rate applies. */
  messageBurst: number;
}

export interface ChannelInfo {
  /** The channel's address. Share it to invite others. */
  id: string;
  /** Display label; not unique. */
  name: string;
  topic: string;
  visibility: ChannelVisibility;
  createdBy: AgentRef;
  createdAt: number;
  lastActivity: number;
  memberCount: number;
  maxMembers: number;
  /** 'off' means the owner isn't taking questions: new ones come back `unattended`. */
  questions: QuestionsMode;
  /**
   * Approve new members (2.20+), like a meeting link: someone new with the
   * address knocks, and the owner admits or denies them. Admitted members get
   * a pass they show when they rejoin.
   */
  approval?: boolean;
  /** Fixed at creation. Rates aren't enforced on hubs started with rate limiting off. */
  limits: ChannelLimits;
}

/** One holder's share of a slot. */
export interface SlotHold {
  holder: AgentRef;
  acquiredAt: number;
  expiresAt: number;
}

/**
 * A counted semaphore for a shared resource (heavy builds, a test server, a
 * port range): at most `capacity` agents hold it at once, and the rest queue.
 * The first `slot.acquire` fixes the capacity; it resets once the slot has no
 * holders and no waiters.
 */
export interface Slot {
  /** Channel address. */
  channel: string;
  name: string;
  capacity: number;
  holders: SlotHold[];
  /** Agents queued for it. */
  waiting: number;
}

/** A remote invite as its owner sees it. The key itself is never shown again after creation. */
export interface InviteInfo {
  /** First 12 hex characters of the key's hash; enough to revoke it by. */
  id: string;
  channel: string;
  label: string;
  createdAt: number;
  expiresAt?: number;
  maxAgents?: number;
  /** Agents admitted so far. */
  admitted: number;
  /** Of those, how many are connected now. */
  online: number;
  status: 'active' | 'expired' | 'revoked';
}

export interface FileLock {
  /** Channel address. */
  channel: string;
  file: string;
  holder: AgentRef;
  reason: string;
  acquiredAt: number;
  expiresAt: number;
}

/** `notice` (2.11+): posted by the hub itself (from `{ id: 'hub', name: 'hub' }`), e.g. when a member's listener stops. */
export type MessageKind = 'chat' | 'shorthand' | 'notice';

export interface ChannelMessage {
  id: string;
  /** Channel address. */
  channel: string;
  kind: MessageKind;
  from: AgentRef;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  /** Channel members addressed as `@name` in the content, so wait loops can pick out what needs them. */
  mentions?: AgentRef[];
  /**
   * Only on the sender's own `message.send` / `shorthand.send` result, never
   * broadcast: mentioned members who haven't read the channel recently and
   * may not see this soon.
   */
  idleMentions?: MemberAttention[];
  /**
   * Only on the sender's own `message.send` result when it asked for
   * `split: true` and the text was over the channel limit: how many messages
   * it was posted as. The result is the first part.
   */
  parts?: number;
  /** Present when kind === 'shorthand'. `content` holds the English expansion. */
  shorthand?: {
    raw: string;
    action?: string;
    target?: string;
    intent?: string;
  };
}

export interface DirectMessage {
  id: string;
  from: AgentRef;
  to: AgentRef;
  content: string;
  timestamp: number;
  /** Signals the recipient that no reply is wanted (prevents ack ping-pong). */
  replyExpected: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * An agent's question for the channel's owner (its person). `open` until the
 * owner answers, the asker cancels or leaves, or questions are switched off.
 */
export interface UserQuestion {
  id: string;
  /** Channel address. */
  channel: string;
  from: AgentRef;
  question: string;
  /** Suggested answers; the owner may still answer freely. */
  options: string[];
  createdAt: number;
  status: 'open' | 'answered' | 'cancelled' | 'unattended';
  /** Set when status is 'answered'. Written by the holder of the owner key. */
  answer?: string;
  closedAt?: number;
}

/** Whether a member is actually reading a channel, not just connected to it. */
export interface MemberAttention {
  agent: AgentRef;
  /** False while the transport is gone and the hub is holding the member's place for a reconnect. */
  connected: boolean;
  /** When the member last read this channel (`channel.read`, `channel.state`, joining, or polling for events). */
  lastReadAt: number;
  /** Messages from others posted since that read. */
  unread: number;
  /** Timestamp of the oldest of those. */
  oldestUnreadAt?: number;
  /** Hasn't read for longer than the hub's idle threshold. */
  idle: boolean;
  /**
   * Only for members that listen by long-polling GET /v1/events (2.11+): true
   * while a poll is open or ended recently, false once none has been open for
   * the hub's listener grace period (default 5 minutes).
   */
  listening?: boolean;
}

/** Who has and hasn't read one message. */
export interface MessageReceipt {
  message: string;
  from: AgentRef;
  timestamp: number;
  readBy: AgentRef[];
  /** `connected: false`: the transport is gone, so it hasn't even been delivered yet. */
  unreadBy: Array<{ agent: AgentRef; connected: boolean }>;
}

/** A task an agent has taken on, with heartbeats so a silent "on it" shows up as stalled. */
export interface TaskClaim {
  id: string;
  /** Channel address. */
  channel: string;
  owner: AgentRef;
  task: string;
  createdAt: number;
  /** Last heartbeat: a progress post in the channel, `claim.update`, or a lock taken or released. */
  lastHeartbeat: number;
  /** How often the owner promised an update. */
  everyMs: number;
  /** `lastHeartbeat + everyMs`; past it, the claim is `stalled`. */
  nextUpdateBy: number;
  status: 'active' | 'stalled' | 'done' | 'dropped';
  /** Latest progress note. */
  note?: string;
  /** Files or directories the work covers, for tooling that heartbeats on file changes or commits there. */
  paths?: string[];
  closedAt?: number;
}

export interface ChannelSnapshot {
  channel: ChannelInfo;
  members: AgentInfo[];
  /** One entry per member: who is reading and who has fallen behind. */
  attention: MemberAttention[];
  locks: FileLock[];
  messages: ChannelMessage[];
  /** Open questions for the owner. */
  questions: UserQuestion[];
  /** Active and stalled claims. */
  claims: TaskClaim[];
  /** Slots in use or waited for. Missing from hubs older than 2.9. */
  slots?: Slot[];
  /**
   * On `channel.join` only (2.10+): how to stay reachable in this channel.
   * Plain text meant to be shown to the agent as-is.
   */
  guidance?: string;
}

/**
 * A wake hook (2.10+): when its agent is @mentioned in the channel (or, with
 * `on: 'all'`, on any message from someone else), the hub POSTs a
 * `crosstalk.wake` JSON body to `url`, so an agent with nothing running can be
 * started by whatever listens there (a serverless function, a CI dispatch, a
 * local daemon that runs your agent). Lasts as long as the channel; saved with
 * hub state when the hub has a state file.
 */
export interface WakeHook {
  channel: string;
  agent: string;
  url: string;
  on: 'mentions' | 'all';
  /** Minimum seconds between two POSTs for this hook. */
  cooldownSeconds: number;
  /** True when a secret was set: each POST then carries X-CrossTalk-Signature: sha256=<hex HMAC of the body>. */
  signed: boolean;
  createdAt: number;
  lastFiredAt?: number;
  /** HTTP status of the last POST, or 0 when it failed to connect or timed out. */
  lastStatus?: number;
  lastError?: string;
}

/** Shown to an agent when it joins a channel (snapshot.guidance), and in invites. */
export const STAY_AWAKE_GUIDANCE = [
  'ACTION REQUIRED: start a listener now, before your next step, and keep one running for as long as you are in this channel. Nobody will nudge you; without a listener you miss messages and the hub tells the channel you stopped listening after 5 minutes.',
  '- Background commands (Claude Code and similar): `crosstalk new` / `crosstalk join <channel>` start your listener: run them as a background command and end your turn. They exit when someone @mentions or DMs you, which wakes you: handle it, then run `crosstalk join <channel>` again. If nobody else joins within 5 minutes the listener turns itself off and says so: tell your user, and restart it when they say their agents are ready (`--listen-timeout 0` keeps it on). Over plain HTTP, run the `listen.command` the hub gave you the same way. If a listener stops for any other reason (a time limit, `not_registered` after a hub restart), start it again the same way.',
  '- MCP tools only: end every turn with crosstalk_wait.',
  '- Nothing can run between turns: register a wake hook (wake.set, `crosstalk wake-hook`) so the hub POSTs to your URL when you are @mentioned or DMed.',
  'If someone you are working with goes quiet for 30+ minutes, @mention them.'
].join('\n');

/**
 * What an HTTP agent should run to listen (2.12+): returned as `listen` from
 * POST /v1/sessions and on HTTP channel.create / channel.join results.
 * `command` is a ready-to-run shell loop that exits when the agent is needed.
 */
export interface HttpListen {
  url: string;
  header: string;
  command: string;
  guidance: string;
}

export function httpListen(httpBase: string, session: string): HttpListen {
  const url = `${httpBase.replace(/\/+$/, '')}/v1/events?wait=50&only=mentions`;
  const header = `X-CrossTalk-Session: ${session}`;
  const command = `while true; do r=$(curl -s '${url}' -H '${header}'); case "$r" in *not_registered*) echo "$r"; exit 1;; '{"events":[]}') ;; *) echo "$r"; exit 0;; esac; done`;
  return { url, header, command, guidance: STAY_AWAKE_GUIDANCE };
}

/**
 * Someone the owner banned (2.17+): matched on rejoin by agent id, by name,
 * and (when banned with `ip`) by network address. The addresses themselves
 * are never shown, only how many there are.
 */
export interface ChannelBan {
  name: string;
  ids: string[];
  /** How many network addresses are banned with it. */
  ipCount: number;
  at: number;
  by: AgentRef;
  reason?: string;
}

/** The body the hub POSTs to a wake hook. */
export interface WakePayload {
  type: 'crosstalk.wake';
  /** `dm`: a direct message to you (2.11+), fired through your hook in a channel you share with the sender. */
  reason: 'mention' | 'message' | 'dm';
  hub: string;
  channel: { id: string; name: string };
  agent: string;
  /** Who sent it (same as message.from). */
  from: AgentRef;
  /** The text (same as message.content, first 2,000 characters). */
  text: string;
  message: { id: string; from: AgentRef; content: string; timestamp: number };
  /** Messages posted in the channel since this hook last fired, including this one. */
  pending: number;
}

/** `channel.create` also returns the owner key, once. Keep it private: it answers questions. */
export interface CreatedChannel extends ChannelSnapshot {
  ownerKey: string;
  /** With approval on: the creator's pass, for rejoining without the owner key. */
  pass?: string;
}

/** Someone new asking to join a channel that approves new members. */
export interface Knock {
  agent: AgentRef;
  environment?: string;
  at: number;
  status: 'waiting' | 'admitted' | 'denied' | 'left';
}

// ---------------------------------------------------------------------------
// Client -> Hub
// ---------------------------------------------------------------------------

export interface HelloFrame {
  type: 'hello';
  protocol: number;
  agent: {
    name: string;
    role?: string;
    environment?: AgentEnvironment;
    branch?: string;
    currentTask?: string;
  };
  /** Resume token from an earlier welcome: carry on as that agent if the hub still holds it. */
  resume?: string;
}

/** Requests; each gets a `result` frame with the matching `id`. */
export type RequestFrame =
  /** `limits`: any you leave out take the hub's defaults; values above the hub's ceilings are refused. */
  | { type: 'channel.create'; id: string; name?: string; topic?: string; visibility?: ChannelVisibility; limits?: Partial<ChannelLimits>; approval?: boolean }
  /** `since`: a message id; the snapshot then holds only newer messages (all of them if the id has aged out). */
  /**
   * In a channel that approves new members, someone new is refused with
   * `pending_approval` and the owner is asked (`channel.knock`); once admitted
   * they get `channel.admitted` with a pass, and join again with it. The
   * owner key also gets in.
   */
  | { type: 'channel.join'; id: string; channel: string; since?: string; pass?: string; ownerKey?: string }
  | { type: 'channel.leave'; id: string; channel: string }
  | { type: 'channel.list'; id: string; scope?: 'joined' | 'public'; limit?: number; cursor?: string }
  | { type: 'channel.state'; id: string; channel: string; since?: string }
  /** `text` is accepted as an alias for `content`. */
  /**
   * `split: true` posts text over the channel limit as numbered parts
   * (`[1/3] …`) instead of failing. Without it, oversize text fails with
   * `bad_request` and `details.maxMessageChars`.
   */
  | { type: 'message.send'; id: string; channel: string; content: string; text?: string; metadata?: Record<string, unknown>; split?: boolean }
  | { type: 'shorthand.send'; id: string; channel: string; shorthand: string }
  | { type: 'dm.send'; id: string; to: string; content: string; text?: string; replyExpected?: boolean; metadata?: Record<string, unknown> }
  | { type: 'lock.acquire'; id: string; channel: string; file: string; reason: string; ttlSeconds?: number }
  | { type: 'lock.release'; id: string; channel: string; file: string }
  /** Owner only: a key that lets agents outside this machine join this one channel through the hub's public listener (#13). */
  | { type: 'invite.create'; id: string; channel: string; ownerKey: string; label?: string; expiresInSeconds?: number; maxAgents?: number }
  | { type: 'invite.list'; id: string; channel: string; ownerKey: string }
  /** `invite` is an id prefix (from invite.list), a label, or "all". Agents admitted with it are disconnected at once. */
  | { type: 'invite.revoke'; id: string; channel: string; ownerKey: string; invite: string }
  /**
   * Takes the lock if it's free, or queues for it. Queued agents get a
   * `lock.granted` event, in order, when the lock is released or expires.
   * Leaving the channel or disconnecting drops your place; so does
   * `lock.release` on that file.
   */
  | { type: 'lock.wait'; id: string; channel: string; file: string; reason: string; ttlSeconds?: number }
  /**
   * Takes one place in slot `name` (letters, digits, `.`, `_`, `:`, `-`; up
   * to 64 characters), or queues for it when all `capacity` places are
   * taken. Queued agents get `slot.granted`, in order. Asking again while you
   * hold a place renews it for `ttlSeconds` (default 300, max 1800). Places
   * go when you release them, when they expire, or when you leave or
   * disconnect. `capacity` (1 to 64) must not exceed the slot's current one.
   */
  | { type: 'slot.acquire'; id: string; channel: string; name: string; capacity: number; ttlSeconds?: number }
  /** Gives up your place in a slot, or your place in its queue. */
  | { type: 'slot.release'; id: string; channel: string; name: string }
  | { type: 'status.update'; id: string; status?: AgentStatus; currentTask?: string }
  | { type: 'question.ask'; id: string; channel: string; question: string; options?: string[] }
  | { type: 'question.cancel'; id: string; channel: string; question: string }
  | { type: 'question.answer'; id: string; channel: string; question: string; answer: string; ownerKey: string }
  | { type: 'channel.configure'; id: string; channel: string; ownerKey: string; questions?: QuestionsMode; approval?: boolean }
  /**
   * Sets (or replaces) your wake hook in a channel: the hub POSTs to `url` when
   * you are @mentioned (`on: 'mentions'`, default) or on any message from
   * someone else (`on: 'all'`), and when someone who shares the channel DMs you. `secret` signs each POST. `cooldownSeconds`
   * (default 30, 5 to 3600) spaces POSTs. The hook outlives your connection,
   * so you can disconnect and still be woken. Hooks are kept by agent name.
   */
  | { type: 'wake.set'; id: string; channel: string; url: string; on?: 'mentions' | 'all'; secret?: string; cooldownSeconds?: number }
  /**
   * Removes members from the channel (2.17+). Needs the owner key. `agent` is
   * an agent id, or a name (every member with that name, case-insensitive),
   * or `ip:<address>` to ban an address directly. `ban` also stops those ids
   * and that name from rejoining until unbanned; `ip` adds the members'
   * network addresses to the ban (careful: agents behind one NAT or cloud
   * proxy share an address). MAC addresses never reach the hub, so they
   * can't be banned.
   */
  | { type: 'member.kick'; id: string; channel: string; ownerKey: string; agent: string; ban?: boolean; ip?: boolean; reason?: string }
  /** Lifts a ban by agent id or name. Needs the owner key. */
  | { type: 'member.unban'; id: string; channel: string; ownerKey: string; agent: string }
  /** The channel's bans. Needs the owner key. */
  | { type: 'member.bans'; id: string; channel: string; ownerKey: string }
  /** Admits or denies someone waiting to join (2.20+). Needs the owner key. */
  | { type: 'member.admit'; id: string; channel: string; ownerKey: string; agent: string; allow: boolean }
  /** Who is waiting to join. Needs the owner key. */
  | { type: 'member.knocks'; id: string; channel: string; ownerKey: string }
  /** Removes your wake hook in a channel. */
  | { type: 'wake.clear'; id: string; channel: string }
  /** Your wake hook in a channel, with its last delivery result. */
  | { type: 'wake.get'; id: string; channel: string }
  /** Marks the channel read, up to message `upTo` (default: everything so far). */
  | { type: 'channel.read'; id: string; channel: string; upTo?: string }
  /** Read receipts for the newest `limit` messages (default 20, max 100). */
  | { type: 'channel.receipts'; id: string; channel: string; limit?: number }
  /** Takes on a task. `everySeconds`: how often you'll post progress (default 600, 60 to 7200). */
  | { type: 'claim.create'; id: string; channel: string; task: string; everySeconds?: number; paths?: string[] }
  /**
   * A heartbeat on one of your claims, or on all of them in the channel when
   * `claim` is omitted. `note` is also posted to the channel as progress;
   * `status` finishes (`done`) or gives up (`dropped`) the claim.
   */
  | { type: 'claim.update'; id: string; channel: string; claim?: string; note?: string; status?: 'done' | 'dropped' }
  /** Ends the conversation for everyone: members are removed, locks and open questions dropped. Needs the owner key. */
  | { type: 'channel.close'; id: string; channel: string; ownerKey: string };

export type ClientFrame = HelloFrame | RequestFrame;

/** What each request resolves with on success. */
export interface ResultData {
  'channel.create': CreatedChannel;
  'channel.join': ChannelSnapshot;
  'channel.leave': { channel: string };
  /** `cursor` is set when more public channels are available. */
  'channel.list': { channels: ChannelInfo[]; cursor?: string };
  'channel.state': ChannelSnapshot;
  'message.send': ChannelMessage;
  'shorthand.send': ChannelMessage;
  'dm.send': DirectMessage;
  'lock.acquire': FileLock;
  /** `key` (xi_…) is shown once; the hub keeps only its hash. */
  'invite.create': { key: string; invite: InviteInfo };
  'invite.list': { invites: InviteInfo[] };
  'invite.revoke': { revoked: InviteInfo[]; disconnected: number };
  /** `released` is false when you held no lock on the file (already expired, released, or never taken). */
  'lock.release': { channel: string; file: string; released: boolean; dequeued?: boolean };
  /** `granted` when the lock was free (or already yours); otherwise your 1-based place in the queue and the lock you're waiting on. */
  'lock.wait': { granted: FileLock } | { queued: true; position: number; lock: FileLock };
  'slot.acquire': { granted: Slot } | { queued: true; position: number; slot: Slot };
  /** `released` is false when you held no place; `dequeued` is true if that dropped your place in its queue. */
  'slot.release': { channel: string; name: string; released: boolean; dequeued?: boolean };
  'status.update': AgentInfo;
  'question.ask': UserQuestion;
  'question.cancel': UserQuestion;
  'question.answer': UserQuestion;
  'channel.configure': ChannelInfo;
  'member.kick': { channel: string; kicked: AgentRef[]; banned: boolean };
  'member.unban': { channel: string; unbanned: number };
  'member.bans': { channel: string; bans: ChannelBan[] };
  'member.admit': { channel: string; knock: Knock };
  'member.knocks': { channel: string; knocks: Knock[] };
  'wake.set': WakeHook;
  'wake.clear': { channel: string; cleared: boolean };
  'wake.get': { hook: WakeHook | null };
  'channel.read': MemberAttention;
  'channel.close': { channel: string };
  'channel.receipts': { receipts: MessageReceipt[] };
  'claim.create': TaskClaim;
  'claim.update': { claims: TaskClaim[] };
}

// ---------------------------------------------------------------------------
// Hub -> Client
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'not_registered'
  | 'not_found'
  | 'not_member'
  | 'already_exists'
  | 'forbidden'
  | 'lock_held'
  | 'quota_exceeded'
  | 'rate_limited'
  /** The channel approves new members: you're waiting for the owner (2.20+). */
  | 'pending_approval'
  | 'internal';

export interface HubError {
  code: ErrorCode;
  message: string;
  /** Extra context, e.g. the current lock for `lock_held`. */
  details?: unknown;
}

export type ServerFrame =
  | { type: 'welcome'; protocol: number; agent: AgentInfo; serverVersion: string; resumeToken?: string; resumed?: boolean }
  | { type: 'result'; id: string; ok: true; data: unknown }
  | { type: 'result'; id: string; ok: false; error: HubError }
  | { type: 'error'; error: HubError }
  | { type: 'member.joined'; channel: string; agent: AgentInfo }
  | { type: 'member.left'; channel: string; agent: AgentRef; reason: 'left' | 'disconnected' | 'kicked' }
  /** To the agent the owner removed (2.17+): it is no longer in the channel, and with `banned` can't rejoin. */
  | { type: 'channel.kicked'; channel: string; by: AgentRef; reason?: string; banned: boolean }
  /** To members (2.20+): someone is waiting to join, or was admitted or denied. Only the owner can decide. */
  | { type: 'channel.knock'; channel: string; knock: Knock }
  /** To the one admitted: join again with this pass (keep it; it gets you back in later). */
  | { type: 'channel.admitted'; channel: string; pass: string; by: AgentRef }
  /** To the one denied. */
  | { type: 'channel.refused'; channel: string; by: AgentRef }
  | { type: 'member.updated'; channel: string; agent: AgentInfo }
  | { type: 'message'; message: ChannelMessage }
  | { type: 'dm'; message: DirectMessage }
  | { type: 'lock.acquired'; lock: FileLock }
  | { type: 'lock.released'; channel: string; file: string; by: AgentRef; reason: 'released' | 'expired' | 'disconnected' }
  | { type: 'lock.contended'; lock: FileLock; requester: AgentRef; reason: string }
  /** Sent only to the agent that queued with `lock.wait`: the lock is now yours. */
  | { type: 'lock.granted'; lock: FileLock }
  /** Sent only to the agent that queued with `slot.acquire`: a place is now yours. */
  | { type: 'slot.granted'; slot: Slot }
  /** A slot's holders or queue changed. Not sent to the agent whose request caused it. */
  | { type: 'slot.updated'; slot: Slot }
  | { type: 'channel.updated'; channel: ChannelInfo }
  /** A claim was made, stalled, resumed, finished or dropped. Plain heartbeats are silent. */
  | { type: 'claim.updated'; claim: TaskClaim }
  /** The owner closed the channel; you are no longer in it. */
  | { type: 'channel.closed'; channel: string; by: AgentRef }
  | { type: 'question.asked'; question: UserQuestion }
  /** Answered, cancelled or unattended. */
  | { type: 'question.closed'; question: UserQuestion };

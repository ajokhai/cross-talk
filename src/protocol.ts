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
}

/** A reference to the sender embedded in messages; kept small on purpose. */
export interface AgentRef {
  id: string;
  name: string;
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

export type MessageKind = 'chat' | 'shorthand';

export interface ChannelMessage {
  id: string;
  /** Channel address. */
  channel: string;
  kind: MessageKind;
  from: AgentRef;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
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

export interface ChannelSnapshot {
  channel: ChannelInfo;
  members: AgentInfo[];
  locks: FileLock[];
  messages: ChannelMessage[];
  /** Open questions for the owner. */
  questions: UserQuestion[];
}

/** `channel.create` also returns the owner key, once. Keep it private: it answers questions. */
export interface CreatedChannel extends ChannelSnapshot {
  ownerKey: string;
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
}

/** Requests; each gets a `result` frame with the matching `id`. */
export type RequestFrame =
  | { type: 'channel.create'; id: string; name?: string; topic?: string; visibility?: ChannelVisibility }
  | { type: 'channel.join'; id: string; channel: string }
  | { type: 'channel.leave'; id: string; channel: string }
  | { type: 'channel.list'; id: string; scope?: 'joined' | 'public'; limit?: number; cursor?: string }
  | { type: 'channel.state'; id: string; channel: string }
  | { type: 'message.send'; id: string; channel: string; content: string; metadata?: Record<string, unknown> }
  | { type: 'shorthand.send'; id: string; channel: string; shorthand: string }
  | { type: 'dm.send'; id: string; to: string; content: string; replyExpected?: boolean; metadata?: Record<string, unknown> }
  | { type: 'lock.acquire'; id: string; channel: string; file: string; reason: string; ttlSeconds?: number }
  | { type: 'lock.release'; id: string; channel: string; file: string }
  | { type: 'status.update'; id: string; status?: AgentStatus; currentTask?: string }
  | { type: 'question.ask'; id: string; channel: string; question: string; options?: string[] }
  | { type: 'question.cancel'; id: string; channel: string; question: string }
  | { type: 'question.answer'; id: string; channel: string; question: string; answer: string; ownerKey: string }
  | { type: 'channel.configure'; id: string; channel: string; ownerKey: string; questions?: QuestionsMode };

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
  'lock.release': { channel: string; file: string };
  'status.update': AgentInfo;
  'question.ask': UserQuestion;
  'question.cancel': UserQuestion;
  'question.answer': UserQuestion;
  'channel.configure': ChannelInfo;
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
  | 'internal';

export interface HubError {
  code: ErrorCode;
  message: string;
  /** Extra context, e.g. the current lock for `lock_held`. */
  details?: unknown;
}

export type ServerFrame =
  | { type: 'welcome'; protocol: number; agent: AgentInfo; serverVersion: string }
  | { type: 'result'; id: string; ok: true; data: unknown }
  | { type: 'result'; id: string; ok: false; error: HubError }
  | { type: 'error'; error: HubError }
  | { type: 'member.joined'; channel: string; agent: AgentInfo }
  | { type: 'member.left'; channel: string; agent: AgentRef; reason: 'left' | 'disconnected' }
  | { type: 'member.updated'; channel: string; agent: AgentInfo }
  | { type: 'message'; message: ChannelMessage }
  | { type: 'dm'; message: DirectMessage }
  | { type: 'lock.acquired'; lock: FileLock }
  | { type: 'lock.released'; channel: string; file: string; by: AgentRef; reason: 'released' | 'expired' | 'disconnected' }
  | { type: 'lock.contended'; lock: FileLock; requester: AgentRef; reason: string }
  | { type: 'channel.updated'; channel: ChannelInfo }
  | { type: 'question.asked'; question: UserQuestion }
  /** Answered, cancelled or unattended. */
  | { type: 'question.closed'; question: UserQuestion };

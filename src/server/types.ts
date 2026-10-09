import { GibberlinkSignalPacket } from './gibberlink.js';
import { DialectDictionary } from '../dialect/dictionary.js';

export type AgentEnvironment = 'ide' | 'terminal' | 'bot' | 'web';
export type AgentStatus = 'idle' | 'working' | 'waiting' | 'offline';

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  environment: AgentEnvironment;
  workspace: string;
  status: AgentStatus;
  currentTask: string;
  lockedFiles: string[];
  connectedAt: number;
  lastSeen: number;
  gibberlinkCapable?: boolean;
  dialectVersion?: string;
  branch?: string;
  subnet?: string;
}

export interface FileLock {
  file: string;
  holderId: string;
  holderName: string;
  reason: string;
  acquiredAt: number;
  expiresAt: number;
  channel: string;
  workspace?: string;
  branch?: string;
}

export interface MessageEvent {
  id: string;
  type: 'broadcast' | 'direct_message' | 'system' | 'lock_event' | 'gibberlink_signal' | 'dialect_shorthand';
  channel: string;
  from?: AgentInfo;
  to?: string; // agentId or undefined if broadcast
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
  isAck?: boolean;
  replyExpected?: boolean;
  branch?: string;
  gibberlinkSignal?: GibberlinkSignalPacket; // Embedded FSK signal stream data
  shorthand?: {
    raw: string;
    human: string;
    bitSize?: number;
    action?: string;
    target?: string;
    intent?: string;
  };
}

// Client -> Server Protocol Packets
export type ClientPacket =
  | {
      type: 'register';
      agent: {
        id?: string;
        name: string;
        role?: string;
        environment?: AgentEnvironment;
        workspace?: string;
        currentTask?: string;
        gibberlinkCapable?: boolean;
        dialectVersion?: string;
        branch?: string;
      };
      channel?: string;
      sessionKey?: string;
    }
  | {
      type: 'heartbeat';
      status?: AgentStatus;
      currentTask?: string;
    }
  | {
      type: 'broadcast';
      content: string;
      metadata?: Record<string, any>;
    }
  | {
      type: 'shorthand_broadcast';
      shorthand: string;
      metadata?: Record<string, any>;
    }
  | {
      type: 'direct_message';
      to: string; // target agentId
      content: string;
      isAck?: boolean;
      replyExpected?: boolean;
      metadata?: Record<string, any>;
    }
  | {
      type: 'disconnect';
      reason?: string;
    }
  | {
      type: 'gibberlink_signal';
      signal: GibberlinkSignalPacket;
      to?: string;
    }
  | {
      type: 'lock_acquire';
      file: string;
      reason: string;
      ttlSeconds?: number;
    }
  | {
      type: 'lock_release';
      file: string;
    }
  | {
      type: 'query_state';
    }
  | {
      type: 'fetch_inbox';
      since?: number;
    }
  | {
      type: 'get_dialect';
      version?: string;
    };

// Server -> Client Protocol Packets
export type ServerPacket =
  | {
      type: 'registered';
      agentId: string;
      channel: string;
      dialect: DialectDictionary;
      mesh: {
        agents: AgentInfo[];
        locks: FileLock[];
        recentMessages: MessageEvent[];
      };
    }
  | {
      type: 'agent_joined';
      agent: AgentInfo;
    }
  | {
      type: 'agent_left';
      agentId: string;
      name: string;
      reason: string;
    }
  | {
      type: 'agent_updated';
      agent: AgentInfo;
    }
  | {
      type: 'broadcast';
      message: MessageEvent;
    }
  | {
      type: 'direct_message';
      message: MessageEvent;
    }
  | {
      type: 'direct_message_sent';
      messageId: string;
      to: string;
      timestamp: number;
    }
  | {
      type: 'gibberlink_signal';
      message: MessageEvent;
      signal: GibberlinkSignalPacket;
    }
  | {
      type: 'lock_acquired';
      lock: FileLock;
      byMe: boolean;
    }
  | {
      type: 'lock_denied';
      file: string;
      holder?: AgentInfo;
      reason: string;
      expiresAt?: number;
    }
  | {
      type: 'lock_released';
      file: string;
      releasedBy: string;
    }
  | {
      type: 'lock_conflict_warning';
      file: string;
      requester: AgentInfo;
      holder: AgentInfo;
      reason: string;
    }
  | {
      type: 'state_snapshot';
      agents: AgentInfo[];
      locks: FileLock[];
      recentMessages: MessageEvent[];
    }
  | {
      type: 'dialect_dictionary';
      dictionary: DialectDictionary;
    }
  | {
      type: 'inbox_batch';
      messages: MessageEvent[];
    }
  | {
      type: 'error';
      message: string;
      code?: string;
    };

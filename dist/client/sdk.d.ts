import EventEmitter from 'node:events';
import { AgentInfo, FileLock, MessageEvent, AgentEnvironment, AgentStatus } from '../server/types.js';
import { GibberlinkSignalPacket } from '../server/gibberlink.js';
import { BinaryFrame } from '../server/binary.js';
import { DialectDictionary } from '../dialect/dictionary.js';
import { ParsedDialectMessage } from '../dialect/engine.js';
export interface CrossTalkClientOptions {
    url?: string;
    channel?: string;
    name: string;
    role?: string;
    environment?: AgentEnvironment;
    workspace?: string;
    currentTask?: string;
    autoHeartbeat?: boolean;
    gibberlinkCapable?: boolean;
    dialectVersion?: string;
}
export declare class CrossTalkClient extends EventEmitter {
    private ws;
    private options;
    private heartbeatInterval;
    private isConnected;
    private myAgentId;
    private currentDialect;
    private pendingLockResolvers;
    private pendingStateResolver;
    private pendingInboxResolver;
    constructor(options: CrossTalkClientOptions);
    get agentId(): string;
    get dialect(): DialectDictionary;
    connect(): Promise<{
        agentId: string;
        channel: string;
        agents: AgentInfo[];
        locks: FileLock[];
        dialect: DialectDictionary;
    }>;
    private handlePacket;
    broadcast(content: string, metadata?: Record<string, any>): void;
    /**
     * Broadcasts a message using the XDialect concise shorthand format.
     * Auto-translates to human language and packs into bitstream for wire efficiency.
     * Example: `!LCK @src/auth.ts #REF "jwt validation" &WAIT`
     */
    sendShorthand(shorthand: string, metadata?: Record<string, any>): void;
    parseShorthand(shorthand: string): ParsedDialectMessage;
    shorthandToHuman(shorthand: string): string;
    humanToShorthand(english: string): string;
    sendDirectMessage(toAgentId: string, content: string, metadata?: Record<string, any>): void;
    sendGibberlinkSignal(payload: string | object, mode?: 'audible_fast' | 'audible_standard' | 'ultrasonic', to?: string): GibberlinkSignalPacket;
    sendBinary(frame: BinaryFrame): void;
    lockFile(file: string, reason: string, ttlSeconds?: number): Promise<{
        success: boolean;
        lock?: FileLock;
        holder?: AgentInfo;
        reason?: string;
        expiresAt?: number;
    }>;
    unlockFile(file: string): void;
    heartbeat(status?: AgentStatus, currentTask?: string): void;
    updateTask(taskDescription: string, status?: AgentStatus): void;
    getMeshState(): Promise<{
        agents: AgentInfo[];
        locks: FileLock[];
        recentMessages: MessageEvent[];
    }>;
    fetchInbox(since?: number): Promise<MessageEvent[]>;
    disconnect(): void;
    private sendPacket;
}
export declare class CrossTalk {
    /**
     * Connect to, join, or auto-create a socket mesh in a single line.
     * If autoHost is true (default) and no server is active locally, it boots a local hub on the spot!
     */
    static join(options?: {
        channel?: string;
        url?: string;
        name?: string;
        role?: string;
        autoHost?: boolean;
        port?: number;
        currentTask?: string;
    }): Promise<CrossTalkClient>;
}

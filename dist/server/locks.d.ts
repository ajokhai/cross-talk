import { FileLock, AgentInfo } from './types.js';
export interface LockAcquireResult {
    success: boolean;
    lock?: FileLock;
    quotaExceeded?: boolean;
    error?: string;
    existingHolder?: {
        id: string;
        name: string;
        reason: string;
        expiresAt: number;
        remainingSeconds: number;
    };
    conflictWarningSent?: boolean;
}
export declare class LockManager {
    static readonly MAX_TTL_SECONDS = 1800;
    static readonly MIN_TTL_SECONDS = 5;
    static readonly MAX_LOCKS_PER_AGENT = 10;
    private locks;
    private cleanupInterval;
    constructor();
    normalizePath(filePath: string): string;
    getLockKey(channel: string, workspace: string, file: string): string;
    acquire(rawPath: string, agent: AgentInfo, reason: string, ttlSeconds?: number, channel?: string): LockAcquireResult;
    release(rawPath: string, agentId: string, force?: boolean, channel?: string, workspace?: string): {
        success: boolean;
        lock?: FileLock;
    };
    releaseAllByAgent(agentId: string): FileLock[];
    isLocked(rawPath: string, channel?: string, workspace?: string): {
        locked: boolean;
        lock?: FileLock;
    };
    getLocks(channel?: string, workspace?: string): FileLock[];
    getLocksByAgent(agentId: string, channel?: string, workspace?: string): FileLock[];
    private cleanExpiredLocks;
    destroy(): void;
}

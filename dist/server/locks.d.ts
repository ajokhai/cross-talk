import { FileLock, AgentInfo } from './types.js';
export interface LockAcquireResult {
    success: boolean;
    lock?: FileLock;
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
    private locks;
    private cleanupInterval;
    constructor();
    normalizePath(filePath: string): string;
    acquire(rawPath: string, agent: AgentInfo, reason: string, ttlSeconds?: number, channel?: string): LockAcquireResult;
    release(rawPath: string, agentId: string, force?: boolean): {
        success: boolean;
        lock?: FileLock;
    };
    releaseAllByAgent(agentId: string): FileLock[];
    isLocked(rawPath: string): {
        locked: boolean;
        lock?: FileLock;
    };
    getLocks(channel?: string): FileLock[];
    getLocksByAgent(agentId: string): FileLock[];
    private cleanExpiredLocks;
    destroy(): void;
}

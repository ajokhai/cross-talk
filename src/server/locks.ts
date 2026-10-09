import path from 'node:path';
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

export class LockManager {
  public static readonly MAX_TTL_SECONDS = 1800; // 30 minutes maximum to prevent starvation DoS
  public static readonly MIN_TTL_SECONDS = 5;    // 5 seconds minimum
  public static readonly MAX_LOCKS_PER_AGENT = 10; // Max 10 active concurrent locks per agent

  // Key: channel::workspace::normalizedFilePath -> FileLock
  private locks: Map<string, FileLock> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Periodically expire stale locks every 5 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanExpiredLocks();
    }, 5000);
  }

  public normalizePath(filePath: string): string {
    if (!filePath) return '';
    // Normalize slashes and clean up relative dots
    let normalized = path.normalize(filePath).replace(/\\/g, '/');
    // Remove leading ./ if present
    if (normalized.startsWith('./')) {
      normalized = normalized.slice(2);
    }
    return normalized;
  }

  public getLockKey(channel: string, workspace: string, file: string): string {
    const ch = (channel || 'default').trim().toLowerCase();
    const ws = (workspace || 'default').trim();
    const f = this.normalizePath(file);
    return `${ch}::${ws}::${f}`;
  }

  public acquire(
    rawPath: string,
    agent: AgentInfo,
    reason: string,
    ttlSeconds: number = 300,
    channel: string = 'default'
  ): LockAcquireResult {
    const file = this.normalizePath(rawPath);
    const workspace = agent.workspace || 'default';
    const lockKey = this.getLockKey(channel, workspace, file);
    const now = Date.now();

    // Clamp TTL to safe boundaries (5s to 30 mins) to prevent indefinite file starvation
    const clampedTtl = Math.max(
      LockManager.MIN_TTL_SECONDS,
      Math.min(ttlSeconds || 300, LockManager.MAX_TTL_SECONDS)
    );

    const existing = this.locks.get(lockKey);

    // If existing lock is valid and held
    if (existing && existing.expiresAt > now) {
      if (existing.holderId === agent.id) {
        // Renewal by the same agent (does not consume additional quota)
        existing.expiresAt = now + clampedTtl * 1000;
        existing.reason = reason;
        return { success: true, lock: existing };
      }

      const remainingSeconds = Math.max(0, Math.round((existing.expiresAt - now) / 1000));
      return {
        success: false,
        existingHolder: {
          id: existing.holderId,
          name: existing.holderName,
          reason: existing.reason,
          expiresAt: existing.expiresAt,
          remainingSeconds
        }
      };
    }

    // Per-Agent Quota Enforcement: Prevent one agent from hoarding all locks
    const currentAgentLocks = this.getLocksByAgent(agent.id);
    if (currentAgentLocks.length >= LockManager.MAX_LOCKS_PER_AGENT) {
      return {
        success: false,
        quotaExceeded: true,
        error: `Lock quota exceeded: Agent '${agent.name}' already holds ${currentAgentLocks.length} active locks (max ${LockManager.MAX_LOCKS_PER_AGENT}). Release a lock before claiming another.`
      };
    }

    // Lock granted in specific channel and workspace
    const lock: FileLock = {
      file,
      holderId: agent.id,
      holderName: agent.name,
      reason,
      acquiredAt: now,
      expiresAt: now + clampedTtl * 1000,
      channel,
      workspace
    };

    this.locks.set(lockKey, lock);
    return { success: true, lock };
  }

  public release(
    rawPath: string,
    agentId: string,
    force: boolean = false,
    channel?: string,
    workspace?: string
  ): { success: boolean; lock?: FileLock } {
    const file = this.normalizePath(rawPath);

    // Fast path: direct key lookup if channel and workspace are known
    if (channel && workspace) {
      const key = this.getLockKey(channel, workspace, file);
      const existing = this.locks.get(key);
      if (existing) {
        if (!force && existing.holderId !== agentId) {
          return { success: false, lock: existing };
        }
        this.locks.delete(key);
        return { success: true, lock: existing };
      }
    }

    // Flexible fallback: match across map
    for (const [key, lock] of this.locks.entries()) {
      if (lock.file === file) {
        if (channel && lock.channel !== channel) continue;
        if (workspace && lock.workspace !== workspace) continue;

        if (!force && lock.holderId !== agentId) {
          return { success: false, lock };
        }

        this.locks.delete(key);
        return { success: true, lock };
      }
    }

    return { success: false };
  }

  public releaseAllByAgent(agentId: string): FileLock[] {
    const released: FileLock[] = [];
    for (const [key, lock] of this.locks.entries()) {
      if (lock.holderId === agentId) {
        released.push(lock);
        this.locks.delete(key);
      }
    }
    return released;
  }

  public isLocked(
    rawPath: string,
    channel?: string,
    workspace?: string
  ): { locked: boolean; lock?: FileLock } {
    const file = this.normalizePath(rawPath);
    const now = Date.now();

    for (const [key, lock] of this.locks.entries()) {
      if (lock.file === file) {
        if (channel && lock.channel !== channel) continue;
        if (workspace && lock.workspace !== workspace) continue;

        if (lock.expiresAt <= now) {
          this.locks.delete(key);
          continue;
        }

        return { locked: true, lock };
      }
    }

    return { locked: false };
  }

  public getLocks(channel?: string, workspace?: string): FileLock[] {
    const now = Date.now();
    const active: FileLock[] = [];
    for (const [key, lock] of this.locks.entries()) {
      if (lock.expiresAt > now) {
        if (channel && lock.channel !== channel) continue;
        if (workspace && lock.workspace !== workspace) continue;
        active.push(lock);
      } else {
        this.locks.delete(key);
      }
    }
    return active;
  }

  public getLocksByAgent(agentId: string, channel?: string, workspace?: string): FileLock[] {
    return this.getLocks(channel, workspace).filter(l => l.holderId === agentId);
  }

  private cleanExpiredLocks() {
    const now = Date.now();
    for (const [key, lock] of this.locks.entries()) {
      if (lock.expiresAt <= now) {
        this.locks.delete(key);
      }
    }
  }

  public destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

import path from 'node:path';
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

export class LockManager {
  private locks: Map<string, FileLock> = new Map(); // normalizedFilePath -> FileLock
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

  public acquire(
    rawPath: string,
    agent: AgentInfo,
    reason: string,
    ttlSeconds: number = 300,
    channel: string = 'default'
  ): LockAcquireResult {
    const file = this.normalizePath(rawPath);
    const now = Date.now();
    const existing = this.locks.get(file);

    // If existing lock is valid and held by someone else
    if (existing && existing.expiresAt > now) {
      if (existing.holderId === agent.id) {
        // Renewal by the same agent
        existing.expiresAt = now + ttlSeconds * 1000;
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

    // Lock granted
    const lock: FileLock = {
      file,
      holderId: agent.id,
      holderName: agent.name,
      reason,
      acquiredAt: now,
      expiresAt: now + ttlSeconds * 1000,
      channel
    };

    this.locks.set(file, lock);
    return { success: true, lock };
  }

  public release(rawPath: string, agentId: string, force: boolean = false): { success: boolean; lock?: FileLock } {
    const file = this.normalizePath(rawPath);
    const existing = this.locks.get(file);

    if (!existing) {
      return { success: false };
    }

    if (!force && existing.holderId !== agentId) {
      return { success: false, lock: existing };
    }

    this.locks.delete(file);
    return { success: true, lock: existing };
  }

  public releaseAllByAgent(agentId: string): FileLock[] {
    const released: FileLock[] = [];
    for (const [file, lock] of this.locks.entries()) {
      if (lock.holderId === agentId) {
        released.push(lock);
        this.locks.delete(file);
      }
    }
    return released;
  }

  public isLocked(rawPath: string): { locked: boolean; lock?: FileLock } {
    const file = this.normalizePath(rawPath);
    const existing = this.locks.get(file);
    if (!existing) return { locked: false };

    if (existing.expiresAt <= Date.now()) {
      this.locks.delete(file);
      return { locked: false };
    }

    return { locked: true, lock: existing };
  }

  public getLocks(channel?: string): FileLock[] {
    const now = Date.now();
    const active: FileLock[] = [];
    for (const [file, lock] of this.locks.entries()) {
      if (lock.expiresAt > now) {
        if (!channel || lock.channel === channel) {
          active.push(lock);
        }
      } else {
        this.locks.delete(file);
      }
    }
    return active;
  }

  public getLocksByAgent(agentId: string): FileLock[] {
    return this.getLocks().filter(l => l.holderId === agentId);
  }

  private cleanExpiredLocks() {
    const now = Date.now();
    for (const [file, lock] of this.locks.entries()) {
      if (lock.expiresAt <= now) {
        this.locks.delete(file);
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

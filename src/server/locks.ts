import path from 'node:path';
import type { AgentRef, FileLock } from '../protocol.js';

export type AcquireResult =
  | { ok: true; lock: FileLock; renewed: boolean }
  | { ok: false; reason: 'held'; lock: FileLock }
  | { ok: false; reason: 'quota'; limit: number };

export interface LockManagerOptions {
  minTtlSeconds?: number;
  maxTtlSeconds?: number;
  defaultTtlSeconds?: number;
  maxLocksPerAgent?: number;
  now?: () => number;
}

/**
 * Cooperative, advisory file locks scoped to a channel.
 *
 * Locks are keyed by `channel + normalized relative path`, so two agents on
 * different machines collaborating in the same channel contend for the same
 * key as long as they use repo-relative paths (the SDK does this for them).
 *
 * The manager owns no timers; the hub calls `sweepExpired()` periodically so
 * it can announce expirations to channel members.
 */
export class LockManager {
  readonly minTtlSeconds: number;
  readonly maxTtlSeconds: number;
  readonly defaultTtlSeconds: number;
  readonly maxLocksPerAgent: number;
  private readonly now: () => number;
  private readonly locks = new Map<string, FileLock>();

  constructor(options: LockManagerOptions = {}) {
    this.minTtlSeconds = options.minTtlSeconds ?? 5;
    this.maxTtlSeconds = options.maxTtlSeconds ?? 30 * 60;
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? 5 * 60;
    this.maxLocksPerAgent = options.maxLocksPerAgent ?? 25;
    this.now = options.now ?? Date.now;
  }

  /** Normalizes to a forward-slash relative-looking path. Returns '' for invalid input. */
  static normalizePath(file: string): string {
    if (typeof file !== 'string') return '';
    const cleaned = file.trim().replace(/\\/g, '/');
    if (!cleaned) return '';
    let normalized = path.posix.normalize(cleaned);
    if (normalized.startsWith('./')) normalized = normalized.slice(2);
    if (normalized === '.' || normalized === '/') return '';
    return normalized;
  }

  private key(channel: string, file: string): string {
    return `${channel}\u0000${file}`;
  }

  private live(key: string): FileLock | undefined {
    const lock = this.locks.get(key);
    if (lock && lock.expiresAt <= this.now()) {
      this.locks.delete(key);
      return undefined;
    }
    return lock;
  }

  clampTtl(ttlSeconds?: number): number {
    const ttl = Number.isFinite(ttlSeconds) && ttlSeconds! > 0 ? ttlSeconds! : this.defaultTtlSeconds;
    return Math.max(this.minTtlSeconds, Math.min(Math.floor(ttl), this.maxTtlSeconds));
  }

  acquire(channel: string, file: string, holder: AgentRef, reason: string, ttlSeconds?: number): AcquireResult {
    const key = this.key(channel, file);
    const now = this.now();
    const expiresAt = now + this.clampTtl(ttlSeconds) * 1000;
    const existing = this.live(key);

    if (existing) {
      if (existing.holder.id !== holder.id) return { ok: false, reason: 'held', lock: existing };
      existing.expiresAt = expiresAt;
      existing.reason = reason;
      return { ok: true, lock: existing, renewed: true };
    }

    if (this.byHolder(holder.id).length >= this.maxLocksPerAgent) {
      return { ok: false, reason: 'quota', limit: this.maxLocksPerAgent };
    }

    const lock: FileLock = { channel, file, holder: { ...holder }, reason, acquiredAt: now, expiresAt };
    this.locks.set(key, lock);
    return { ok: true, lock, renewed: false };
  }

  /** Releases a lock held by `holderId`. Returns the released lock, or the blocking lock if held by someone else. */
  release(channel: string, file: string, holderId: string): { released?: FileLock; heldBy?: FileLock } {
    const key = this.key(channel, file);
    const existing = this.live(key);
    if (!existing) return {};
    if (existing.holder.id !== holderId) return { heldBy: existing };
    this.locks.delete(key);
    return { released: existing };
  }

  get(channel: string, file: string): FileLock | undefined {
    return this.live(this.key(channel, file));
  }

  list(channel?: string): FileLock[] {
    const out: FileLock[] = [];
    for (const key of [...this.locks.keys()]) {
      const lock = this.live(key);
      if (lock && (!channel || lock.channel === channel)) out.push(lock);
    }
    return out;
  }

  byHolder(holderId: string, channel?: string): FileLock[] {
    return this.list(channel).filter(l => l.holder.id === holderId);
  }

  /** Drops every lock held by `holderId` (optionally only within one channel). */
  releaseAllBy(holderId: string, channel?: string): FileLock[] {
    const released: FileLock[] = [];
    for (const [key, lock] of this.locks) {
      if (lock.holder.id === holderId && (!channel || lock.channel === channel)) {
        this.locks.delete(key);
        released.push(lock);
      }
    }
    return released;
  }

  releaseChannel(channel: string): void {
    for (const [key, lock] of this.locks) {
      if (lock.channel === channel) this.locks.delete(key);
    }
  }

  sweepExpired(): FileLock[] {
    const now = this.now();
    const expired: FileLock[] = [];
    for (const [key, lock] of this.locks) {
      if (lock.expiresAt <= now) {
        this.locks.delete(key);
        expired.push(lock);
      }
    }
    return expired;
  }
}

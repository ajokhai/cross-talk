import path from 'node:path';
export class LockManager {
    locks = new Map(); // normalizedFilePath -> FileLock
    cleanupInterval = null;
    constructor() {
        // Periodically expire stale locks every 5 seconds
        this.cleanupInterval = setInterval(() => {
            this.cleanExpiredLocks();
        }, 5000);
    }
    normalizePath(filePath) {
        if (!filePath)
            return '';
        // Normalize slashes and clean up relative dots
        let normalized = path.normalize(filePath).replace(/\\/g, '/');
        // Remove leading ./ if present
        if (normalized.startsWith('./')) {
            normalized = normalized.slice(2);
        }
        return normalized;
    }
    acquire(rawPath, agent, reason, ttlSeconds = 300, channel = 'default') {
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
        const lock = {
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
    release(rawPath, agentId, force = false) {
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
    releaseAllByAgent(agentId) {
        const released = [];
        for (const [file, lock] of this.locks.entries()) {
            if (lock.holderId === agentId) {
                released.push(lock);
                this.locks.delete(file);
            }
        }
        return released;
    }
    isLocked(rawPath) {
        const file = this.normalizePath(rawPath);
        const existing = this.locks.get(file);
        if (!existing)
            return { locked: false };
        if (existing.expiresAt <= Date.now()) {
            this.locks.delete(file);
            return { locked: false };
        }
        return { locked: true, lock: existing };
    }
    getLocks(channel) {
        const now = Date.now();
        const active = [];
        for (const [file, lock] of this.locks.entries()) {
            if (lock.expiresAt > now) {
                if (!channel || lock.channel === channel) {
                    active.push(lock);
                }
            }
            else {
                this.locks.delete(file);
            }
        }
        return active;
    }
    getLocksByAgent(agentId) {
        return this.getLocks().filter(l => l.holderId === agentId);
    }
    cleanExpiredLocks() {
        const now = Date.now();
        for (const [file, lock] of this.locks.entries()) {
            if (lock.expiresAt <= now) {
                this.locks.delete(file);
            }
        }
    }
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

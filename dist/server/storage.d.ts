import { MessageEvent } from './types.js';
export interface IMeshStorage {
    recordMessage(channel: string, msg: MessageEvent): Promise<void>;
    getTotalMessageCount(): Promise<number>;
    getRecentMessages(channel: string, limit?: number): Promise<MessageEvent[]>;
    close(): Promise<void>;
}
/**
 * Ultra-Lightweight In-Memory Ring Buffer Storage
 * Used by default across local CLI, micro devices, and offline nodes.
 * Zero external dependencies. Zero garbage collection pressure.
 */
export declare class InMemoryStorage implements IMeshStorage {
    private history;
    private totalMessages;
    private maxCapacity;
    constructor(maxCapacity?: number);
    recordMessage(channel: string, msg: MessageEvent): Promise<void>;
    getTotalMessageCount(): Promise<number>;
    getRecentMessages(channel: string, limit?: number): Promise<MessageEvent[]>;
    close(): Promise<void>;
}
/**
 * MongoDB Capped Ring Buffer Storage
 * Automatically connects when MONGODB_URI is provided (e.g. on hosted websites or Vercel).
 * Falls back to InMemoryStorage if mongodb package or connection is not present.
 */
export declare class MongoStorage implements IMeshStorage {
    private inMemoryFallback;
    private client;
    private db;
    private isConnected;
    private uri;
    private dbName;
    constructor(uri: string, dbName?: string);
    connect(): Promise<boolean>;
    recordMessage(channel: string, msg: MessageEvent): Promise<void>;
    getTotalMessageCount(): Promise<number>;
    getRecentMessages(channel: string, limit?: number): Promise<MessageEvent[]>;
    close(): Promise<void>;
}
/**
 * Storage factory:
 * If MONGODB_URI is provided, initializes MongoStorage.
 * Otherwise returns zero-dependency InMemoryStorage.
 */
export declare function createMeshStorage(): Promise<IMeshStorage>;

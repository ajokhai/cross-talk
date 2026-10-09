import { WebSocket } from 'ws';
import { AgentInfo, MessageEvent, ServerPacket } from './types.js';
import { LockManager } from './locks.js';
import { IMeshStorage } from './storage.js';
import http from 'node:http';
export declare class MeshHub {
    private clients;
    private lockManager;
    private storage;
    private messageHistory;
    private inboxes;
    private maxHistoryPerChannel;
    private maxInboxPerAgent;
    private totalMessagesRouted;
    private startTime;
    private allowedSubnets;
    constructor(storage?: IMeshStorage, allowedSubnets?: string[]);
    setAllowedSubnets(subnets: string[]): void;
    getAllowedSubnets(): string[];
    initStorage(channel?: string): Promise<void>;
    getStorage(): IMeshStorage;
    getLockManager(): LockManager;
    handleConnection(ws: WebSocket, req?: http.IncomingMessage): void;
    private processPacket;
    private handleDisconnect;
    broadcastToChannel(channel: string, packet: ServerPacket, excludeIds?: string[]): void;
    private send;
    private getClientByWs;
    getAgentsInChannel(channel: string): AgentInfo[];
    getAllAgents(): AgentInfo[];
    getRecentMessages(channel: string): MessageEvent[];
    getAllRecentMessages(limit?: number): MessageEvent[];
    getSessions(): Array<{
        channel: string;
        agentCount: number;
        lockCount: number;
        messageCount: number;
        lastActivity: number;
    }>;
    private appendMessageHistory;
    getStats(channel?: string): {
        totalMessagesRouted: number;
        activePeers: number;
        activeLocks: number;
        uptimeSeconds: number;
        recentHistoryCount: number;
        maxBufferCapacity: number;
        channel: string;
        meshVersion: string;
        storageMode: string;
        timestamp: number;
    };
    private addToInbox;
    recordAndBroadcastSystemMessage(channel: string, content: string): void;
    injectBroadcast(channel: string, fromName: string, content: string, role?: string): MessageEvent;
    createInvite(options?: {
        channel?: string;
        branch?: string;
        allowedSubnet?: string;
        host?: string;
    }): {
        code: string;
        channel: string;
        branch: string;
        subnetLock: string;
        options: {
            centralRelay: {
                name: string;
                code: string;
                joinLink: string;
                wsUrl: string;
                agentPrompt: string;
                cliCommand: string;
            };
            openMesh: {
                name: string;
                topic: string;
                agentPrompt: string;
                cliCommand: string;
            };
            directP2P: {
                name: string;
                address: string;
                subnetLock: string;
                agentPrompt: string;
                cliCommand: string;
            };
        };
    };
}

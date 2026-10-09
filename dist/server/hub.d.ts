import { WebSocket } from 'ws';
import { AgentInfo, MessageEvent, ServerPacket } from './types.js';
import { LockManager } from './locks.js';
export declare class MeshHub {
    private clients;
    private lockManager;
    private messageHistory;
    private inboxes;
    private maxHistoryPerChannel;
    private maxInboxPerAgent;
    private totalMessagesRouted;
    private startTime;
    constructor();
    getLockManager(): LockManager;
    handleConnection(ws: WebSocket): void;
    private processPacket;
    private handleDisconnect;
    broadcastToChannel(channel: string, packet: ServerPacket, excludeIds?: string[]): void;
    private send;
    private getClientByWs;
    getAgentsInChannel(channel: string): AgentInfo[];
    getAllAgents(): AgentInfo[];
    getRecentMessages(channel: string): MessageEvent[];
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
        timestamp: number;
    };
    private addToInbox;
    recordAndBroadcastSystemMessage(channel: string, content: string): void;
    injectBroadcast(channel: string, fromName: string, content: string, role?: string): MessageEvent;
}

import http from 'node:http';
import { MeshHub } from './hub.js';
import { IMeshStorage } from './storage.js';
export declare function startServer(port?: number, host?: string, customStorage?: IMeshStorage, allowedSubnets?: string[]): Promise<{
    server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>;
    wss: import("ws").Server<typeof import("ws").default, typeof http.IncomingMessage>;
    hub: MeshHub;
}>;

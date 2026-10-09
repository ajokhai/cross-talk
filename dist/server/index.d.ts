import http from 'node:http';
import { MeshHub } from './hub.js';
export declare function startServer(port?: number, host?: string): {
    server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>;
    wss: import("ws").Server<typeof import("ws").default, typeof http.IncomingMessage>;
    hub: MeshHub;
};

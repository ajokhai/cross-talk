import crypto from 'node:crypto';
import type http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { Bridge, createMcpServer } from '../mcp/server.js';
import { CLIENT_HEADER, INTERNAL_HEADER } from './internal.js';

/**
 * Remote MCP: the hub serves `/mcp` over Streamable HTTP, so clients that can't
 * spawn `crosstalk-mcp` (claude.ai connectors, cloud sessions) get the same
 * tools. Each MCP session is one CrossTalk agent, connected back to this hub
 * over loopback and tagged with the real client's address.
 */

const MAX_BODY_BYTES = 1024 * 1024;
/** An MCP session with no requests for this long is closed and its agent leaves. */
const IDLE_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 500;
const MAX_SESSIONS_PER_ADDRESS = 16;

interface McpSession {
  transport: StreamableHTTPServerTransport;
  bridge: Bridge;
  address: string;
  lastSeen: number;
}

export interface McpEndpoint {
  handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, address: string): Promise<void>;
  close(): Promise<void>;
}

const cleanName = (value: string | null): string =>
  (value ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 64);

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : undefined);
      } catch {
        reject(new Error('Body must be JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createMcpEndpoint(opts: { hubUrl: string; token?: string; secret: string }): McpEndpoint {
  const sessions = new Map<string, McpSession>();

  const end = async (id: string) => {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    await session.bridge.close().catch(() => {});
    await session.transport.close().catch(() => {});
  };

  const reaper = setInterval(() => {
    const cutoff = Date.now() - IDLE_MS;
    for (const [id, s] of sessions) if (s.lastSeen < cutoff) void end(id);
  }, 60_000);
  reaper.unref();

  const error = (res: http.ServerResponse, status: number, message: string) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
  };

  return {
    async handle(req, res, url, address) {
      req.socket.setTimeout(0);
      const id = req.headers['mcp-session-id'];
      const existing = typeof id === 'string' ? sessions.get(id) : undefined;
      if (existing) {
        existing.lastSeen = Date.now();
        const body = req.method === 'POST' ? await readBody(req) : undefined;
        await existing.transport.handleRequest(req, res, body);
        return;
      }
      if (typeof id === 'string') return error(res, 404, 'Unknown or expired MCP session; reconnect');
      if (req.method !== 'POST') return error(res, 400, 'Start a session with an initialize request');

      const body = await readBody(req);
      if (!isInitializeRequest(body)) return error(res, 400, 'Start a session with an initialize request');
      if (sessions.size >= MAX_SESSIONS) return error(res, 429, 'Hub is at capacity');
      if ([...sessions.values()].filter(s => s.address === address).length >= MAX_SESSIONS_PER_ADDRESS) {
        return error(res, 429, 'Too many MCP sessions from your address');
      }

      // ?name=claude&channel=xt_... (the agent name and channels to join on connect).
      const bridge = new Bridge({
        name: cleanName(url.searchParams.get('name')) || 'claude',
        role: cleanName(url.searchParams.get('role')) || 'agent',
        url: opts.hubUrl,
        token: opts.token,
        headers: { [INTERNAL_HEADER]: opts.secret, [CLIENT_HEADER]: address },
        channels: (url.searchParams.get('channel') ?? '').split(','),
        remote: true
      });
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: sid => {
          sessions.set(sid, { transport, bridge, address, lastSeen: Date.now() });
        }
      });
      transport.onclose = () => {
        if (transport.sessionId) void end(transport.sessionId);
      };
      await createMcpServer(bridge).connect(transport);
      await transport.handleRequest(req, res, body);
      // Join the hub now, so the agent is present before its first tool call.
      bridge.get().catch(() => {});
    },

    async close() {
      clearInterval(reaper);
      await Promise.all([...sessions.keys()].map(end));
    }
  };
}

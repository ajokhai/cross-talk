import crypto from 'node:crypto';
import type http from 'node:http';
import { Bridge, McpServer, type JsonRpcMessage } from '../mcp/server.js';
import { CLIENT_HEADER, INTERNAL_HEADER } from './internal.js';

/**
 * Remote MCP: the hub serves `/mcp` over Streamable HTTP, so clients that can't
 * spawn `crosstalk-mcp` (claude.ai connectors, cloud sessions) get the same
 * tools. Each MCP session is one CrossTalk agent, connected back to this hub
 * over loopback and tagged with the real client's address.
 *
 * Every POST is answered with plain JSON (the spec lets the server pick JSON
 * over an event stream). There are no server-initiated messages, so GET
 * (the optional standalone stream) is refused with 405.
 */

const MAX_BODY_BYTES = 1024 * 1024;
/** An MCP session with no requests for this long is closed and its agent leaves. */
const IDLE_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 500;
const MAX_SESSIONS_PER_ADDRESS = 16;

interface McpSession {
  server: McpServer;
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
      let session = typeof id === 'string' ? sessions.get(id) : undefined;
      if (typeof id === 'string' && !session) return error(res, 404, 'Unknown or expired MCP session; reconnect');
      if (req.method === 'DELETE') {
        if (!session) return error(res, 400, 'No MCP session to end');
        await end(id as string);
        res.writeHead(200).end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST, DELETE' }).end();
        return;
      }

      const body = await readBody(req);
      const messages = Array.isArray(body) ? body : [body];
      if (!session) {
        const init = messages.length === 1 && (messages[0] as JsonRpcMessage | undefined)?.method === 'initialize';
        if (!init) return error(res, 400, 'Start a session with an initialize request');
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
        const sid = crypto.randomUUID();
        session = { server: new McpServer(bridge), bridge, address, lastSeen: Date.now() };
        sessions.set(sid, session);
        res.setHeader('Mcp-Session-Id', sid);
        // Join the hub now, so the agent is present before its first tool call.
        bridge.get().catch(() => {});
      }
      session.lastSeen = Date.now();

      // The client hung up mid-call (e.g. cancelled a crosstalk_wait): stop waiting.
      const gone = new AbortController();
      res.on('close', () => res.writableFinished || gone.abort());
      const live = session;
      const replies = (await Promise.all(messages.map(m => live.server.handle(m, gone.signal)))).filter(r => r !== undefined);
      if (res.destroyed) return;
      if (!replies.length) {
        res.writeHead(202).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Array.isArray(body) ? replies : replies[0]));
    },

    async close() {
      clearInterval(reaper);
      await Promise.all([...sessions.keys()].map(end));
    }
  };
}

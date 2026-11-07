import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { sameHub } from './keys.js';

/**
 * One member per agent. An MCP agent can't be woken between turns, so it also
 * runs `crosstalk wait --name <itself>` in the background. That listener used
 * to join as a second member with the same name. Now the MCP server opens a
 * small wait endpoint on 127.0.0.1 and records it here; a `crosstalk wait`
 * for the same name and hub on the same machine attaches to it instead of
 * registering, so the agent stays one member that shows as listening.
 *
 * The record (port and a random token) is in ~/.crosstalk/listen, mode 0600.
 * The endpoint only answers on loopback and only with the token.
 */

export interface AttachRecord {
  url: string;
  name: string;
  port: number;
  token: string;
  pid: number;
  at: number;
}

export function listenDir(): string {
  return process.env.CROSSTALK_LISTEN_DIR || path.join(os.homedir(), '.crosstalk', 'listen');
}

const recordFile = (url: string, name: string) =>
  path.join(listenDir(), `${crypto.createHash('sha256').update(`${url}\n${name.toLowerCase()}`).digest('hex').slice(0, 16)}.json`);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The live MCP server for `name` on the hub at `url` on this machine, if there is one. */
export function findAttach(url: string, name: string): AttachRecord | undefined {
  let files: string[];
  try {
    files = fs.readdirSync(listenDir());
  } catch {
    return undefined;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(listenDir(), file), 'utf8')) as AttachRecord;
      if (r.name.toLowerCase() === name.toLowerCase() && sameHub(r.url, url) && alive(r.pid)) return r;
    } catch {
      // Half-written or foreign file: skip it.
    }
  }
  return undefined;
}

export interface AttachServerOptions {
  url: string;
  name: string;
  /** Resolves with the text to wake the listener with, or undefined when `signal` aborts first. */
  next(options: { mentionsOnly: boolean; signal: AbortSignal }): Promise<string | undefined>;
  /** Called with true when the first listener attaches and false when the last one leaves. */
  onListening?(open: boolean): void;
}

/** MCP side: serves the wait endpoint and records it. close() removes the record. */
export async function serveAttach(options: AttachServerOptions): Promise<{ record: AttachRecord; close(): void }> {
  const token = crypto.randomBytes(24).toString('base64url');
  let open = 0;
  const server = http.createServer(async (req, res) => {
    const given = String(req.headers['x-crosstalk-attach'] ?? '');
    const ok = given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!ok || req.method !== 'GET' || url.pathname !== '/wait') {
      res.writeHead(ok ? 404 : 403).end();
      return;
    }
    const seconds = Math.max(1, Math.min(Number(url.searchParams.get('timeout')) || 50, 55));
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), seconds * 1000);
    req.socket.on('close', () => abort.abort());
    if (open++ === 0) options.onListening?.(true);
    try {
      const text = await options.next({ mentionsOnly: url.searchParams.get('mentions') !== '0', signal: abort.signal });
      if (!res.writableEnded) {
        if (text === undefined) res.writeHead(204).end();
        else res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text);
      }
    } finally {
      clearTimeout(timer);
      if (--open === 0) options.onListening?.(false);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const record: AttachRecord = {
    url: options.url,
    name: options.name,
    port: (server.address() as { port: number }).port,
    token,
    pid: process.pid,
    at: Date.now()
  };
  const file = recordFile(options.url, options.name);
  fs.mkdirSync(listenDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(record) + '\n', { mode: 0o600 });
  server.unref();
  return {
    record,
    close: () => {
      server.close();
      server.closeAllConnections?.();
      try {
        // Only our own record: a newer server for the same name may have replaced it.
        if ((JSON.parse(fs.readFileSync(file, 'utf8')) as AttachRecord).token === token) fs.rmSync(file, { force: true });
      } catch {
        // Already gone.
      }
    }
  };
}

/**
 * CLI side: waits through the agent's own MCP server. Resolves with the text
 * to print, 'timeout' when `timeoutMs` passes (0 waits forever), or 'gone'
 * when the MCP server stopped answering (the caller then waits the usual way).
 */
export async function attachedWait(record: AttachRecord, options: { mentionsOnly: boolean; timeoutMs: number }): Promise<string | 'timeout' | 'gone'> {
  const deadline = options.timeoutMs > 0 ? Date.now() + options.timeoutMs : Infinity;
  while (Date.now() < deadline) {
    const seconds = Math.max(1, Math.min(50, Math.ceil((deadline - Date.now()) / 1000)));
    let status: number;
    let body: string;
    try {
      ({ status, body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.get({
          host: '127.0.0.1',
          port: record.port,
          path: `/wait?timeout=${seconds}&mentions=${options.mentionsOnly ? 1 : 0}`,
          headers: { 'X-CrossTalk-Attach': record.token },
          timeout: (seconds + 10) * 1000
        }, res => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', chunk => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
        });
        req.on('timeout', () => req.destroy(new Error('attach wait timed out')));
        req.on('error', reject);
      }));
    } catch {
      return 'gone';
    }
    if (status === 200) return body;
    if (status !== 204) return 'gone';
  }
  return 'timeout';
}

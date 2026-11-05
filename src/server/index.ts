import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { HubFailure, MeshHub, SERVER_VERSION, type Connection, type HubOptions, type HubState, type Peer } from './hub.js';
import { SubnetGuard } from './subnet.js';
import { CLIENT_HEADER, INTERNAL_HEADER, INVITE_HEADER } from './internal.js';
import { hasCloudflared, startQuickTunnel, type Tunnel } from './tunnel.js';
import type { McpEndpoint } from './mcp-http.js';
import { DIALECT_V1 } from '../dialect/dictionary.js';
import { PROTOCOL_VERSION, type HelloFrame, type ServerFrame } from '../protocol.js';

export interface ServerOptions {
  port?: number;
  /** Defaults to 127.0.0.1. Use 0.0.0.0 to accept LAN connections (set a token!). */
  host?: string;
  /** Shared secret required from every client. Defaults to $CROSSTALK_AUTH_TOKEN. */
  token?: string;
  /** CIDR / preset allow-list, e.g. ['lan'] or ['10.0.0.0/8']. Empty = allow all. */
  allowedSubnets?: string[];
  /**
   * Browser origins allowed to talk to the hub without the token, e.g. a
   * self-hosted cockpit. Defaults to $CROSSTALK_ALLOWED_ORIGINS (comma-separated).
   * Requests from any other web page are refused, so a site you happen to visit
   * cannot join your channels.
   */
  allowedOrigins?: string[];
  /**
   * Behind a reverse proxy (Railway, Fly, nginx...), take the client address
   * from X-Real-IP / X-Forwarded-For instead of the socket, so per-address
   * limits and subnet rules apply to real clients rather than to the proxy.
   * Only enable when the hub is reachable solely through that proxy.
   * Defaults to $CROSSTALK_TRUST_PROXY=1.
   */
  trustProxy?: boolean;
  /** HTTP agent sessions are dropped after this long without a request or poll. */
  sessionTtlMs?: number;
  hub?: HubOptions;
  quiet?: boolean;
  /**
   * Where the hub saves channels, agents, locks, claims and questions, so a
   * restart doesn't drop them: clients that reconnect within the grace period
   * carry on as the same agent, holding the same locks. `false` keeps
   * everything in memory. Defaults to $CROSSTALK_STATE_FILE ("off" disables),
   * else ~/.crosstalk/hub-<port>.json for a hub bound to loopback on a fixed
   * port (auto-started hubs included), else in memory.
   */
  stateFile?: string | false;
  /** How long agents restored from the state file have to reconnect. Default 5 minutes. */
  restoreGraceMs?: number;
  /**
   * A second, public door for agents outside this machine (#13). It listens
   * on 127.0.0.1 only, so nothing outside can reach it except through a
   * tunnel, and it admits only requests that carry a live invite key (xi_…,
   * see `invite.create`), each limited to its invite's channel. The hub token
   * is not accepted there, and the directory and read-only API are closed.
   */
  public?: {
    /** Loopback port for the public listener. Default: any free port. */
    port?: number;
    /** Start a Cloudflare quick tunnel to it (needs `cloudflared`). Default true unless `url` is given. */
    tunnel?: boolean;
    /** The public base URL when you run your own tunnel or proxy, e.g. https://hub.example.com */
    url?: string;
  };
}

/**
 * The state file a hub on `host:port` uses unless told otherwise, or undefined
 * for none. On Railway with a volume attached, the volume (so channels survive
 * redeploys); otherwise only loopback hubs keep state by default.
 */
export function defaultStateFile(host: string, port: number): string | undefined {
  const env = process.env.CROSSTALK_STATE_FILE?.trim();
  if (env) return env === 'off' || env === '0' ? undefined : env;
  const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (volume) return path.join(volume, 'crosstalk-hub.json');
  if (!port || !SubnetGuard.isLoopbackHost(host)) return undefined;
  return path.join(os.homedir(), '.crosstalk', `hub-${port}.json`);
}

/** Writes atomically (temp file + rename), readable only by this user. */
function saveState(file: string, state: HubState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export interface RunningServer {
  hub: MeshHub;
  server: http.Server;
  wss: WebSocketServer;
  url: string;
  /** Where state is saved, if anywhere. */
  stateFile?: string;
  /** The public door (#13), when enabled: its loopback port and its public base URL (https://…), if known. */
  publicDoor?: { port: number; url?: string };
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 256 * 1024;

/** Marks requests that came through the public door (#13), and the invite key a WebSocket upgrade there presented. */
const PUBLIC = Symbol('crosstalk.public');
const INVITE = Symbol('crosstalk.invite');
type PublicRequest = http.IncomingMessage & { [PUBLIC]?: boolean; [INVITE]?: string };
const MAX_POLL_SECONDS = 55;
const HELLO_TIMEOUT_MS = 10_000;
const QUEUE_LIMIT = 1000;

const safeEqual = (a: string, b: string): boolean => {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

function presentedToken(req: http.IncomingMessage, url: URL): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const header = req.headers['x-crosstalk-token'];
  if (typeof header === 'string') return header.trim();
  return url.searchParams.get('token') ?? undefined;
}

/**
 * An agent connected over plain HTTP. Events queue up until the agent long-polls
 * `GET /v1/events`, so agents that can only make HTTP calls (or run curl) still
 * receive pushes with low latency.
 */
class HttpSession {
  readonly conn: Connection;
  lastSeen = Date.now();
  private queue: ServerFrame[] = [];
  private waiter?: () => void;

  constructor(hub: MeshHub, address: string, readonly token: string, inviteKey?: string) {
    const peer: Peer = {
      send: frame => {
        this.queue.push(frame);
        if (this.queue.length > QUEUE_LIMIT) this.queue.shift();
        this.waiter?.();
      },
      close: () => this.waiter?.()
    };
    this.conn = hub.connect(peer, address, { inviteKey });
  }

  /**
   * `onlyMentions`: return only what needs this agent (DMs, channel messages
   * that @mention it, lock and slot grants), dropping everything else, and
   * keep waiting through the noise until something matches or time runs out.
   */
  async poll(waitSeconds: number, onlyMentions = false, exclude: ReadonlySet<string> = new Set()): Promise<ServerFrame[]> {
    if (!onlyMentions && !exclude.size) return this.pollRaw(waitSeconds);
    const keep = (f: ServerFrame) => !exclude.has(f.type) && (!onlyMentions || this.needsMe(f));
    const deadline = Date.now() + waitSeconds * 1000;
    for (;;) {
      const frames = (await this.pollRaw(Math.max(0, (deadline - Date.now()) / 1000))).filter(keep);
      if (frames.length || Date.now() >= deadline) return frames;
    }
  }

  private needsMe(frame: ServerFrame): boolean {
    if (frame.type === 'dm' || frame.type.endsWith('.granted')) return true;
    if (frame.type !== 'message') return false;
    const me = this.conn.agent?.id;
    return !!me && !!frame.message.mentions?.some(m => m.id === me);
  }

  private async pollRaw(waitSeconds: number): Promise<ServerFrame[]> {
    if (!this.queue.length && waitSeconds > 0) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(done, waitSeconds * 1000);
        const self = this;
        function done() {
          clearTimeout(timer);
          if (self.waiter === done) self.waiter = undefined;
          resolve();
        }
        this.waiter?.();
        this.waiter = done;
      });
    }
    this.lastSeen = Date.now();
    return this.queue.splice(0);
  }

  wake(): void {
    this.waiter?.();
  }
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const port = options.port ?? 4488;
  const host = options.host ?? '127.0.0.1';
  const token = (options.token ?? process.env.CROSSTALK_AUTH_TOKEN ?? '').trim();
  const subnets = options.allowedSubnets ?? [];
  const origins = new Set(
    (options.allowedOrigins ?? (process.env.CROSSTALK_ALLOWED_ORIGINS ?? '').split(','))
      .map(o => o.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
  const loopbackOnly = SubnetGuard.isLoopbackHost(host);
  const trustProxy = options.trustProxy ?? process.env.CROSSTALK_TRUST_PROXY === '1';

  /** The client's IP: from the proxy's headers when trusted, else the socket. */
  const clientIp = (req: http.IncomingMessage): string => {
    if (trustProxy) {
      const real = req.headers['x-real-ip'];
      if (typeof real === 'string' && real.trim()) return real.trim();
      const forwarded = req.headers['x-forwarded-for'];
      // The proxy appends the address it saw, so the last entry is the trustworthy one.
      const hops = typeof forwarded === 'string' ? forwarded.split(',').map(h => h.trim()).filter(Boolean) : [];
      if (hops.length) return hops[hops.length - 1];
    }
    return req.socket.remoteAddress ?? '';
  };
  const sessionTtlMs = options.sessionTtlMs ?? 10 * 60 * 1000;
  const log = options.quiet ? () => {} : (...args: unknown[]) => console.log('[crosstalk]', ...args);

  // Behind a proxy or PaaS the hub can't see its own public name; use it when known.
  const publicUrl = (process.env.CROSSTALK_PUBLIC_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `wss://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')).trim();
  const webhooksEnv = process.env.CROSSTALK_WEBHOOKS?.trim();
  const webhooks = webhooksEnv === 'any' || webhooksEnv === 'off' || webhooksEnv === 'public'
    ? webhooksEnv
    : SubnetGuard.isLoopbackHost(host) ? 'any' : 'public';
  const hub = new MeshHub({ webhooks, publicUrl, ...options.hub }).start();
  const sessions = new Map<string, HttpSession>();
  /** Shared only with this process's remote-MCP bridges (see mcp-http.ts). */
  const internalSecret = crypto.randomBytes(24).toString('base64url');
  let mcp: Promise<McpEndpoint> | undefined;
  let boundPort = port;

  /** A connection from one of this process's remote-MCP bridges, whose client was already admitted on /mcp. */
  const isInternal = (req: http.IncomingMessage): boolean => {
    const presented = req.headers[INTERNAL_HEADER];
    return typeof presented === 'string' && safeEqual(presented, internalSecret);
  };

  /**
   * Admission policy, applied to HTTP requests and WebSocket upgrades:
   * - the client address must pass the subnet allow-list;
   * - on a loopback bind the Host header must be a loopback name (blocks DNS rebinding);
   * - if a token is configured it must be presented;
   * - a browser (any request with an Origin header) must be from an allowed origin,
   *   or present the token. Non-browser agents send no Origin.
   */
  const admitted = (req: http.IncomingMessage, url: URL): 'ok' | 'subnet' | 'token' | 'origin' => {
    if (!SubnetGuard.isAllowed(clientIp(req), subnets)) return 'subnet';
    if (loopbackOnly) {
      const hostname = (req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
      if (hostname && !SubnetGuard.isLoopbackHost(hostname)) return 'origin';
    }
    const presented = presentedToken(req, url);
    const tokenOk = !!token && !!presented && safeEqual(presented, token);
    if (token && !tokenOk) return 'token';
    const origin = req.headers.origin;
    if (origin && !tokenOk && !origins.has(origin) && !sameLoopbackOrigin(origin, req)) return 'origin';
    return 'ok';
  };

  /**
   * Non-browser clients such as Python's websocket-client send an Origin equal to
   * the hub URL. That is safe to accept on loopback, where no web page can be
   * served from (or rebound to) the hub's own origin.
   */
  const sameLoopbackOrigin = (origin: string, req: http.IncomingMessage): boolean => {
    try {
      const o = new URL(origin);
      return o.host === req.headers.host && SubnetGuard.isLoopbackHost(o.hostname.replace(/^\[|\]$/g, ''));
    } catch {
      return false;
    }
  };

  const addressOf = (req: http.IncomingMessage) => {
    if ((req as PublicRequest)[PUBLIC]) {
      // Only the tunnel can reach the public door, so its forwarding headers name the real client.
      const cf = req.headers['cf-connecting-ip'];
      const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map(h => h.trim()).filter(Boolean);
      const ip = (typeof cf === 'string' && cf.trim()) || hops[hops.length - 1];
      if (ip) return `public:${SubnetGuard.normalizeIp(ip) || ip}`;
      return 'public:unknown';
    }
    return SubnetGuard.normalizeIp(clientIp(req)) || 'unknown';
  };

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  const readJson = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
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
          const parsed = text ? JSON.parse(text) : {};
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
          resolve(parsed);
        } catch {
          reject(new Error('Body must be a JSON object'));
        }
      });
      req.on('error', reject);
    });

  const sessionFor = (req: http.IncomingMessage): HttpSession | undefined => {
    const id = req.headers['x-crosstalk-session'];
    const session = typeof id === 'string' ? sessions.get(id) : undefined;
    if (session) session.lastSeen = Date.now();
    return session;
  };

  const endSession = (session: HttpSession) => {
    sessions.delete(session.token);
    hub.disconnect(session.conn);
    session.wake();
  };

  const reaper = setInterval(() => {
    const cutoff = Date.now() - sessionTtlMs;
    for (const session of sessions.values()) {
      if (session.lastSeen < cutoff) endSession(session);
    }
  }, 30_000);
  reaper.unref();

  /** The invite key a public-door request carries: X-CrossTalk-Invite, Authorization: Bearer xi_…, or ?key=. */
  const presentedInvite = (req: http.IncomingMessage, url: URL): string | undefined => {
    const header = req.headers['x-crosstalk-invite'];
    if (typeof header === 'string' && header) return header.trim();
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer xi_')) return auth.slice(7).trim();
    return url.searchParams.get('key') ?? undefined;
  };

  /** The invite a WebSocket connection is held to: from the public door, or from a remote-MCP bridge serving one. */
  const inviteFor = (req: http.IncomingMessage): string | undefined => {
    if ((req as PublicRequest)[PUBLIC]) return (req as PublicRequest)[INVITE];
    const bridged = req.headers[INVITE_HEADER];
    return isInternal(req) && typeof bridged === 'string' && bridged ? bridged : undefined;
  };

  let mcpPublic: Promise<McpEndpoint> | undefined;
  let publicDoor: RunningServer['publicDoor'];

  /**
   * The public door's routes: health, the HTTP agent API, remote MCP and
   * WebSocket (in the upgrade handler). Every one but health needs a live
   * invite key; the directory and read-only API don't exist here.
   */
  const handlePublic = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://hub.local');
    const origin = req.headers.origin;
    if (origin) {
      // Browser agents are fine here: nothing is reachable without the key.
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CrossTalk-Invite, X-CrossTalk-Session, Mcp-Session-Id, Mcp-Protocol-Version');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    }
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const route = `${req.method} ${path}`;
    if (route === 'GET /health' || route === 'GET /') return json(res, 200, { ok: true, name: 'crosstalk', protocol: PROTOCOL_VERSION, door: 'public' });

    const key = presentedInvite(req, url);
    const invite = key ? hub.liveInvite(key) : undefined;
    if (!key || !invite) return json(res, 401, { error: { code: 'unauthorized', message: 'This hub only admits agents with a live invite key (X-CrossTalk-Invite: xi_…)' } });
    try {
      if (path === '/mcp') {
        mcpPublic ??= import('./mcp-http.js').then(m => m.createMcpEndpoint({ hubUrl: `ws://127.0.0.1:${boundPort}`, token: token || undefined, secret: internalSecret }));
        return await (await mcpPublic).handle(req, res, url, addressOf(req), key);
      }
      if (route === 'POST /v1/sessions') {
        const body = await readJson(req);
        let session: HttpSession;
        try {
          session = new HttpSession(hub, addressOf(req), `xs_${crypto.randomBytes(24).toString('base64url')}`, key);
        } catch (err) {
          if (err instanceof HubFailure) return json(res, err.code === 'unauthorized' ? 401 : 429, { error: { code: err.code, message: err.message } });
          throw err;
        }
        try {
          const welcome = hub.hello(session.conn, { type: 'hello', protocol: PROTOCOL_VERSION, agent: body.agent ?? body } as HelloFrame);
          sessions.set(session.token, session);
          return json(res, 201, { session: session.token, agent: welcome.agent, protocol: PROTOCOL_VERSION, channel: invite.channel });
        } catch (err: any) {
          hub.disconnect(session.conn);
          return json(res, 400, { error: { code: err.code ?? 'bad_request', message: err.message } });
        }
      }
      if (path.startsWith('/v1/')) {
        const session = sessionFor(req);
        // A session made at the local door can't be driven from the public one, or with another invite.
        if (!session || session.conn.invite?.id !== invite.id) {
          return json(res, 401, { error: { code: 'not_registered', message: 'Missing or expired X-CrossTalk-Session; POST /v1/sessions first' } });
        }
        if (route === 'DELETE /v1/sessions') {
          endSession(session);
          return json(res, 200, { ok: true });
        }
        if (route === 'POST /v1/rpc') {
          const body = await readJson(req);
          const result = await hub.request(session.conn, { ...body, id: typeof body.id === 'string' ? body.id : crypto.randomUUID() });
          return json(res, result.type === 'result' && !result.ok ? 400 : 200, result);
        }
        if (route === 'GET /v1/events') {
          const wait = Math.max(0, Math.min(Number(url.searchParams.get('wait') ?? 0) || 0, MAX_POLL_SECONDS));
          req.socket.setTimeout(0);
          const exclude = new Set((url.searchParams.get('exclude') ?? '').split(',').map(t => t.trim()).filter(Boolean));
          hub.pollStarted(session.conn);
          const events = await session.poll(wait, url.searchParams.get('only') === 'mentions', exclude).finally(() => hub.pollEnded(session.conn));
          if (!res.writableEnded) json(res, 200, { events });
          return;
        }
      }
      json(res, 404, { error: { code: 'not_found', message: 'Not available through the public door' } });
    } catch (err: any) {
      if (!res.headersSent) json(res, 400, { error: { code: 'bad_request', message: err.message } });
    }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://hub.local');
    const origin = req.headers.origin;
    // CORS is only granted to allow-listed origins, or to any origin when a token
    // is required (the browser then has to present the token to get anywhere).
    if (origin && (origins.has(origin) || token)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CrossTalk-Token, X-CrossTalk-Session, Mcp-Session-Id, Mcp-Protocol-Version');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const route = `${req.method} ${url.pathname.replace(/\/+$/, '') || '/'}`;

    if (route === 'GET /health' || route === 'GET /') {
      json(res, 200, { ok: true, name: 'crosstalk', version: SERVER_VERSION, protocol: PROTOCOL_VERSION, ...hub.stats(), ...(publicDoor?.url ? { publicUrl: publicDoor.url } : {}) });
      return;
    }

    const admission = admitted(req, url);
    if (admission !== 'ok') {
      const message = { token: 'Missing or invalid token', subnet: 'Address not allowed', origin: 'Origin or host not allowed' }[admission];
      json(res, admission === 'token' ? 401 : 403, { error: { code: 'unauthorized', message } });
      return;
    }

    try {
      // --- Remote MCP (Streamable HTTP) --------------------------------------
      if (url.pathname.replace(/\/+$/, '') === '/mcp') {
        mcp ??= import('./mcp-http.js').then(m => {
          // Bridges connect back to this hub on whatever interface it is bound to.
          const self = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
          const hubUrl = `ws://${self.includes(':') ? `[${self}]` : self}:${boundPort}`;
          return m.createMcpEndpoint({ hubUrl, token: token || undefined, secret: internalSecret });
        });
        return await (await mcp).handle(req, res, url, addressOf(req));
      }

      // --- Read-only observer API ------------------------------------------
      if (route === 'GET /api/dialect') return json(res, 200, DIALECT_V1);
      if (route === 'GET /api/channels') {
        const limit = Number(url.searchParams.get('limit')) || undefined;
        return json(res, 200, hub.listChannels(undefined, 'public', limit, url.searchParams.get('cursor') ?? undefined));
      }

      const channelMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/?$/);
      if (req.method === 'GET' && channelMatch) {
        const snap = hub.snapshotByAddress(decodeURIComponent(channelMatch[1]), url.searchParams.get('since') ?? undefined);
        return snap ? json(res, 200, snap) : json(res, 404, { error: { code: 'not_found', message: 'No conversation at that address' } });
      }

      const receiptsMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/receipts\/?$/);
      if (req.method === 'GET' && receiptsMatch) {
        const receipts = hub.receiptsByAddress(decodeURIComponent(receiptsMatch[1]), Number(url.searchParams.get('limit')) || undefined);
        return receipts ? json(res, 200, { receipts }) : json(res, 404, { error: { code: 'not_found', message: 'No conversation at that address' } });
      }

      if (route === 'GET /api/locks/check') {
        const channel = url.searchParams.get('channel') ?? '';
        const file = url.searchParams.get('file') ?? '';
        if (!channel || !file) return json(res, 400, { error: { code: 'bad_request', message: 'channel and file are required' } });
        const status = hub.checkLock(channel, file);
        return status ? json(res, 200, status) : json(res, 404, { error: { code: 'not_found', message: 'No conversation at that address' } });
      }

      // --- HTTP agent API -----------------------------------------------------
      if (route === 'POST /v1/sessions') {
        const body = await readJson(req);
        let session: HttpSession;
        try {
          session = new HttpSession(hub, addressOf(req), `xs_${crypto.randomBytes(24).toString('base64url')}`);
        } catch (err) {
          if (err instanceof HubFailure) return json(res, 429, { error: { code: err.code, message: err.message } });
          throw err;
        }
        const hello = { type: 'hello', protocol: PROTOCOL_VERSION, agent: body.agent ?? body } as HelloFrame;
        try {
          const welcome = hub.hello(session.conn, hello);
          sessions.set(session.token, session);
          return json(res, 201, { session: session.token, agent: welcome.agent, protocol: PROTOCOL_VERSION });
        } catch (err: any) {
          hub.disconnect(session.conn);
          return json(res, 400, { error: { code: err.code ?? 'bad_request', message: err.message } });
        }
      }

      if (url.pathname.startsWith('/v1/')) {
        const session = sessionFor(req);
        if (!session) {
          return json(res, 401, { error: { code: 'not_registered', message: 'Missing or expired X-CrossTalk-Session; POST /v1/sessions first' } });
        }

        if (route === 'DELETE /v1/sessions') {
          endSession(session);
          return json(res, 200, { ok: true });
        }
        if (route === 'POST /v1/rpc') {
          const body = await readJson(req);
          const frame = { ...body, id: typeof body.id === 'string' ? body.id : crypto.randomUUID() };
          const result = await hub.request(session.conn, frame);
          return json(res, result.type === 'result' && !result.ok ? 400 : 200, result);
        }
        if (route === 'GET /v1/events') {
          const wait = Math.max(0, Math.min(Number(url.searchParams.get('wait') ?? 0) || 0, MAX_POLL_SECONDS));
          req.socket.setTimeout(0);
          // A process blocked here is listening; when it returns, it has the events.
          const exclude = new Set((url.searchParams.get('exclude') ?? '').split(',').map(t => t.trim()).filter(Boolean));
          hub.pollStarted(session.conn);
          const events = await session.poll(wait, url.searchParams.get('only') === 'mentions', exclude).finally(() => hub.pollEnded(session.conn));
          if (!res.writableEnded) json(res, 200, { events });
          return;
        }
      }

      json(res, 404, { error: { code: 'not_found', message: `No route for ${route}` } });
    } catch (err: any) {
      if (!res.headersSent) json(res, 400, { error: { code: 'bad_request', message: err.message } });
    }
  });

  // --- WebSocket transport -------------------------------------------------
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY_BYTES });
  const alive = new WeakSet<WebSocket>();

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://hub.local');
    const admission = isInternal(req) ? 'ok' : admitted(req, url);
    if (admission !== 'ok') {
      socket.end(`HTTP/1.1 ${admission === 'token' ? '401 Unauthorized' : '403 Forbidden'}\r\nConnection: close\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    let conn: Connection;
    try {
      conn = hub.connect({
        send: frame => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
        },
        close: (code, reason) => ws.close(code, reason)
      }, isInternal(req) ? String(req.headers[CLIENT_HEADER] ?? 'unknown') : addressOf(req), { inviteKey: inviteFor(req) });
    } catch (err) {
      ws.close(1013, err instanceof HubFailure ? err.message : 'Hub unavailable');
      return;
    }
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));

    const helloTimer = setTimeout(() => {
      if (!conn.agent) ws.close(4408, 'hello timeout');
    }, HELLO_TIMEOUT_MS);

    // Process frames in order, even though requests are async.
    let chain = Promise.resolve();
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        conn.peer.send({ type: 'error', error: { code: 'bad_request', message: 'Binary frames are not supported' } });
        return;
      }
      chain = chain.then(() => hub.receive(conn, data.toString())).catch(err => console.error('[crosstalk]', err));
    });
    ws.on('close', code => {
      clearTimeout(helloTimer);
      // 1000 is a deliberate close (CrossTalk.close()); anything else may be a
      // network blip, so the agent stays present for the grace period.
      if (code === 1000) hub.disconnect(conn);
      else hub.drop(conn);
    });
    ws.on('error', () => ws.terminate());
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref();

  const stateFile = options.stateFile === false ? undefined : options.stateFile ?? defaultStateFile(host, port);
  let savedRevision = -1;
  const persist = () => {
    if (!stateFile || hub.revision === savedRevision) return;
    try {
      const revision = hub.revision;
      saveState(stateFile, hub.exportState());
      savedRevision = revision;
    } catch (err) {
      log(`could not save state to ${stateFile}: ${(err as Error).message}`);
    }
  };

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      // Only the process that won the port reads the state file, and it does
      // so before any client can say hello.
      if (stateFile) {
        try {
          const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as HubState;
          const restored = hub.restoreState(state, options.restoreGraceMs ?? 5 * 60 * 1000);
          log(`restored ${restored.channels} channel(s), ${restored.agents} agent(s) and ${restored.locks} lock(s) from ${stateFile}`);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`ignoring state in ${stateFile}: ${(err as Error).message}`);
        }
        savedRevision = hub.revision;
      }
      resolve();
    });
  });
  const saver = setInterval(persist, 1000);
  saver.unref();

  // --- Public door (#13) ------------------------------------------------------
  let publicServer: http.Server | undefined;
  let tunnel: Tunnel | undefined;
  if (options.public) {
    publicServer = http.createServer((req, res) => {
      (req as PublicRequest)[PUBLIC] = true;
      void handlePublic(req, res);
    });
    publicServer.on('upgrade', (req, socket, head) => {
      (req as PublicRequest)[PUBLIC] = true;
      const url = new URL(req.url ?? '/', 'http://hub.local');
      const key = presentedInvite(req, url);
      if (!key || !hub.liveInvite(key)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return;
      }
      (req as PublicRequest)[INVITE] = key;
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    });
    await new Promise<void>((resolve, reject) => {
      publicServer!.once('error', reject);
      publicServer!.listen(options.public!.port ?? 0, '127.0.0.1', () => {
        publicServer!.off('error', reject);
        resolve();
      });
    });
    const port = (publicServer.address() as { port: number }).port;
    publicDoor = { port, url: options.public.url?.replace(/\/+$/, '') };
    if (!publicDoor.url && options.public.tunnel !== false) {
      if (!hasCloudflared()) {
        log(`public door on 127.0.0.1:${port}, but cloudflared isn't installed: start a tunnel to it yourself and pass --public-url`);
      } else {
        try {
          tunnel = await startQuickTunnel(port);
          publicDoor.url = tunnel.url;
          void tunnel.exited.then(code => log(`tunnel stopped (code ${code}); remote agents can't reach the hub until it is restarted`));
        } catch (err) {
          log(`could not start the tunnel: ${(err as Error).message}`);
        }
      }
    }
    log(`public door on 127.0.0.1:${port}${publicDoor.url ? ` → ${publicDoor.url}` : ''}; only invite keys get in (crosstalk invite xt_… --remote)`);
  }

  const address = server.address();
  boundPort = typeof address === 'object' && address ? address.port : port;
  const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  const url = `ws://${displayHost}:${boundPort}`;

  if (host === '0.0.0.0' || host === '::') {
    log(`hub listening on all network interfaces, port ${boundPort}`);
  } else {
    log(`hub listening on ${url} (http://${displayHost}:${boundPort}/health)`);
  }
  if (publicUrl) log(`public address: ${publicUrl} — agents connect with CROSSTALK_URL=${publicUrl}`);
  if (!SubnetGuard.isLoopbackHost(host) && !token) {
    log('warning: listening beyond localhost without CROSSTALK_AUTH_TOKEN; anyone who can reach this port can join public channels');
  }

  return {
    hub,
    server,
    wss,
    url,
    stateFile,
    publicDoor,
    close: async () => {
      tunnel?.close();
      if (publicServer) {
        const closing = new Promise<void>(resolve => publicServer!.close(() => resolve()));
        publicServer.closeAllConnections?.();
        await closing;
      }
      await (await mcpPublic)?.close();
      // Save before tearing down connections, which would evict every agent.
      clearInterval(saver);
      persist();
      clearInterval(heartbeat);
      clearInterval(reaper);
      hub.stop();
      await (await mcp)?.close();
      for (const session of sessions.values()) endSession(session);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      const closed = new Promise<void>(resolve => server.close(() => resolve()));
      server.closeAllConnections?.();
      await closed;
    }
  };
}

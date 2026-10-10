import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { HubFailure, MeshHub, SERVER_VERSION, type Connection, type HubOptions, type Peer } from './hub.js';
import { SubnetGuard } from './subnet.js';
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
}

export interface RunningServer {
  hub: MeshHub;
  server: http.Server;
  wss: WebSocketServer;
  url: string;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 256 * 1024;
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

  constructor(hub: MeshHub, address: string, readonly token: string) {
    const peer: Peer = {
      send: frame => {
        this.queue.push(frame);
        if (this.queue.length > QUEUE_LIMIT) this.queue.shift();
        this.waiter?.();
      },
      close: () => this.waiter?.()
    };
    this.conn = hub.connect(peer, address);
  }

  async poll(waitSeconds: number): Promise<ServerFrame[]> {
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

  const hub = new MeshHub(options.hub).start();
  const sessions = new Map<string, HttpSession>();

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

  const addressOf = (req: http.IncomingMessage) => SubnetGuard.normalizeIp(clientIp(req)) || 'unknown';

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

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://hub.local');
    const origin = req.headers.origin;
    // CORS is only granted to allow-listed origins, or to any origin when a token
    // is required (the browser then has to present the token to get anywhere).
    if (origin && (origins.has(origin) || token)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CrossTalk-Token, X-CrossTalk-Session');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const route = `${req.method} ${url.pathname.replace(/\/+$/, '') || '/'}`;

    if (route === 'GET /health' || route === 'GET /') {
      json(res, 200, { ok: true, name: 'crosstalk', version: SERVER_VERSION, protocol: PROTOCOL_VERSION, ...hub.stats() });
      return;
    }

    const admission = admitted(req, url);
    if (admission !== 'ok') {
      const message = { token: 'Missing or invalid token', subnet: 'Address not allowed', origin: 'Origin or host not allowed' }[admission];
      json(res, admission === 'token' ? 401 : 403, { error: { code: 'unauthorized', message } });
      return;
    }

    try {
      // --- Read-only observer API ------------------------------------------
      if (route === 'GET /api/dialect') return json(res, 200, DIALECT_V1);
      if (route === 'GET /api/channels') {
        const limit = Number(url.searchParams.get('limit')) || undefined;
        return json(res, 200, hub.listChannels(undefined, 'public', limit, url.searchParams.get('cursor') ?? undefined));
      }

      const channelMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/?$/);
      if (req.method === 'GET' && channelMatch) {
        const snap = hub.snapshotByAddress(decodeURIComponent(channelMatch[1]));
        return snap ? json(res, 200, snap) : json(res, 404, { error: { code: 'not_found', message: 'No conversation at that address' } });
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
          const events = await session.poll(wait);
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
    const admission = admitted(req, url);
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
      }, addressOf(req));
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
    ws.on('close', () => {
      clearTimeout(helloTimer);
      hub.disconnect(conn);
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

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  const url = `ws://${displayHost}:${boundPort}`;

  if (host === '0.0.0.0' || host === '::') {
    log(`hub listening on all network interfaces, port ${boundPort}`);
  } else {
    log(`hub listening on ${url} (http://${displayHost}:${boundPort}/health)`);
  }
  // Behind a proxy or PaaS the hub can't see its own public name; print it when known.
  const publicUrl = (process.env.CROSSTALK_PUBLIC_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `wss://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')).trim();
  if (publicUrl) log(`public address: ${publicUrl} — agents connect with CROSSTALK_URL=${publicUrl}`);
  if (!SubnetGuard.isLoopbackHost(host) && !token) {
    log('warning: listening beyond localhost without CROSSTALK_AUTH_TOKEN; anyone who can reach this port can join public channels');
  }

  return {
    hub,
    server,
    wss,
    url,
    close: async () => {
      clearInterval(heartbeat);
      clearInterval(reaper);
      hub.stop();
      for (const session of sessions.values()) endSession(session);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      const closed = new Promise<void>(resolve => server.close(() => resolve()));
      server.closeAllConnections?.();
      await closed;
    }
  };
}

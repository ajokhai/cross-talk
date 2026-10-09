import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MeshHub } from './hub.js';
import { DIALECT_V1 } from '../dialect/dictionary.js';
import { blue, green, yellow, cyan, bold } from 'colorette';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function startServer(port: number = 4488, host: string = '0.0.0.0') {
  const hub = new MeshHub();
  const webDir = path.join(__dirname, 'web');

  const server = http.createServer((req, res) => {
    // CORS headers for local tools
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // REST API Endpoints
    if (pathname === '/api/state') {
      const channel = url.searchParams.get('channel') || 'default';
      const agents = hub.getAgentsInChannel(channel);
      const locks = hub.getLockManager().getLocks(channel);
      const messages = hub.getRecentMessages(channel);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ channel, agents, locks, messages }, null, 2));
      return;
    }

    if (pathname === '/api/who') {
      const allAgents = hub.getAllAgents();
      const allLocks = hub.getLockManager().getLocks();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ agents: allAgents, locks: allLocks }, null, 2));
      return;
    }

    // Versioned XDialect dictionary endpoint for any agent or client
    if (pathname === '/api/dialect' || pathname === '/api/dialect/v1') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(DIALECT_V1, null, 2));
      return;
    }

    // Live Mesh Stats for landing page & monitoring
    if (pathname === '/api/stats') {
      const channel = url.searchParams.get('channel') || 'default';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(hub.getStats(channel), null, 2));
      return;
    }

    // Recent 50-100 message history buffer for context synchronization
    if (pathname === '/api/history') {
      const channel = url.searchParams.get('channel') || 'default';
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 100);
      const messages = hub.getRecentMessages(channel).slice(-limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ channel, count: messages.length, limit, messages }, null, 2));
      return;
    }

    if (pathname === '/api/broadcast' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const channel = parsed.channel || 'default';
          const from = parsed.from || 'Human-Operator';
          const content = parsed.content || '';
          if (!content) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'content required' }));
            return;
          }
          const msg = hub.injectBroadcast(channel, from, content, parsed.role || 'human');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: msg }));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (pathname === '/api/check-lock' && req.method === 'GET') {
      const file = url.searchParams.get('file');
      if (!file) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'file param required' }));
        return;
      }
      const lockStatus = hub.getLockManager().isLocked(file);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(lockStatus));
      return;
    }

    // Static Web Dashboard files
    let filePath = path.join(webDir, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(webDir, 'index.html');
    }

    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.svg': 'image/svg+xml',
        '.json': 'application/json'
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  // Attach WebSocket Server
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    hub.handleConnection(ws);
  });

  server.listen(port, host, () => {
    console.log(`\n${bold(green('⚡ CrossTalk Mesh Network Server Running!'))}`);
    console.log(`📡 WebSocket URL:      ${cyan(`ws://localhost:${port}`)}`);
    console.log(`🌐 Live Dashboard:     ${cyan(`http://localhost:${port}`)}`);
    console.log(`📖 Dialect Dictionary: ${cyan(`http://localhost:${port}/api/dialect`)}\n`);
  });

  return { server, wss, hub };
}

// If executed directly
if (process.argv[1] && (process.argv[1].endsWith('server/index.ts') || process.argv[1].endsWith('server/index.js'))) {
  const port = parseInt(process.env.CROSSTALK_PORT || '4488', 10);
  startServer(port);
}

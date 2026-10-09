import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, type RunningServer } from '../src/server/index.js';
import { CrossTalk, CrossTalkError } from '../src/client/sdk.js';
import { HttpAgent } from '../src/client/http.js';
import type { ChannelMessage } from '../src/protocol.js';

async function withServer(options: Parameters<typeof startServer>[0], fn: (s: RunningServer, http: string) => Promise<void>) {
  const server = await startServer({ port: 0, quiet: true, ...options });
  try {
    await fn(server, server.url.replace('ws://', 'http://'));
  } finally {
    await server.close();
  }
}

function rawGet(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, res => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on('error', reject);
  });
}

test('two SDK agents collaborate in a private conversation', async () => {
  await withServer({}, async ({ url }) => {
    const alice = await CrossTalk.connect({ name: 'alice', url, reconnect: false });
    const bob = await CrossTalk.connect({ name: 'bob', url, reconnect: false });
    try {
      const ch = await alice.createChannel('auth-refactor', { topic: 'jwt' });
      assert.match(ch.address, /^xt_/);

      const joined = new Promise(resolve => ch.once('member.joined', resolve));
      const bobCh = await bob.joinChannel(ch.address);
      await joined;
      assert.equal(ch.members.size, 2);

      const received = new Promise<ChannelMessage>(resolve => bobCh.once('message', resolve));
      await ch.send('taking the refresh flow');
      assert.equal((await received).content, 'taking the refresh flow');

      await ch.lock('src/auth.ts', 'refresh flow');
      await assert.rejects(bobCh.lock('src/auth.ts', 'me too'), (err: CrossTalkError) => {
        assert.equal(err.code, 'lock_held');
        return true;
      });

      // Messages arriving before waitForMessage() is called are buffered, not lost.
      await ch.send('done, unlocking');
      await new Promise(r => setTimeout(r, 50));
      assert.equal((await bob.waitForMessage({ channel: ch.address, timeoutMs: 2000 }))?.content, 'taking the refresh flow');
      assert.equal((await bob.waitForMessage({ channel: ch.address, timeoutMs: 2000 }))?.content, 'done, unlocking');
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});

test('HTTP agents keep presence across calls and long-poll for events', async () => {
  await withServer({}, async ({ url }) => {
    const ws = await CrossTalk.connect({ name: 'ws-agent', url, reconnect: false });
    const http = new HttpAgent({ name: 'curl-agent', url, sessionFile: false });
    try {
      const ch = await ws.createChannel('mixed');
      await http.open();
      const snap = await http.request('channel.join', { channel: ch.address });
      assert.equal(snap.members.length, 2);

      const poll = http.events(5);
      await ch.send('ping over websocket');
      const events = await poll;
      const msg = events.find(e => e.type === 'message');
      assert.ok(msg && msg.type === 'message' && msg.message.content === 'ping over websocket');

      const reply = new Promise<ChannelMessage>(resolve => ch.once('message', resolve));
      await http.request('message.send', { channel: ch.address, content: 'pong over http' });
      assert.equal((await reply).from.name, 'curl-agent');
    } finally {
      await http.close();
      await ws.close();
    }
  });
});

test('web pages cannot talk to a tokenless hub unless their origin is allowed', async () => {
  await withServer({ allowedOrigins: ['https://cockpit.example'] }, async (_s, base) => {
    const evil = await fetch(`${base}/v1/sessions`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'text/plain' },
      body: JSON.stringify({ name: 'drive-by' })
    });
    assert.equal(evil.status, 403);
    assert.equal(evil.headers.get('access-control-allow-origin'), null);

    const good = await fetch(`${base}/api/channels`, { headers: { Origin: 'https://cockpit.example' } });
    assert.equal(good.status, 200);
    assert.equal(good.headers.get('access-control-allow-origin'), 'https://cockpit.example');

    const agent = await fetch(`${base}/v1/sessions`, { method: 'POST', body: JSON.stringify({ name: 'no-content-type' }) });
    assert.equal(agent.status, 201, 'non-browser agents need no Origin or Content-Type');
  });
});

test('WebSocket upgrades from foreign origins are refused', async () => {
  await withServer({}, async ({ url }) => {
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(url, { headers: { Origin: 'https://evil.example' } });
    ws.on('error', () => {});
    const status = await new Promise<number>(resolve => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => resolve(101));
    });
    ws.terminate();
    assert.equal(status, 403);
  });
});

test('loopback hubs reject foreign Host headers (DNS rebinding)', async () => {
  await withServer({}, async (_s, base) => {
    assert.equal(await rawGet(`${base}/api/channels`, { Host: 'attacker.example:4488' }), 403);
    assert.equal(await rawGet(`${base}/api/channels`, {}), 200);
  });
});

test('a configured token is required everywhere except /health', async () => {
  await withServer({ token: 's3cret' }, async ({ url }, base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/channels`)).status, 401);
    assert.equal((await fetch(`${base}/api/channels`, { headers: { Authorization: 'Bearer nope' } })).status, 401);
    assert.equal((await fetch(`${base}/api/channels`, { headers: { Authorization: 'Bearer s3cret' } })).status, 200);

    await assert.rejects(CrossTalk.connect({ name: 'x', url, token: 'wrong', reconnect: false }));
    const ok = await CrossTalk.connect({ name: 'x', url, token: 's3cret', reconnect: false });
    await ok.close();
  });
});

test('channel snapshots and lock checks are readable by address over HTTP', async () => {
  await withServer({}, async ({ url }, base) => {
    const ct = await CrossTalk.connect({ name: 'alice', url, reconnect: false });
    try {
      const ch = await ct.createChannel('private-work');
      await ch.lock('/abs/outside/repo.ts', 'r').catch(() => {});
      await ch.lock('src/a.ts', 'editing');

      const snap = await (await fetch(`${base}/api/channels/${ch.address}`)).json();
      assert.equal(snap.channel.name, 'private-work');
      const check = await (await fetch(`${base}/api/locks/check?channel=${ch.address}&file=./src/a.ts`)).json();
      assert.equal(check.locked, true);
      assert.equal((await fetch(`${base}/api/channels/xt_AAAAAAAAAAAAAAAAAAAAAA`)).status, 404);

      const listed = await (await fetch(`${base}/api/channels`)).json();
      assert.equal(listed.channels.length, 0, 'private channels are not listed');
    } finally {
      await ct.close();
    }
  });
});

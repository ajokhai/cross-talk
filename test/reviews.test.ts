import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
// @ts-ignore: plain JS Vercel functions
import { handle } from '../api/reviews.js';
import { startServer } from '../src/server/index.js';
import { Bridge, createMcpServer } from '../src/mcp/server.js';

process.env.MONGODB_URI ||= 'mongodb://test-only';
process.env.CROSSTALK_LISTENER_CHECK = '0';

/** In-memory store with the same interface as mongoReviews(). */
function memoryStore() {
  const rows: any[] = [];
  const limits = new Map<string, number>();
  return {
    rows,
    async hit(key: string) { limits.set(key, (limits.get(key) ?? 0) + 1); return limits.get(key)!; },
    async insert(r: any) { rows.push(r); },
    async list({ all, limit }: { all: boolean; limit: number }) {
      return rows.filter(r => all || r.published).sort((a, b) => +b.at - +a.at).slice(0, limit);
    }
  };
}

async function call(store: ReturnType<typeof memoryStore>, method: string, { body, query = '', ip = '1.1.1.1', env = process.env }: { body?: unknown; query?: string; ip?: string; env?: NodeJS.ProcessEnv } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as any;
  req.method = method;
  req.url = `/api/reviews${query}`;
  req.headers = { 'x-real-ip': ip };
  let status = 0;
  let text = '';
  const res: any = { setHeader() {}, set statusCode(v: number) { status = v; }, end(t?: string) { text = t ?? ''; } };
  await handle(req, res, async () => store, env);
  return { status, body: text ? JSON.parse(text) : undefined };
}

/** The API on a real port, so the CLI and MCP tool can post to it. */
async function reviewSite(store: ReturnType<typeof memoryStore>) {
  const server = http.createServer((req, res) => { req.headers['x-real-ip'] = '9.9.9.9'; handle(req, res, async () => store); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/reviews`, close: () => new Promise(r => server.close(r)) };
}

test('an agent review is stored unpublished; only published ones are public', async () => {
  const store = memoryStore();
  const sent = await call(store, 'POST', { body: { rating: 5, review: 'Coordinated a refactor with Gemini; locks stopped two overwrites.', name: 'claude-code', model: 'Claude Opus 5.5', client: 'Claude Code', role: 'refactoring auth with Gemini', quote: true } });
  assert.equal(sent.status, 201);
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].kind, 'agent');
  assert.equal(store.rows[0].published, false);
  assert.ok(!JSON.stringify(store.rows[0]).includes('1.1.1.1'), 'the IP itself is never stored');

  assert.deepEqual((await call(store, 'GET')).body.reviews, []);
  store.rows[0].published = true;
  const pub = (await call(store, 'GET')).body.reviews;
  assert.equal(pub.length, 1);
  assert.equal(pub[0].name, 'claude-code');
  assert.equal(pub[0].ipHash, undefined);
  assert.equal(pub[0].quote, undefined);
  assert.equal(pub[0].byline, 'claude-code · Claude Opus 5.5 in Claude Code · refactoring auth with Gemini');
});

test('the author sees every review with the key; a wrong key sees only published ones', async () => {
  const store = memoryStore();
  const env = { ...process.env, REVIEWS_KEY: 'secret-key-123' };
  await call(store, 'POST', { body: { rating: 3, review: 'Listener setup confused me at first.', name: 'gemini', kind: 'agent' }, env });
  assert.equal((await call(store, 'GET', { query: '?key=wrong', env })).body.reviews.length, 0);
  const all = (await call(store, 'GET', { query: '?key=secret-key-123', env })).body.reviews;
  assert.equal(all.length, 1);
  assert.equal(all[0].published, false);
});

test('bad reviews are refused with a reason, bots get a fake success, floods are limited', async () => {
  const store = memoryStore();
  assert.match((await call(store, 'POST', { body: { rating: 6, review: 'x'.repeat(20), name: 'a' } })).body.error, /rating/);
  assert.match((await call(store, 'POST', { body: { rating: 4, review: 'short', name: 'a' } })).body.error, /at least 10/);
  assert.match((await call(store, 'POST', { body: { rating: 4, review: 'long enough review text' } })).body.error, /name is required/);
  assert.equal((await call(store, 'POST', { body: { rating: 4, review: 'long enough review text', name: 'bot', website: 'x' } })).status, 201);
  assert.equal(store.rows.length, 0);
  for (let i = 0; i < 5; i++) assert.equal((await call(store, 'POST', { body: { rating: 4, review: `fine review number ${i}`, name: 'a' }, ip: '2.2.2.2' })).status, 201);
  assert.equal((await call(store, 'POST', { body: { rating: 4, review: 'one review too many', name: 'a' }, ip: '2.2.2.2' })).status, 429);
});

test('crosstalk review sends an agent review from the CLI', async () => {
  const store = memoryStore();
  const site = await reviewSite(store);
  try {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-review-'));
    const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), path.resolve('src/client/cli.ts'), 'review', '4', 'Wake', 'hooks', 'saved', 'me', 'polling.', '--name', 'cli-agent', '--model', 'Claude Opus 5.5', '--role', 'testing wake hooks', '--quote'],
      { env: { ...process.env, HOME: home, NO_COLOR: '1', CROSSTALK_REVIEW_URL: site.url, CROSSTALK_NO_WELCOME: '1' } });
    let out = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (out += d));
    assert.equal(await new Promise(r => child.on('exit', r)), 0, out);
    assert.match(out, /Thanks/);
    assert.equal(store.rows[0].name, 'cli-agent');
    assert.equal(store.rows[0].review, 'Wake hooks saved me polling.');
    assert.equal(store.rows[0].rating, 4);
    assert.equal(store.rows[0].quote, true);
    assert.equal(store.rows[0].client, 'crosstalk cli');
    assert.equal(store.rows[0].role, 'testing wake hooks');
    assert.match(store.rows[0].tag, /^[0-9a-f]{6}$/);
  } finally {
    await site.close();
  }
});

test('MCP: crosstalk_leave_review sends a review under the agent name', async () => {
  const store = memoryStore();
  const site = await reviewSite(store);
  const hub = await startServer({ port: 0, quiet: true, stateFile: false });
  process.env.CROSSTALK_REVIEW_URL = site.url;
  const bridge = new Bridge({ name: 'mcp-reviewer', url: hub.url });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(bridge).connect(a);
  const client = new Client({ name: 'test-host', version: '0' });
  await client.connect(b);
  try {
    const res: any = await client.callTool({ name: 'crosstalk_leave_review', arguments: { rating: 5, review: 'One inbox for every agent question is the killer feature.', model: 'Gemini 3 Pro', client: 'Gemini CLI', role: 'reviewing PRs for a Claude team' } });
    assert.match(res.content[0].text, /^REVIEW SENT/);
    assert.equal(store.rows[0].name, 'mcp-reviewer');
    assert.equal(store.rows[0].model, 'Gemini 3 Pro');
    assert.equal(store.rows[0].quote, false);
    assert.equal(store.rows[0].role, 'reviewing PRs for a Claude team');
    const bad: any = await client.callTool({ name: 'crosstalk_leave_review', arguments: { rating: 9, review: 'nope nope nope', model: 'x', role: 'y' } });
    assert.match(bad.content[0].text, /rating must be/);
  } finally {
    delete process.env.CROSSTALK_REVIEW_URL;
    await bridge.close();
    await hub.close();
    await site.close();
  }
});

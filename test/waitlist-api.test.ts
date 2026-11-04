import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
// @ts-ignore: plain JS Vercel functions
import { handle } from '../api/waitlist.js';
// @ts-ignore
import { BUMP, normalizeEmail } from '../api/_waitlist.js';

type Entry = { _id: string; email: string; agent: string; seq: number; score: number; ref: string; referredBy?: string; referrals: number; tokenHash: string; ipHash: string };

/** In-memory store with the same interface and semantics as mongoWaitlist(). */
function memoryStore() {
  const list = new Map<string, Entry>();
  const limits = new Map<string, number>();
  let seq = 0;
  return {
    list,
    async hit(key: string) { limits.set(key, (limits.get(key) ?? 0) + 1); return limits.get(key)!; },
    async get(id: string) { return list.get(id) ?? null; },
    async byRef(ref: string) { return [...list.values()].find(e => e.ref === ref) ?? null; },
    async byTokenHash(h: string) { return [...list.values()].find(e => e.tokenHash === h) ?? null; },
    async nextSeq() { return ++seq; },
    async insert(e: Entry) { if (list.has(e._id)) return false; list.set(e._id, { ...e }); return true; },
    async credit(id: string, bump: number) { const e = list.get(id)!; e.referrals++; e.score -= bump; },
    async ahead(score: number, s: number) { return [...list.values()].filter(e => e.score < score || (e.score === score && e.seq < s)).length; },
    async count() { return list.size; },
    async removeByTokenHash(h: string) { for (const [k, e] of list) if (e.tokenHash === h) { list.delete(k); return true; } return false; }
  };
}

async function call(store: ReturnType<typeof memoryStore>, method: string, { body, query = '', ip = '1.1.1.1' }: { body?: unknown; query?: string; ip?: string } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as any;
  req.method = method;
  req.url = `/api/waitlist${query}`;
  req.headers = { 'x-real-ip': ip };
  let status = 0;
  let text = '';
  const res: any = { setHeader() {}, set statusCode(v: number) { status = v; }, end(t?: string) { text = t ?? ''; } };
  await handle(req, res, async () => store);
  return { status, body: text ? JSON.parse(text) : undefined };
}

process.env.MONGODB_URI ||= 'mongodb://test-only';

test('join, see your spot, and leave', async () => {
  const store = memoryStore();
  const a = await call(store, 'POST', { body: { email: 'Ada@Example.com', agent: 'my research agent' } });
  assert.equal(a.status, 201);
  assert.equal(a.body.position, 1);
  assert.match(a.body.token, /^wl_/);
  assert.match(a.body.shareUrl, /\?ref=[a-z0-9]{8}#social$/);
  assert.equal(store.list.get('ada@example.com')?.email, 'Ada@Example.com');
  assert.ok(![...store.list.values()].some(e => JSON.stringify(e).includes(a.body.token)), 'the token itself is never stored');

  // The same email (any case) joins once, and never gets the token again.
  const again = await call(store, 'POST', { body: { email: 'ada@example.com' } });
  assert.equal(again.status, 200);
  assert.equal(again.body.created, false);
  assert.equal(again.body.token, undefined);

  const spot = await call(store, 'GET', { query: `?token=${a.body.token}` });
  assert.equal(spot.body.position, 1);
  assert.equal((await call(store, 'DELETE', { query: `?token=${a.body.token}` })).body.removed, true);
  assert.equal((await call(store, 'GET', { query: `?token=${a.body.token}` })).status, 404);
});

test('each friend who joins through your link moves you up, but not from your own network', async () => {
  const store = memoryStore();
  const first = await call(store, 'POST', { body: { email: 'first@example.com' }, ip: '10.0.0.1' });
  const others = [];
  for (let i = 0; i < 6; i++) others.push(await call(store, 'POST', { body: { email: `o${i}@example.com` }, ip: `10.0.1.${i}` }));
  const late = others[5];
  assert.equal(late.body.position, 7);

  const ref = new URL(late.body.shareUrl).searchParams.get('ref');
  // Self-referral from the same network doesn't count.
  await call(store, 'POST', { body: { email: 'sock@example.com', ref }, ip: '10.0.1.5' });
  assert.equal((await call(store, 'GET', { query: `?token=${late.body.token}`, ip: '10.0.1.5' })).body.referrals, 0);

  await call(store, 'POST', { body: { email: 'friend@example.com', ref }, ip: '172.16.0.9' });
  const after = await call(store, 'GET', { query: `?token=${late.body.token}`, ip: '10.0.1.5' });
  assert.equal(after.body.referrals, 1);
  assert.equal(after.body.position, 7 - BUMP, `moved up ${BUMP} places`);
  assert.equal((await call(store, 'GET', { query: `?token=${first.body.token}`, ip: '10.0.0.1' })).body.position, 1);
});

test('bad input, bots and floods are turned away', async () => {
  const store = memoryStore();
  assert.equal((await call(store, 'POST', { body: { email: 'not-an-email' } })).status, 400);
  const bot = await call(store, 'POST', { body: { email: 'bot@example.com', website: 'http://spam' } });
  assert.equal(bot.status, 201);
  assert.equal(store.list.size, 0, 'the honeypot stores nothing');
  for (let i = 0; i < 5; i++) assert.equal((await call(store, 'POST', { body: { email: `u${i}@example.com` }, ip: '9.9.9.9' })).status, 201);
  assert.equal((await call(store, 'POST', { body: { email: 'u6@example.com' }, ip: '9.9.9.9' })).status, 429);
  assert.equal((await call(store, 'GET', { query: '?token=nope' })).status, 400);
  assert.equal((await call(store, 'PUT')).status, 405);
  assert.equal(normalizeEmail('a@b.co'), 'a@b.co');
  assert.equal(normalizeEmail('a@b'), undefined);
});

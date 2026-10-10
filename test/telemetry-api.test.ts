import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
// @ts-ignore: plain JS Vercel functions
import { handle as ping } from '../api/ping.js';
// @ts-ignore
import { handle as usage } from '../api/usage.js';
// @ts-ignore
import { parsePing, countryOf, readUsage, recordPing } from '../api/_telemetry.js';

/** In-memory store with the same interface and semantics as mongoStore() in api/_telemetry.js. */
function memoryStore() {
  const limits = new Map<string, number>();
  const pings = new Map<string, { hub: string; country: string; day: Date }>();
  return {
    pings,
    limits,
    async hit(key: string) {
      limits.set(key, (limits.get(key) ?? 0) + 1);
      return limits.get(key)!;
    },
    async addPing(doc: { hub: string; country: string; day: Date }) {
      const _id = `${doc.hub}:${doc.day.toISOString().slice(0, 10)}`;
      if (!pings.has(_id)) pings.set(_id, doc);  // $setOnInsert
    },
    async usage(since: Date) {
      const recent = [...pings.values()].filter(p => p.day >= since);
      const byCountry: Record<string, Set<string>> = {};
      for (const p of recent) (byCountry[p.country] ??= new Set()).add(p.hub);
      return {
        total: new Set(recent.map(p => p.hub)).size,
        countries: Object.fromEntries(Object.entries(byCountry).map(([c, s]) => [c, s.size]))
      };
    }
  };
}

function request(method: string, body: string, headers: Record<string, string> = {}) {
  const req: any = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.headers = headers;
  return req;
}

function response() {
  const res: any = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; };
  res.end = (b?: string) => { res.body = b ?? ''; res.ended = true; };
  return res;
}

let store = memoryStore();

async function call(handler: any, method: string, body = '', headers: Record<string, string> = {}) {
  const res = response();
  await handler(request(method, body, headers), res, async () => store);
  return res;
}

const id = (n: number) => n.toString(16).padStart(32, '0');
const body = (n: number) => JSON.stringify({ id: id(n), v: '2.1.0', kind: 'hub' });

/** Runs with MONGODB_URI set (never connected: the memory store is injected). */
function withStore(fn: (s: ReturnType<typeof memoryStore>) => Promise<void>) {
  return async () => {
    store = memoryStore();
    const saved = process.env.MONGODB_URI;
    process.env.MONGODB_URI = 'mongodb://unused.invalid';
    try {
      await fn(store);
    } finally {
      if (saved === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = saved;
    }
  };
}

test('parsePing accepts exactly the contract', () => {
  assert.deepEqual(parsePing(body(1)), { id: id(1), v: '2.1.0', kind: 'hub' });
  assert.equal(typeof parsePing('{'), 'string');
  assert.equal(typeof parsePing(JSON.stringify({ id: id(1), v: '2.1.0', kind: 'hub', host: 'x' })), 'string');
  assert.equal(typeof parsePing(JSON.stringify({ id: 'ABC', v: '2.1.0', kind: 'hub' })), 'string');
  assert.equal(typeof parsePing(JSON.stringify({ id: id(1), v: 'latest', kind: 'hub' })), 'string');
  assert.equal(typeof parsePing(JSON.stringify({ id: id(1), v: '2.1.0', kind: 'agent' })), 'string');
  assert.equal(countryOf({ 'x-vercel-ip-country': 'de' }), 'DE');
  assert.equal(countryOf({}), 'XX');
});

test('without storage, ping is 503 and usage reports an empty, unconfigured map', async () => {
  delete process.env.MONGODB_URI;
  assert.equal((await call(ping, 'POST', body(1))).statusCode, 503);
  const res = await call(usage, 'GET');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { configured: false, windowDays: 30, total: 0, countries: {} });
});

test('ping rejects bad methods and bodies', withStore(async () => {
  assert.equal((await call(ping, 'GET')).statusCode, 405);
  assert.equal((await call(ping, 'POST', 'x'.repeat(257))).statusCode, 413);
  assert.equal((await call(ping, 'POST', '{"id":"nope"}')).statusCode, 400);
}));

test('distinct hubs are counted per country; repeats and raw ids/IPs are not stored', withStore(async mem => {
  const geo = (cc: string, ip: string) => ({ 'x-vercel-ip-country': cc, 'x-real-ip': ip });
  for (const [n, cc, ip] of [[1, 'US', '1.1.1.1'], [2, 'US', '2.2.2.2'], [1, 'US', '1.1.1.1'], [3, 'NG', '3.3.3.3'], [4, '', '4.4.4.4']] as const) {
    assert.equal((await call(ping, 'POST', body(n), geo(cc, ip))).statusCode, 204);
  }
  const res = await call(usage, 'GET');
  assert.equal(res.headers['cache-control'], 'public, s-maxage=600, stale-while-revalidate=3600');
  assert.deepEqual(JSON.parse(res.body), { configured: true, windowDays: 30, total: 4, countries: { NG: 1, US: 2 } });

  const stored = JSON.stringify([...mem.pings, ...mem.limits]);
  assert.ok(!stored.includes(id(1)) && !stored.includes('1.1.1.1'), 'no raw id or IP in storage');
}));

test('ping is rate limited per IP', withStore(async () => {
  const headers = { 'x-vercel-ip-country': 'FR', 'x-real-ip': '9.9.9.9' };
  for (let i = 0; i < 20; i++) assert.equal((await call(ping, 'POST', body(100 + i), headers)).statusCode, 204);
  assert.equal((await call(ping, 'POST', body(200), headers)).statusCode, 429);
  assert.equal((await call(ping, 'POST', body(201), { ...headers, 'x-real-ip': '8.8.8.8' })).statusCode, 204);
}));

test('the 30-day window drops older pings', async () => {
  const mem = memoryStore();
  const day = 86400_000, now = Date.UTC(2026, 9, 10, 12);
  await recordPing(mem, { id: id(1), country: 'JP', ip: 'a', time: now - 29 * day });
  await recordPing(mem, { id: id(2), country: 'JP', ip: 'b', time: now - 30 * day });
  await recordPing(mem, { id: id(1), country: 'JP', ip: 'a', time: now });
  assert.deepEqual(await readUsage(mem, { time: now }), { windowDays: 30, total: 1, countries: { JP: 1 } });
});

test('storage failures are reported by category, never by message', async () => {
  const { storageFailure } = await import('../api/_telemetry.js');
  assert.equal(storageFailure({ name: 'MongoServerSelectionError', message: 'mongodb+srv://u:p@h' }), 'cluster unreachable');
  assert.equal(storageFailure({ name: 'MongoParseError' }), 'bad connection string');
  assert.equal(storageFailure({ name: 'MongoServerError', code: 18, codeName: 'AuthenticationFailed' }), 'authentication failed');
  assert.equal(storageFailure({ name: 'Error', code: 'ERR_MODULE_NOT_FOUND' }), 'driver missing');
  assert.equal(storageFailure(new Error('boom')), 'other');
});

import test from 'node:test';
// Most tests ping each hub once; the 2-day rule has its own test below.
process.env.USAGE_MIN_DAYS = '1';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
// @ts-ignore: plain JS Vercel functions
import { handle as ping } from '../api/ping.js';
// @ts-ignore
import { handle as usage } from '../api/usage.js';
// @ts-ignore
import { cellOf, parsePing, countryOf, readUsage, recordPing } from '../api/_telemetry.js';

/** In-memory store with the same interface and semantics as mongoStore() in api/_telemetry.js. */
function memoryStore() {
  const limits = new Map<string, number>();
  const pings = new Map<string, { hub: string; country: string; cell?: string; day: Date }>();
  return {
    pings,
    limits,
    async hit(key: string) {
      limits.set(key, (limits.get(key) ?? 0) + 1);
      return limits.get(key)!;
    },
    async addPing(doc: { hub: string; country: string; cell?: string; day: Date }) {
      const _id = `${doc.hub}:${doc.day.toISOString().slice(0, 10)}`;
      if (!pings.has(_id)) pings.set(_id, doc.cell ? doc : { hub: doc.hub, country: doc.country, day: doc.day });  // $setOnInsert
    },
    async usage(since: Date, minDays = 1) {
      // Same rule as the Mongo store: a hub counts if it checked in on minDays days; its latest place wins.
      const inWindow = [...pings.values()].filter(p => p.day >= since).sort((a, b) => +a.day - +b.day);
      const days: Record<string, number> = {};
      const latest: Record<string, any> = {};
      for (const p of inWindow) { days[p.hub] = (days[p.hub] ?? 0) + 1; latest[p.hub] = p; }
      const recent = Object.values(latest).filter(p => days[p.hub] >= minDays);
      const byCountry: Record<string, Set<string>> = {};
      for (const p of recent) (byCountry[p.country] ??= new Set()).add(p.hub);
      const byCell: Record<string, Set<string>> = {};
      for (const p of recent) if (p.cell) (byCell[`${p.country}|${p.cell}`] ??= new Set()).add(p.hub);
      return {
        total: new Set(recent.map(p => p.hub)).size,
        countries: Object.fromEntries(Object.entries(byCountry).map(([c, s]) => [c, s.size])),
        cells: Object.entries(byCell).map(([k, s]) => ({ country: k.split('|')[0], cell: k.split('|')[1], n: s.size }))
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
  assert.deepEqual(JSON.parse(res.body), { configured: false, windowDays: 30, total: 0, countries: {}, places: [] });
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
  assert.deepEqual(JSON.parse(res.body), { configured: true, windowDays: 30, total: 4, countries: { NG: 1, US: 2 }, places: [] });

  const stored = JSON.stringify([...mem.pings, ...mem.limits]);
  assert.ok(!stored.includes(id(1)) && !stored.includes('1.1.1.1'), 'no raw id or IP in storage');
}));

test('ping is rate limited per IP', withStore(async () => {
  const headers = { 'x-vercel-ip-country': 'FR', 'x-real-ip': '9.9.9.9' };
  for (let i = 0; i < 20; i++) assert.equal((await call(ping, 'POST', body(100 + i), headers)).statusCode, 204);
  assert.equal((await call(ping, 'POST', body(200), headers)).statusCode, 429);
  assert.equal((await call(ping, 'POST', body(201), { ...headers, 'x-real-ip': '8.8.8.8' })).statusCode, 204);
}));

test('a hub seen on only one day is not counted (throwaway containers)', async () => {
  const mem = memoryStore();
  const day = 86400_000, now = Date.UTC(2026, 9, 10, 12);
  await recordPing(mem, { id: id(1), country: 'US', ip: 'a', time: now - 3 * day });
  await recordPing(mem, { id: id(1), country: 'US', ip: 'a', time: now });
  for (let n = 2; n < 7; n++) await recordPing(mem, { id: id(n), country: 'US', ip: 'b' + n, time: now - n * day });
  assert.deepEqual(await readUsage(mem, { time: now, minDays: 2 }), { windowDays: 30, total: 1, countries: { US: 1 }, places: [] });
  assert.equal((await readUsage(mem, { time: now, minDays: 1 })).total, 6);
});

test('the 30-day window drops older pings', async () => {
  const mem = memoryStore();
  const day = 86400_000, now = Date.UTC(2026, 9, 10, 12);
  await recordPing(mem, { id: id(1), country: 'JP', ip: 'a', time: now - 29 * day });
  await recordPing(mem, { id: id(2), country: 'JP', ip: 'b', time: now - 30 * day });
  await recordPing(mem, { id: id(1), country: 'JP', ip: 'a', time: now });
  assert.deepEqual(await readUsage(mem, { time: now, minDays: 1 }), { windowDays: 30, total: 1, countries: { JP: 1 }, places: [] });
});

test('storage failures are reported by category, never by message', async () => {
  const { storageFailure } = await import('../api/_telemetry.js');
  assert.equal(storageFailure({ name: 'MongoServerSelectionError', message: 'mongodb+srv://u:p@h' }), 'cluster unreachable');
  assert.equal(storageFailure({ name: 'MongoParseError' }), 'bad connection string');
  assert.equal(storageFailure({ name: 'MongoServerError', code: 18, codeName: 'AuthenticationFailed' }), 'authentication failed');
  assert.equal(storageFailure({ name: 'Error', code: 'ERR_MODULE_NOT_FOUND' }), 'driver missing');
  assert.equal(storageFailure({ code: 'ERR_MODULE_NOT_FOUND', message: "Cannot find package 'mongodb' imported from /var/task/api/_telemetry.js" }), 'driver missing: mongodb');
  assert.equal(storageFailure(new Error('boom')), 'other');
});

test('cellOf rounds Vercel\'s location to the centre of a 1° cell, and ignores junk', () => {
  assert.equal(cellOf({ 'x-vercel-ip-latitude': '37.7749', 'x-vercel-ip-longitude': '-122.4194' }), '37.5,-122.5');
  assert.equal(cellOf({ 'x-vercel-ip-latitude': '-33.87', 'x-vercel-ip-longitude': '151.21' }), '-33.5,151.5');
  assert.equal(cellOf({ 'x-vercel-ip-latitude': '90', 'x-vercel-ip-longitude': '180' }), '89.5,179.5');
  assert.equal(cellOf({}), undefined);
  assert.equal(cellOf({ 'x-vercel-ip-latitude': 'abc', 'x-vercel-ip-longitude': '1' }), undefined);
  assert.equal(cellOf({ 'x-vercel-ip-latitude': '95', 'x-vercel-ip-longitude': '1' }), undefined);
});

test('places: under 20 hubs every cell is shown, at its centre; the precise point is never stored', withStore(async mem => {
  const at = (ip: string, lat: string, lon: string) => ({ 'x-vercel-ip-country': 'US', 'x-real-ip': ip, 'x-vercel-ip-latitude': lat, 'x-vercel-ip-longitude': lon });
  // Three hubs around San Francisco, two around New York, one in Texas, one with no location.
  const sf = [['37.77', '-122.41'], ['37.33', '-122.03'], ['37.87', '-122.27']];
  for (const [i, [lat, lon]] of sf.entries()) await call(ping, 'POST', body(10 + i), at(`1.0.0.${i}`, lat, lon));
  await call(ping, 'POST', body(20), at('2.0.0.1', '40.71', '-74.0'));
  await call(ping, 'POST', body(21), at('2.0.0.2', '40.73', '-73.99'));
  await call(ping, 'POST', body(30), at('3.0.0.1', '30.27', '-97.74'));
  await call(ping, 'POST', body(40), { 'x-vercel-ip-country': 'US', 'x-real-ip': '4.0.0.1' });

  const res = JSON.parse((await call(usage, 'GET')).body);
  assert.deepEqual(res.countries, { US: 7 });
  assert.deepEqual(res.places, [
    { country: 'US', lat: 37.5, lon: -122.5, n: 3 },
    { country: 'US', lat: 40.5, lon: -73.5, n: 2 },
    { country: 'US', lat: 30.5, lon: -97.5, n: 1 }
  ]);
  const stored = JSON.stringify([...mem.pings.values()]);
  assert.ok(!stored.includes('37.77') && !stored.includes('-122.41'), 'only the cell is stored, not the point');
}));

test('places: from 20 hubs on, only cells with 3+ hubs are shown', async () => {
  const mem = { pings: [] as any[], hit: async () => 1, addPing: async () => {},
    usage: async () => ({ total: 20, countries: { US: 20 }, cells: [
      { country: 'US', cell: '37.5,-122.5', n: 3 }, { country: 'US', cell: '40.5,-73.5', n: 2 }, { country: 'US', cell: '30.5,-97.5', n: 1 }
    ] }) };
  const out = await readUsage(mem);
  assert.deepEqual(out.places, [{ country: 'US', lat: 37.5, lon: -122.5, n: 3 }]);
});

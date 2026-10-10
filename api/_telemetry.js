// Shared helpers for the opt-in hub check-in (api/ping.js) and the usage
// globe (api/usage.js). Files starting with "_" are not deployed as routes.
//
// Storage is MongoDB, connected through MONGODB_URI only (set in Vercel). The
// `mongodb` driver is installed by the Vercel install command, not by the
// package, so it is imported lazily. Install ids and IPs are stored only as
// salted hashes; ping docs and rate-limit counters expire on their own.

import { createHmac } from 'node:crypto';

export const WINDOW_DAYS = 30;
const KEEP_DAYS = WINDOW_DAYS + 5;

export function storeConfigured(env = process.env) {
  return Boolean(env.MONGODB_URI);
}

/**
 * Keyed hash (HMAC-SHA-256), shortened. Used for ids and IPs so neither is
 * stored raw. The key must be secret: with a public key, the ~4 billion IPv4
 * addresses could be hashed in bulk and matched. TELEMETRY_SALT if set,
 * otherwise the (secret) MONGODB_URI.
 */
export function digest(value, env = process.env) {
  const key = env.TELEMETRY_SALT || env.MONGODB_URI || 'crosstalk-dev';
  return createHmac('sha256', key).update(value).digest('hex').slice(0, 32);
}

export function utcDay(time = Date.now()) {
  const d = new Date(time);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Validates a check-in body: exactly {"id":"<32 hex>","v":"<version>","kind":"hub"}.
 * Returns the parsed ping or a string saying what is wrong.
 */
export function parsePing(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return 'body is not JSON';
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be an object';
  const keys = Object.keys(body).sort().join(',');
  if (keys !== 'id,kind,v') return 'body must have exactly id, v and kind';
  if (typeof body.id !== 'string' || !/^[0-9a-f]{32}$/.test(body.id)) return 'id must be 32 lowercase hex characters';
  if (typeof body.v !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,20})?$/.test(body.v)) return 'v must be a version';
  if (body.kind !== 'hub') return 'kind must be "hub"';
  return body;
}

/** ISO 3166-1 alpha-2 from Vercel's geo header, or "XX" when unknown. */
export function countryOf(headers) {
  const raw = String(headers['x-vercel-ip-country'] ?? '').toUpperCase();
  return /^[A-Z]{2}$/.test(raw) ? raw : 'XX';
}

// ---------------------------------------------------------------------------
// MongoDB store. Collections:
//   pings      { _id: "<hub hash>:<YYYY-MM-DD>", hub, country, day }   TTL on day
//   ratelimits { _id: "<ip hash>:<hour>", n, at }                       TTL on at
// ---------------------------------------------------------------------------

let cached;

/** One client per function instance, reused across invocations. */
export function mongoStore(env = process.env) {
  if (!cached) {
    cached = (async () => {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 5000 });
      await client.connect();
      const db = client.db(env.MONGODB_DB || 'crosstalk');
      const pings = db.collection('pings');
      const limits = db.collection('ratelimits');
      await Promise.all([
        pings.createIndex({ day: 1 }, { expireAfterSeconds: KEEP_DAYS * 86400 }),
        limits.createIndex({ at: 1 }, { expireAfterSeconds: 2 * 3600 })
      ]);
      return {
        async hit(key) {
          const doc = await limits.findOneAndUpdate(
            { _id: key },
            { $inc: { n: 1 }, $setOnInsert: { at: new Date() } },
            { upsert: true, returnDocument: 'after' }
          );
          return doc?.n ?? 1;
        },
        async addPing({ hub, country, day }) {
          await pings.updateOne(
            { _id: `${hub}:${day.toISOString().slice(0, 10)}` },
            { $setOnInsert: { hub, country, day } },
            { upsert: true }
          );
        },
        async usage(since) {
          const [facets] = await pings.aggregate([
            { $match: { day: { $gte: since } } },
            { $facet: {
              total: [{ $group: { _id: '$hub' } }, { $count: 'n' }],
              countries: [
                { $group: { _id: { country: '$country', hub: '$hub' } } },
                { $group: { _id: '$_id.country', n: { $sum: 1 } } }
              ]
            } }
          ]).toArray();
          return {
            total: facets.total[0]?.n ?? 0,
            countries: Object.fromEntries(facets.countries.map(c => [c._id, c.n]))
          };
        }
      };
    })().catch(err => {
      cached = undefined;  // retry the connection on the next request
      throw err;
    });
  }
  return cached;
}

// ---------------------------------------------------------------------------
// Operations, written against the store interface so tests can swap it out.
// ---------------------------------------------------------------------------

/** Records one check-in. Returns false when the IP is over its rate limit. */
export async function recordPing(store, { id, country, ip, time = Date.now(), limitPerHour = 20, env = process.env }) {
  const n = await store.hit(`${digest(`ip:${ip}`, env)}:${Math.floor(time / 3600_000)}`);
  if (n > limitPerHour) return false;
  await store.addPing({ hub: digest(`id:${id}`, env), country, day: utcDay(time) });
  return true;
}

/** Distinct hubs per country over the last WINDOW_DAYS days (today included). */
export async function readUsage(store, { time = Date.now() } = {}) {
  const since = new Date(utcDay(time).getTime() - (WINDOW_DAYS - 1) * 86400_000);
  const { total, countries } = await store.usage(since);
  delete countries.XX;
  return { windowDays: WINDOW_DAYS, total, countries };
}

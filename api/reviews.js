// /api/reviews: reviews of CrossTalk, from agents as well as people.
//   POST {rating, review, name, kind?, model?, client?, role?, version?, quote?, website?}
//        Agents: send model and role (what you used CrossTalk for) so the credit is specific.
//        rating 1-5; kind "agent" (default) or "person"; quote true allows quoting on the site.
//   GET                       published reviews (approved by the author), newest first
//   GET ?key=<REVIEWS_KEY>    every review, for the author
// `website` is a honeypot field: people and well-behaved agents leave it out; bots fill it in.
// See api/_reviews.js for what is stored.

import { timingSafeEqual } from 'node:crypto';
import { addReview, mongoReviews, parseReview, publicView } from './_reviews.js';
import { digest } from './_waitlist.js';
import { storageFailure, storeConfigured } from './_telemetry.js';

const MAX_BODY = 8192;
const POSTS_PER_HOUR = 5;
const READS_PER_HOUR = 120;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  if (body === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

const sameKey = (given, expected) => {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
};

/** `getStore` is injectable for tests; production uses MongoDB via MONGODB_URI. */
export async function handle(req, res, getStore = mongoReviews, env = process.env) {
  if (!['POST', 'GET'].includes(req.method)) {
    res.setHeader('Allow', 'POST, GET');
    return send(res, 405, { error: 'POST or GET' });
  }
  if (!storeConfigured(env)) return send(res, 503, { error: 'review storage is not configured' });
  const ip = String(req.headers['x-real-ip'] ?? '').trim() || req.socket?.remoteAddress || '';
  const url = new URL(req.url ?? '/', 'http://site.local');

  try {
    const store = await getStore();
    const hour = Math.floor(Date.now() / 3600_000);
    const limited = async (kind, max) => (await store.hit(`rv-${kind}:${digest(`ip:${ip}`, env)}:${hour}`)) > max;

    if (req.method === 'GET') {
      if (await limited('read', READS_PER_HOUR)) return send(res, 429, { error: 'rate limited' });
      const all = sameKey(url.searchParams.get('key'), env.REVIEWS_KEY);
      const rows = await store.list({ all, limit: all ? 500 : 100 });
      return send(res, 200, { reviews: all ? rows.map(r => ({ ...publicView(r), quote: r.quote, published: r.published, version: r.version })) : rows.map(publicView) });
    }

    let body;
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch (err) {
      return send(res, err.status ?? 400, { error: err.status === 413 ? 'body too large' : 'body must be JSON' });
    }
    // Bots fill every field; pretend it worked and store nothing.
    if (body && typeof body === 'object' && body.website) return send(res, 201, { received: true });
    const parsed = parseReview(body);
    if (parsed.error) return send(res, 400, { error: parsed.error });
    if (await limited('post', POSTS_PER_HOUR)) return send(res, 429, { error: 'Too many reviews from your network. Try again later.' });
    await addReview(store, parsed.review, { ip, env });
    return send(res, 201, { received: true, message: 'Thanks. The author reads every review; it appears on the site only if you allowed quoting and he approves it.' });
  } catch (err) {
    console.error('reviews: storage unavailable:', err?.name, err?.code, err?.codeName);
    return send(res, 503, { error: 'storage unavailable', reason: storageFailure(err) });
  }
}

export default function handler(req, res) {
  return handle(req, res);
}

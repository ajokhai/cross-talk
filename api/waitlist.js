// /api/waitlist: the CrossTalk Social waitlist (issue #14).
//   POST   {email, agent?, ref?, website?}  join; returns your spot, share link and a private token
//   GET    ?token=wl_…                      your spot
//   DELETE ?token=wl_…                      take yourself off the list
// `website` is a honeypot field: people never fill it in; bots do.
// See api/_waitlist.js for what is stored.

import { join, leave, lookup, mongoWaitlist, normalizeEmail, validRef, validToken, digest } from './_waitlist.js';
import { storageFailure, storeConfigured } from './_telemetry.js';

const MAX_BODY = 2048;
const JOINS_PER_HOUR = 5;
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

/** `getStore` is injectable for tests; production uses MongoDB via MONGODB_URI. */
export async function handle(req, res, getStore = mongoWaitlist) {
  if (!['POST', 'GET', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'POST, GET, DELETE');
    return send(res, 405, { error: 'POST, GET or DELETE' });
  }
  if (!storeConfigured()) return send(res, 503, { error: 'waitlist storage is not configured' });
  const ip = String(req.headers['x-real-ip'] ?? '').trim() || req.socket?.remoteAddress || '';
  const url = new URL(req.url ?? '/', 'http://site.local');

  try {
    const store = await getStore();
    const hour = Math.floor(Date.now() / 3600_000);
    const limited = async (kind, max) => (await store.hit(`wl-${kind}:${digest(`ip:${ip}`)}:${hour}`)) > max;

    if (req.method === 'POST') {
      let body;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch (err) {
        return send(res, err.status ?? 400, { error: err.status === 413 ? 'body too large' : 'body must be JSON' });
      }
      if (typeof body !== 'object' || body === null) return send(res, 400, { error: 'body must be a JSON object' });
      // Bots fill every field; pretend it worked and store nothing.
      if (body.website) return send(res, 201, { created: true });
      const email = normalizeEmail(body.email);
      if (!email) return send(res, 400, { error: 'Please enter a valid email address.' });
      if (await limited('join', JOINS_PER_HOUR)) return send(res, 429, { error: 'Too many signups from your network. Try again later.' });
      const result = await join(store, { email, agent: body.agent, ref: validRef(body.ref), ip });
      return result.created ? send(res, 201, result) : send(res, 200, { created: false, message: "You're already on the list. Use the private link from when you joined to see your spot." });
    }

    const token = validToken(url.searchParams.get('token'));
    if (!token) return send(res, 400, { error: 'token is required' });
    if (await limited('read', READS_PER_HOUR)) return send(res, 429, { error: 'rate limited' });
    if (req.method === 'GET') {
      const status = await lookup(store, token);
      return status ? send(res, 200, status) : send(res, 404, { error: 'Not on the list (or already removed).' });
    }
    return (await leave(store, token)) ? send(res, 200, { removed: true }) : send(res, 404, { error: 'Not on the list (or already removed).' });
  } catch (err) {
    console.error('waitlist: storage unavailable:', err?.name, err?.code, err?.codeName);
    return send(res, 503, { error: 'storage unavailable', reason: storageFailure(err) });
  }
}

export default function handler(req, res) {
  return handle(req, res);
}

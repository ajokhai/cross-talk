// POST /api/ping: anonymous daily check-in from a CrossTalk hub (on unless CROSSTALK_TELEMETRY=0).
// Body: {"id":"<32 hex>","v":"<version>","kind":"hub"}, at most 256 bytes.
// The country comes from Vercel's geo header. The IP and the id are stored only
// as salted hashes, and both expire (rate limits after 2h, pings after 35 days).

import { countryOf, mongoStore, parsePing, recordPing, storageFailure, storeConfigured } from './_telemetry.js';

const MAX_BODY = 256;

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

/** `store` is injectable for tests; production uses MongoDB via MONGODB_URI. */
export async function handle(req, res, getStore = mongoStore) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'POST only' });
  }
  if (!storeConfigured()) return send(res, 503, { error: 'telemetry storage is not configured' });

  let text;
  try {
    text = await readBody(req);
  } catch (err) {
    return send(res, err.status ?? 400, { error: err.status === 413 ? `body over ${MAX_BODY} bytes` : 'bad body' });
  }
  const ping = parsePing(text);
  if (typeof ping === 'string') return send(res, 400, { error: ping });

  // Vercel sets x-real-ip to the connecting client; unlike the first
  // x-forwarded-for entry, a caller can't choose it.
  const ip = String(req.headers['x-real-ip'] ?? '').trim() || req.socket?.remoteAddress || '';
  try {
    const accepted = await recordPing(await getStore(), { id: ping.id, country: countryOf(req.headers), ip });
    return accepted ? send(res, 204) : send(res, 429, { error: 'rate limited' });
  } catch (err) {
    // Never err.message: driver messages can embed the URI's user or host.
    console.error('ping: storage unavailable:', err?.name, err?.code, err?.codeName);
    return send(res, 503, { error: 'storage unavailable', reason: storageFailure(err) });
  }
}

export default function handler(req, res) {
  return handle(req, res);
}

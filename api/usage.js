// GET /api/usage: distinct opted-in hubs per country over the last 30 days,
// for the globe on the landing page.
// {"configured":true,"windowDays":30,"total":N,"countries":{"US":12,...}}

import { WINDOW_DAYS, mongoStore, readUsage, storageFailure, storeConfigured } from './_telemetry.js';

/** `store` is injectable for tests; production uses MongoDB via MONGODB_URI. */
export async function handle(req, res, getStore = mongoStore) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end();
  }
  let body;
  if (!storeConfigured()) {
    body = { configured: false, windowDays: WINDOW_DAYS, total: 0, countries: {} };
  } else {
    try {
      body = { configured: true, ...(await readUsage(await getStore())) };
    } catch (err) {
      // Never err.message: driver messages can embed the URI's user or host.
      console.error('usage: storage unavailable:', err?.name, err?.code, err?.codeName);
      res.statusCode = 503;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'storage unavailable', reason: storageFailure(err) }));
    }
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
  res.end(JSON.stringify(body));
}

export default function handler(req, res) {
  return handle(req, res);
}

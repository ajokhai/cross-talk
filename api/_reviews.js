// Reviews of CrossTalk from agents and people: helpers and storage for api/reviews.js.
// Files starting with "_" are not deployed as routes.
//
// What is stored, per review (collection `reviews`, same MongoDB as telemetry):
//   at         when it was sent
//   kind       "agent" or "person"
//   rating     1-5
//   review     the text, <= 2000 chars
//   name       who wrote it (an agent name or a person's name), <= 80 chars
//   model      optional, e.g. "Claude Opus 5.5" or "Gemini 3 Pro", <= 80 chars
//   client     optional, e.g. "Claude Code", "Gemini CLI", "crosstalk cli", <= 80 chars
//   role       optional, what the reviewer used CrossTalk for, e.g. "building a Shopify store with Gemini", <= 120 chars
//   tag        optional 6-hex tag of the sending install (one-way hash; from the CLI/MCP), so
//              same-named agents on different machines can be told apart
//   version    optional CrossTalk version the agent used, <= 20 chars
//   quote      true when the writer allows quoting it on the site, with the name
//   published  false until the author approves it for the site
//   ipHash     HMAC of the sender's IP, only for rate limiting and spotting floods
// Nothing is published automatically. GET /api/reviews returns only published
// reviews; GET with ?key=$REVIEWS_KEY returns everything, newest first.

import { digest } from './_waitlist.js';

export const MAX_REVIEW_CHARS = 2000;
export const MAX_FIELD_CHARS = 80;

const clean = (value, max) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** The review to store, or an error message for the sender. */
export function parseReview(body) {
  if (typeof body !== 'object' || body === null) return { error: 'body must be a JSON object' };
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: 'rating must be a whole number from 1 to 5' };
  const review = typeof body.review === 'string' ? body.review.replace(/\r\n/g, '\n').trim() : '';
  if (review.length < 10) return { error: 'review must be at least 10 characters: say what you used CrossTalk for and how it went' };
  if (review.length > MAX_REVIEW_CHARS) return { error: `review must be at most ${MAX_REVIEW_CHARS} characters` };
  const name = clean(body.name, MAX_FIELD_CHARS);
  if (!name) return { error: 'name is required (your agent name, or your own name)' };
  const kind = body.kind === 'person' ? 'person' : 'agent';
  return {
    review: {
      kind,
      rating,
      review,
      name,
      model: clean(body.model, MAX_FIELD_CHARS) || undefined,
      client: clean(body.client, MAX_FIELD_CHARS) || undefined,
      role: clean(body.role, 120) || undefined,
      tag: typeof body.tag === 'string' && /^[0-9a-f]{6}$/.test(body.tag) ? body.tag : undefined,
      version: clean(body.version, 20) || undefined,
      quote: body.quote === true
    }
  };
}

/** How a review is credited on the site: name · model in client · role. Specific, never just "Claude agent". */
export function byline(r) {
  const runs = [r.model, r.client && r.client !== 'crosstalk cli' && r.client !== 'crosstalk-mcp' ? r.client : ''].filter(Boolean).join(' in ');
  return [r.tag ? `${r.name} #${r.tag}` : r.name, runs, r.role].filter(Boolean).join(' · ');
}

/** What a published review looks like to the public: no IP hash, no internal flags. */
export const publicView = r => ({
  at: new Date(r.at).toISOString(),
  kind: r.kind,
  rating: r.rating,
  review: r.review,
  name: r.name,
  ...(r.model ? { model: r.model } : {}),
  ...(r.client ? { client: r.client } : {}),
  ...(r.role ? { role: r.role } : {}),
  ...(r.tag ? { tag: r.tag } : {}),
  byline: byline(r)
});

export async function addReview(store, review, { ip, time = Date.now(), env = process.env }) {
  await store.insert({ ...review, at: new Date(time), published: false, ipHash: digest(`ip:${ip}`, env) });
}

// ---------------------------------------------------------------------------

let cached;

export function mongoReviews(env = process.env) {
  if (!cached) {
    cached = (async () => {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 5000 });
      await client.connect();
      const db = client.db(env.MONGODB_DB || 'crosstalk');
      const reviews = db.collection('reviews');
      const limits = db.collection('ratelimits');
      await Promise.all([
        reviews.createIndex({ published: 1, at: -1 }),
        limits.createIndex({ at: 1 }, { expireAfterSeconds: 2 * 3600 })
      ]);
      return {
        async hit(key) {
          const doc = await limits.findOneAndUpdate({ _id: key }, { $inc: { n: 1 }, $setOnInsert: { at: new Date() } }, { upsert: true, returnDocument: 'after' });
          return doc?.n ?? 1;
        },
        insert: review => reviews.insertOne(review),
        list: ({ all, limit }) => reviews.find(all ? {} : { published: true }).sort({ at: -1 }).limit(limit).toArray()
      };
    })().catch(err => {
      cached = undefined;
      throw err;
    });
  }
  return cached;
}

// CrossTalk Social waitlist (issue #14): helpers and storage for api/waitlist.js.
// Files starting with "_" are not deployed as routes.
//
// What is stored, per person (collection `waitlist`, same MongoDB as telemetry):
//   _id         the email, lowercased (so each email joins once)
//   email       as typed, so we can tell them when Social opens
//   agent       optional "what agent or platform would you connect", <= 120 chars
//   at          signup time
//   seq         signup order (1, 2, 3, ...)
//   score       10*seq - (10*BUMP + 5) per referral; lower is earlier in line (the +5 lands a
//               bumped person between places, so moving up 5 passes 5 people)
//   ref         public referral code for their share link
//   referredBy  the code they signed up through, if any
//   referrals   how many people joined through their link (and counted)
//   tokenHash   hash of their private status/removal token (the token is shown once)
//   ipHash      HMAC of their IP, only to stop self-referral
// Rate-limit counters live in `ratelimits` and expire after 2 hours.

import { createHash, createHmac, randomBytes } from 'node:crypto';

/** Places a referral moves you up. */
export const BUMP = 5;
export const MAX_AGENT_CHARS = 120;
export const SITE = 'https://cross-talk-roan.vercel.app';

export function digest(value, env = process.env) {
  const key = env.TELEMETRY_SALT || env.MONGODB_URI || 'crosstalk-dev';
  return createHmac('sha256', key).update(value).digest('hex').slice(0, 32);
}
export const hashToken = token => createHash('sha256').update(String(token)).digest('hex');

/** A plausible email, lowercased for the key; undefined when it isn't one. */
export function normalizeEmail(value) {
  if (typeof value !== 'string') return undefined;
  const email = value.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return undefined;
  return email;
}

export const cleanAgent = value =>
  typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_AGENT_CHARS) : '';

export const validRef = value => (typeof value === 'string' && /^[a-z0-9]{6,12}$/.test(value) ? value : undefined);
export const validToken = value => (typeof value === 'string' && /^wl_[A-Za-z0-9_-]{24,64}$/.test(value) ? value : undefined);

const newRef = () => randomBytes(6).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(8, '0').slice(0, 8);
const newToken = () => `wl_${randomBytes(24).toString('base64url')}`;

export const shareUrl = ref => `${SITE}/?ref=${ref}#social`;

/** What a person sees about their own spot. */
async function status(store, entry) {
  const [position, total] = await Promise.all([store.ahead(entry.score, entry.seq).then(n => n + 1), store.count()]);
  return { position, total, referrals: entry.referrals, ref: entry.ref, shareUrl: shareUrl(entry.ref), bump: BUMP };
}

/**
 * Adds someone. Returns { created: true, token, ...status } the first time,
 * { created: false } when the email is already on the list (we never re-reveal
 * a token for an email, or anyone could take over someone else's spot).
 */
export async function join(store, { email, agent, ref, ip, time = Date.now(), env = process.env }) {
  const ipHash = digest(`wl-ip:${ip}`, env);
  const key = email.toLowerCase();
  if (await store.get(key)) return { created: false };
  const token = newToken();
  const seq = await store.nextSeq();
  const entry = {
    _id: key,
    email,
    agent: cleanAgent(agent),
    at: new Date(time),
    seq,
    score: seq * 10,
    ref: newRef(),
    referrals: 0,
    tokenHash: hashToken(token),
    ipHash
  };
  const referrer = ref ? await store.byRef(ref) : undefined;
  if (referrer) entry.referredBy = referrer.ref;
  const inserted = await store.insert(entry);
  if (!inserted) return { created: false };
  // A referral counts only from another network, so nobody bumps themselves from one machine.
  if (referrer && referrer.ipHash !== ipHash) await store.credit(referrer._id, BUMP * 10 + 5);
  return { created: true, token, ...(await status(store, entry)) };
}

export async function lookup(store, token) {
  const entry = await store.byTokenHash(hashToken(token));
  return entry ? status(store, entry) : undefined;
}

export async function leave(store, token) {
  return store.removeByTokenHash(hashToken(token));
}

// ---------------------------------------------------------------------------
// MongoDB store (the interface above is what tests replace)
// ---------------------------------------------------------------------------

let cached;

export function mongoWaitlist(env = process.env) {
  if (!cached) {
    cached = (async () => {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 5000 });
      await client.connect();
      const db = client.db(env.MONGODB_DB || 'crosstalk');
      const list = db.collection('waitlist');
      const counters = db.collection('counters');
      const limits = db.collection('ratelimits');
      await Promise.all([
        list.createIndex({ tokenHash: 1 }, { unique: true }),
        list.createIndex({ ref: 1 }, { unique: true }),
        list.createIndex({ score: 1, seq: 1 }),
        limits.createIndex({ at: 1 }, { expireAfterSeconds: 2 * 3600 })
      ]);
      return {
        async hit(key) {
          const doc = await limits.findOneAndUpdate({ _id: key }, { $inc: { n: 1 }, $setOnInsert: { at: new Date() } }, { upsert: true, returnDocument: 'after' });
          return doc?.n ?? 1;
        },
        get: id => list.findOne({ _id: id }),
        byRef: ref => list.findOne({ ref }),
        byTokenHash: tokenHash => list.findOne({ tokenHash }),
        async nextSeq() {
          const doc = await counters.findOneAndUpdate({ _id: 'waitlist' }, { $inc: { n: 1 } }, { upsert: true, returnDocument: 'after' });
          return doc.n;
        },
        async insert(entry) {
          try {
            await list.insertOne(entry);
            return true;
          } catch (err) {
            if (err?.code === 11000) return false; // joined twice at once
            throw err;
          }
        },
        async credit(id, bump) {
          await list.updateOne({ _id: id }, { $inc: { referrals: 1, score: -bump } });
        },
        ahead: (score, seq) => list.countDocuments({ $or: [{ score: { $lt: score } }, { score, seq: { $lt: seq } }] }),
        count: () => list.estimatedDocumentCount(),
        async removeByTokenHash(tokenHash) {
          const res = await list.deleteOne({ tokenHash });
          return res.deletedCount === 1;
        }
      };
    })().catch(err => {
      cached = undefined;
      throw err;
    });
  }
  return cached;
}

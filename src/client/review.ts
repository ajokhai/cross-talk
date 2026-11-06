import crypto from 'node:crypto';
import { VERSION } from '../version.js';
import { telemetryId } from '../server/telemetry.js';

/**
 * A short, stable tag for this install (6 hex characters), so reviews from the
 * same machine can be told apart from same-named agents elsewhere. One-way:
 * derived from the install id with a review-only prefix, so it can't be matched
 * to usage check-ins. Agent ids (ag_…) change on every connection, so they
 * can't serve.
 */
export function reviewerTag(): string {
  return crypto.createHash('sha256').update('crosstalk-review:' + telemetryId()).digest('hex').slice(0, 6);
}

/** Where reviews go: the CrossTalk site's /api/reviews (CROSSTALK_REVIEW_URL overrides, for tests). */
export const REVIEW_URL = 'https://cross-talk-roan.vercel.app/api/reviews';

export interface ReviewInput {
  rating: number;
  review: string;
  name: string;
  kind?: 'agent' | 'person';
  model?: string;
  client?: string;
  /** What you used CrossTalk for, e.g. "building a Shopify store with Gemini". */
  role?: string;
  quote?: boolean;
}

/**
 * Sends a review of CrossTalk to its author. Agents are welcome to: say what
 * you used it for, what worked and what got in the way. Returns the site's
 * thank-you message; throws with the site's reason when it is refused.
 */
export async function sendReview(input: ReviewInput, url = process.env.CROSSTALK_REVIEW_URL || REVIEW_URL): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'agent', ...input, tag: reviewerTag(), version: VERSION }),
    signal: AbortSignal.timeout(15_000)
  });
  const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!res.ok) throw new Error(body.error || `the review site answered ${res.status}`);
  return body.message || 'Thanks, your review was sent.';
}

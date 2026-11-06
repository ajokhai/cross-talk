import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { answerReviewPrompt, countUseAndCheck, MIN_USES, QUIET_MS, SNOOZE_MS } from '../src/client/review-prompt.js';

const DAY = 86_400_000;
const env = {} as NodeJS.ProcessEnv; // reminders on, whatever the test runner sets
const fresh = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xt-rp-')), 'review-prompt.json');

/** Uses CrossTalk `n` times starting at `t`, an hour apart; returns the times the reminder showed. */
function use(file: string, t: number, n: number) {
  const shown: number[] = [];
  for (let i = 0; i < n; i++) if (countUseAndCheck(file, t + i * 3600_000, env)) shown.push(i);
  return shown;
}

test('the reminder waits for real use: 10 uses and a week', () => {
  const file = fresh();
  assert.deepEqual(use(file, 0, MIN_USES + 5), [], 'ten uses on day one: not yet');
  assert.equal(countUseAndCheck(file, 7 * DAY, env), true, 'a week in: shown once');
  assert.equal(countUseAndCheck(file, 7 * DAY + 1, env), false, 'not again right away');
  assert.equal(countUseAndCheck(file, 7 * DAY + QUIET_MS - 1, env), false, 'quiet for 30 days');
  assert.equal(countUseAndCheck(file, 7 * DAY + QUIET_MS, env), true, 'then once more');
});

test('"later" snoozes two weeks; "never" and reviewing stop it for good', () => {
  const file = fresh();
  use(file, 0, MIN_USES);
  assert.equal(countUseAndCheck(file, 8 * DAY, env), true);
  answerReviewPrompt('later', file, 8 * DAY);
  // Snooze runs out before the 30-day quiet period does, so the quiet period decides.
  assert.equal(countUseAndCheck(file, 8 * DAY + SNOOZE_MS, env), false);
  assert.equal(countUseAndCheck(file, 8 * DAY + QUIET_MS, env), true);
  answerReviewPrompt('never', file);
  assert.equal(countUseAndCheck(file, 400 * DAY, env), false);

  const reviewed = fresh();
  use(reviewed, 0, MIN_USES);
  answerReviewPrompt('reviewed', reviewed);
  assert.equal(countUseAndCheck(reviewed, 100 * DAY, env), false);
});

test('CROSSTALK_NO_REVIEW_PROMPT=1 turns it off and writes nothing', () => {
  const file = fresh();
  assert.equal(countUseAndCheck(file, 0, { CROSSTALK_NO_REVIEW_PROMPT: '1' }), false);
  assert.equal(fs.existsSync(file), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { updateCheckEnabled } from '../src/version.js';
import { telemetryEnabled } from '../src/server/telemetry.js';

// A release coming out mid-run, or a check-in to the real site, must not change what a test sees.
test('under node --test (NODE_TEST_CONTEXT) there is no update check and no telemetry, unless asked for', () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'node --test sets NODE_TEST_CONTEXT for test processes');
  assert.equal(updateCheckEnabled(), false);
  assert.equal(telemetryEnabled(), false);
  assert.equal(updateCheckEnabled({ NODE_TEST_CONTEXT: 'child-v8', CROSSTALK_UPDATE_CHECK: '1' }), true, 'explicitly on wins');
  assert.equal(telemetryEnabled(undefined, { NODE_TEST_CONTEXT: 'child-v8', CROSSTALK_TELEMETRY: '1' }), true, 'explicitly on wins');
  assert.equal(updateCheckEnabled({}), true, 'outside tests nothing changes');
  assert.equal(telemetryEnabled(undefined, {}), true);
});

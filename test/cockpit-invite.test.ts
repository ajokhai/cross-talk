import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inviteText } from '../src/client/invite.js';

// website/cockpit.js has no imports, so it carries its own copy of the invite between two markers.
const source = fs.readFileSync(new URL('../website/cockpit.js', import.meta.url), 'utf8');
const block = /\/\/ invite:start[^\n]*\n([\s\S]*?)\n\s*\/\/ invite:end/.exec(source)?.[1];
const cockpitInvite = new Function(`${block}\nreturn inviteText;`)() as (address: string, hub: string) => string;

test("the cockpit's Copy button gives exactly the CLI's invite", () => {
  assert.ok(block, 'invite:start / invite:end markers are in website/cockpit.js');
  const address = 'xt_G0f-mX9b0ntbMNUA5az41g';
  for (const hub of ['wss://hub-production-a114.up.railway.app', 'wss://hub.example.com/', 'ws://localhost:4488', 'ws://127.0.0.1:4488', 'ws://[::1]:4488', 'ws://192.168.1.5:4488']) {
    assert.equal(cockpitInvite(address, hub), inviteText({ address, hub }), hub);
  }
});

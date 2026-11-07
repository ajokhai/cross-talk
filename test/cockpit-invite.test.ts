import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inviteText } from '../src/client/invite.js';
import { findAddress, formatAddress } from '../src/address.js';

// website/cockpit.js has no imports, so it carries its own copy of the invite and address helpers between two markers.
const source = fs.readFileSync(new URL('../website/cockpit.js', import.meta.url), 'utf8');
const block = /\/\/ invite:start[^\n]*\n([\s\S]*?)\n\s*\/\/ invite:end/.exec(source)?.[1];
const cockpit = new Function(`${block}\nreturn { inviteText, findAddress, formatAddress };`)() as {
  inviteText: (address: string, hub: string) => string;
  findAddress: (text: string) => { channel: string; hub?: string } | undefined;
  formatAddress: (channel: string, hub: string) => string;
};

const address = 'xt_G0f-mX9b0ntbMNUA5az41g';
const hubs = ['wss://hub-production-a114.up.railway.app', 'wss://hub.example.com/', 'ws://localhost:4488', 'ws://127.0.0.1:4488', 'ws://[::1]:4488', 'ws://192.168.1.5:4488', 'ws://127.0.0.1:65474', 'wss://hub.example.com:8443/ct', 'ws://hub.example.com', 'https://door.example.test'];

test("the cockpit's Copy button gives exactly the CLI's invite", () => {
  assert.ok(block, 'invite:start / invite:end markers are in website/cockpit.js');
  for (const hub of hubs) assert.equal(cockpit.inviteText(address, hub), inviteText({ address, hub }), hub);
});

test('the cockpit reads and writes addresses exactly like src/address.ts', () => {
  for (const hub of hubs) assert.equal(cockpit.formatAddress(address, hub), formatAddress(address, hub), hub);
  const pasted = [
    address, `xtl_${address.slice(3)}`, `${address}@hub.example.com`, `${address}@10.0.0.5:4488.`, `${address}@ws://box.lan:9000/x`,
    `Join my CrossTalk channel ${address}@hub.example.com. New to CrossTalk?`, `https://cross-talk-roan.vercel.app/cockpit#${address}`,
    `Join my CrossTalk channel.\nChannel: ${address}\nHub: wss://hub.example.com`, 'nothing here', `xtl_${address.slice(3)}@hub.example.com`
  ];
  for (const text of pasted) {
    const mine = findAddress(text);
    assert.deepEqual(cockpit.findAddress(text), mine && (mine.hub ? { channel: mine.channel, hub: mine.hub } : { channel: mine.channel }), text);
  }
});

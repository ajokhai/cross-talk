import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';
import { WakeSupervisor } from '../src/client/wake.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function scene(options: { graceMs?: number } = {}) {
  let skew = 0;
  const server = await startServer({ port: 0, quiet: true, hub: { now: () => Date.now() + skew } });
  const human = await CrossTalk.connect({ name: 'alice', url: server.url, reconnect: false });
  const gemini = await CrossTalk.connect({ name: 'gemini', url: server.url, reconnect: false });
  const sup = await CrossTalk.connect({ name: 'wake', url: server.url, reconnect: false });
  const ch = await human.createChannel('auth');
  const gch = await gemini.joinChannel(ch.address);
  const sch = await sup.joinChannel(ch.address);
  const prompts: string[] = [];
  const supervisor = new WakeSupervisor(sch, sup, {
    agent: 'Gemini',
    graceMs: options.graceMs ?? 100,
    cooldownMs: 0,
    adapter: async p => { prompts.push(p); }
  });
  return {
    server, ch, gch, prompts, skew: (ms: number) => (skew = ms),
    close: async () => {
      supervisor.stop();
      for (const c of [human, gemini, sup]) await c.close();
      await server.close();
    }
  };
}

test('wake: an agent that said "on it" and went quiet is woken with the message', async () => {
  const s = await scene();
  try {
    await s.gch.send('on it');
    await sleep(20);
    await s.ch.send('@gemini status? the tests are still red');
    await sleep(250);
    assert.equal(s.prompts.length, 1);
    assert.match(s.prompts[0], /alice: @gemini status\? the tests are still red/);
    assert.match(s.prompts[0], /crosstalk_wait/);
    await s.ch.refresh();
    assert.ok(s.ch.messages.some(m => /^Waking Gemini \(last read/.test(m.content)), 'the channel is told');
  } finally {
    await s.close();
  }
});

test('wake: an agent that reads within the grace period is left alone', async () => {
  const s = await scene({ graceMs: 200 });
  try {
    await s.ch.send('@gemini quick one');
    await sleep(50);
    await s.gch.markRead();
    await sleep(300);
    assert.equal(s.prompts.length, 0);
    await s.ch.send('no mention here');
    await sleep(300);
    assert.equal(s.prompts.length, 0, 'only @mentions wake by default');
  } finally {
    await s.close();
  }
});

test('wake: a stalled claim wakes its agent at once', async () => {
  const s = await scene({ graceMs: 60_000 });
  try {
    await s.gch.claim('add tests', { everySeconds: 60 });
    s.skew(2 * 60_000);
    s.server.hub.sweep();
    await sleep(150);
    assert.equal(s.prompts.length, 1);
    assert.match(s.prompts[0], /claim cl_\w+ \("add tests"\) is stalled/);
  } finally {
    await s.close();
  }
});

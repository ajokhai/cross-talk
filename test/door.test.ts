import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server/index.js';
import { CrossTalk, CrossTalkError, type Channel } from '../src/client/sdk.js';
import { joinAsMember } from '../src/client/door.js';
import { startModelAgent, type Generated } from '../src/client/llm.js';
import { loadPass } from '../src/client/keys.js';

/** A hub, an owner with an approval channel, and a private passes file. */
async function scene(fn: (s: { url: string; owner: Channel; connect: (name: string) => Promise<CrossTalk> }) => Promise<void>) {
  const hub = await startServer({ port: 0, quiet: true, stateFile: false });
  const previous = process.env.CROSSTALK_PASSES_FILE;
  process.env.CROSSTALK_PASSES_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xt-door-')), 'passes.json');
  const clients: CrossTalk[] = [];
  const connect = async (name: string) => {
    const c = await CrossTalk.connect({ name, url: hub.url, reconnect: false });
    clients.push(c);
    return c;
  };
  try {
    const owner = await (await connect('josh')).createChannel('approved', { approval: true });
    await fn({ url: hub.url, owner, connect });
  } finally {
    for (const c of clients) await c.close().catch(() => {});
    await hub.close();
    if (previous === undefined) delete process.env.CROSSTALK_PASSES_FILE;
    else process.env.CROSSTALK_PASSES_FILE = previous;
  }
}

/** Resolves once `name` is knocking, then lets it in (or turns it away). */
async function answerKnock(owner: Channel, name: string, allow = true) {
  for (let i = 0; i < 100; i++) {
    if ((await owner.knocks()).some(k => k.agent.name === name)) return owner.admit(name, allow);
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error(`${name} never knocked`);
}

test('an always-on member knocks, waits for the host, and keeps its pass for the next run', async () => {
  await scene(async ({ url, owner, connect }) => {
    const log: string[] = [];
    const bot = await connect('bot');
    const joining = joinAsMember(bot, owner.address, { log: l => log.push(l) });
    await answerKnock(owner, 'bot');
    const ch = await joining;
    assert.equal(ch.address, owner.address);
    assert.ok(log.some(l => /waiting for the host to let bot in/.test(l)), log.join('\n'));
    await new Promise(r => setTimeout(r, 20));
    assert.ok(loadPass(owner.address, url), 'pass saved');

    // A restart (new connection, new agent id) goes straight back in with the saved pass.
    await bot.close();
    const again = await connect('bot');
    const back = await joinAsMember(again, owner.address, { waitMs: 2000 });
    assert.equal(back.address, owner.address);
    assert.equal((await owner.knocks()).length, 0, 'no second knock');
  });
});

test('an always-on member the host turns away gets a clear error', async () => {
  await scene(async ({ owner, connect }) => {
    const bot = await connect('intruder');
    // Settle it up front: the refusal can land before anything awaits it.
    const outcome = joinAsMember(bot, owner.address).then(() => undefined, (err: unknown) => err);
    await answerKnock(owner, 'intruder', false);
    const err = await outcome;
    assert.ok(err instanceof CrossTalkError && err.code === 'forbidden' && /did not let intruder in/.test(err.message), String(err));
  });
});

test('crosstalk llm waits at the door of an approval channel, then answers', async () => {
  await scene(async ({ url, owner }) => {
    const generate = async (): Promise<Generated> => ({ text: 'hello from the model' });
    const starting = startModelAgent({ channel: owner.address, name: 'phone', url, reconnect: false, generate });
    await answerKnock(owner, 'phone');
    const agent = await starting;
    try {
      const reply = new Promise<string>(r => owner.on('message', m => m.from.name === 'phone' && r(m.content)));
      await owner.send('@phone hi');
      assert.equal(await reply, 'hello from the model');
    } finally {
      await agent.stop();
    }
  });
});

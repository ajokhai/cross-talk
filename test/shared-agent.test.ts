import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';
import { startModelAgent, openAIGenerator } from '../src/client/llm.js';
import { Meter, parseBudget, priceFor, costOf, formatBudget } from '../src/client/budget.js';
import type { ChannelMessage, DirectMessage } from '../src/protocol.js';

test('budgets read the way people write them', () => {
  assert.deepEqual(parseBudget('$10/month'), { amount: 10, unit: 'usd', period: 'month' });
  assert.deepEqual(parseBudget('$2.50 a day'), { amount: 2.5, unit: 'usd', period: 'day' });
  assert.deepEqual(parseBudget('500k tokens/day'), { amount: 500_000, unit: 'tokens', period: 'day' });
  assert.deepEqual(parseBudget('2M tokens per month'), { amount: 2_000_000, unit: 'tokens', period: 'month' });
  assert.equal(parseBudget('off'), null);
  assert.throws(() => parseBudget('lots'), /can't read budget/);
  assert.equal(formatBudget(parseBudget('200k tokens/day')), '200k tokens/day');
});

test('each model has its own price; dated model names match their family', () => {
  const prices = { 'gpt-5': { in: 1.25, out: 10 }, 'gpt-5-mini': { in: 0.25, out: 2 }, 'claude-sonnet': { in: 3, out: 15 } };
  assert.deepEqual(priceFor('gpt-5-mini-2026-08-01', prices), prices['gpt-5-mini'], 'longest prefix wins');
  assert.deepEqual(priceFor('gpt-5-2026-08-01', prices), prices['gpt-5']);
  assert.equal(priceFor('llama-3', prices), undefined);
  // 1,000 in + 500 out: different cost on each model.
  assert.equal(costOf({ input: 1000, output: 500 }, prices['gpt-5']), 0.00625);
  assert.equal(costOf({ input: 1000, output: 500 }, prices['claude-sonnet']), 0.0105);
});

/** A provider that reports usage like OpenAI's API does, and says which model answered. */
async function meteredModel(model: string, usage: { prompt_tokens: number; completion_tokens: number }) {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => {
      calls++;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ model, choices: [{ message: { role: 'assistant', content: `answer ${calls}` } }], usage }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, calls: () => calls, close: () => new Promise(r => server.close(r)) };
}

/** The next message from `from` that matches `re` (a connection can see an earlier reply arrive late). */
const next = (ch: { once: (e: string, f: (m: any) => void) => void }, from: string, re: RegExp = /./) =>
  new Promise<ChannelMessage>(r => { const f = (m: ChannelMessage) => (m.from.name === from && re.test(m.content) ? r(m) : ch.once('message', f)); ch.once('message', f); });

test('a shared agent meters guests by model price, stops at their budget, and lets the owner manage it', async () => {
  const hub = await startServer({ port: 0, quiet: true });
  // Each reply: 2,000 in + 1,000 out on gpt-5 at $1.25/$10 per million = $0.0125.
  const model = await meteredModel('gpt-5-2026-08-01', { prompt_tokens: 2000, completion_tokens: 1000 });
  const meterFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xt-share-')), 'meter.json');
  const josh = await CrossTalk.connect({ name: 'josh', url: hub.url, reconnect: false });
  const ade = await CrossTalk.connect({ name: 'ade', url: hub.url, reconnect: false });
  try {
    const ch = await josh.createChannel('shared');
    const adeCh = await ade.joinChannel(ch.address);
    const agent = await startModelAgent({
      channel: ch.address, name: 'assistant', url: hub.url, reconnect: false,
      generate: openAIGenerator({ baseUrl: model.url, model: 'gpt-5' }),
      shared: {
        owner: 'josh',
        guestBudget: parseBudget('$0.02/month'),         // one reply fits, two don't
        totalBudget: parseBudget('$1/month'),
        prices: { 'gpt-5': { in: 1.25, out: 10 } },
        model: 'gpt-5',
        meterFile
      }
    });
    await new Promise(r => setTimeout(r, 50));

    // First guest reply: answered, with a usage line priced for the model that answered.
    let reply = next(adeCh, 'assistant');
    await adeCh.send('@assistant help me plan a trip');
    let m = await reply;
    assert.match(m.content, /^answer 1/);
    assert.match(m.content, /3000 tokens \(\$0\.0125\) on gpt-5-2026-08-01/);
    assert.match(m.content, /\$0\.0125 of \$0\.02 used this month/);

    // Second: still under ($0.0125 < $0.02), answered; now $0.025 used.
    reply = next(adeCh, 'assistant', /answer 2|allowance/);
    await adeCh.send('@assistant and the hotels?');
    m = await reply;
    assert.match(m.content, /^answer 2/);

    // Third: over budget. Not sent to the model; a clear note instead, once.
    reply = next(adeCh, 'assistant', /allowance|answer 3/);
    await adeCh.send('@assistant one more?');
    m = await reply;
    assert.match(m.content, /used your allowance on this shared agent \(\$0\.02\/month\)\. Ask josh for more/);
    assert.equal(model.calls(), 2, 'the over-budget request never reached the model');

    // The owner is never metered and never blocked.
    reply = next(ch, 'assistant', /^answer 3/);
    await ch.send('@assistant owner question');
    m = await reply;
    assert.equal(m.content, 'answer 3', 'no usage line for the owner');

    // The owner raises ade's budget by DM, and checks usage.
    const dm = () => new Promise<DirectMessage>(r => josh.once('dm', r));
    let d = dm();
    await josh.dm('assistant', 'budget ade $1/month');
    assert.match((await d).content, /OK: ade now has \$1\/month\. \$0\.025 of \$1 used this month/);
    d = dm();
    await josh.dm('assistant', 'usage');
    assert.match((await d).content, /All guests: \$0\.025 of \$1 used this month · 6k tokens/);

    // The web app's sliders read usage as JSON and set the cap for all guests.
    d = dm();
    await josh.dm('assistant', 'usage json');
    const usage = JSON.parse((await d).content);
    assert.equal(usage.kind, 'crosstalk.usage');
    assert.equal(usage.owner, 'josh');
    assert.deepEqual({ used: usage.total.used, limit: usage.total.limit, unit: usage.total.unit }, { used: 0.025, limit: 1, unit: 'usd' });
    assert.deepEqual(usage.guests.map((g: any) => [g.name, g.used, g.limit, g.tokens]), [['ade', 0.025, 1, 6000]]);
    d = dm();
    await josh.dm('assistant', 'budget all $0.5/month');
    assert.match((await d).content, /OK: all guests together now have \$0\.50\/month/);
    d = dm();
    await josh.dm('assistant', 'usage json');
    const after = JSON.parse((await d).content);
    assert.equal(after.total.limit, 0.5);
    assert.deepEqual(after.ceiling, { amount: 1, unit: 'usd', period: 'month' });
    // The total set at start ($1 here... raised above) is a ceiling: a DM can't lift it past --total-budget.
    d = dm();
    await josh.dm('assistant', 'budget all $50/month');
    assert.match((await d).content, /Can't go above \$1\/month/);
    // Idle, it tells the channel who shares it (how the web app knows to offer the owner its sliders).
    let task = '';
    for (let i = 0; i < 20 && !/^shared by josh/.test(task); i++) {
      await new Promise(r => setTimeout(r, 50));
      await ch.refresh();
      task = [...ch.members.values()].find(x => x.name === 'assistant')?.currentTask ?? '';
    }
    assert.match(task, /^shared by josh · listening/);

    reply = next(adeCh, 'assistant', /^answer 4|allowance/);
    await adeCh.send('@assistant thanks, one more now?');
    assert.match((await reply).content, /^answer 4/);

    // Usage survives a restart: it's in the meter file, per model.
    const saved = new Meter(meterFile).used('ade', 'month');
    assert.equal(saved.replies, 3);
    assert.equal(saved.byModel['gpt-5-2026-08-01'].input, 6000);
    await agent.stop();
  } finally {
    await josh.close();
    await ade.close();
    await model.close();
    await hub.close();
  }
});

test('the total budget caps all guests together, whatever names they use', async () => {
  const hub = await startServer({ port: 0, quiet: true });
  const model = await meteredModel('small', { prompt_tokens: 600, completion_tokens: 400 });
  const meterFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xt-share-')), 'meter.json');
  const owner = await CrossTalk.connect({ name: 'josh', url: hub.url, reconnect: false });
  const g1 = await CrossTalk.connect({ name: 'guest-one', url: hub.url, reconnect: false });
  const g2 = await CrossTalk.connect({ name: 'guest-two', url: hub.url, reconnect: false });
  try {
    const ch = await owner.createChannel('cap');
    const c1 = await g1.joinChannel(ch.address);
    const c2 = await g2.joinChannel(ch.address);
    const agent = await startModelAgent({
      channel: ch.address, name: 'assistant', url: hub.url, reconnect: false,
      generate: openAIGenerator({ baseUrl: model.url, model: 'small' }),
      shared: { owner: 'josh', guestBudget: parseBudget('10k tokens/day'), totalBudget: parseBudget('1.5k tokens/day'), model: 'small', meterFile }
    });
    await new Promise(r => setTimeout(r, 50));
    let reply = next(c1, 'assistant');
    await c1.send('@assistant hi');
    assert.match((await reply).content, /^answer 1/);
    reply = next(c2, 'assistant', /^answer 2|allowance/);
    await c2.send('@assistant hi');
    assert.match((await reply).content, /^answer 2/, '1,000 used of 1,500: still room');
    reply = next(c1, 'assistant', /allowance|answer 3/);
    await c1.send('@assistant again');
    assert.match((await reply).content, /whole allowance for now \(1\.5k tokens\/day\)\. josh can raise it/);
    assert.equal(model.calls(), 2);
    await agent.stop();
  } finally {
    await owner.close();
    await g1.close();
    await g2.close();
    await model.close();
    await hub.close();
  }
});

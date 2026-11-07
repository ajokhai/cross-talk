import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server/index.js';
import { CrossTalk, CrossTalkError } from '../src/client/sdk.js';
import type { UserQuestion } from '../src/protocol.js';

test('the owner can make a member an owner: the key reaches only them, and they can answer questions', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const clients: CrossTalk[] = [];
  const connect = async (name: string) => {
    const c = await CrossTalk.connect({ name, url: server.url, reconnect: false });
    clients.push(c);
    return c;
  };
  try {
    // An agent creates the channel for its person, who joins from the web app.
    const agent = await connect('claude-code');
    const ch = await agent.createChannel('for-josh');
    const josh = await connect('josh');
    const other = await connect('gemini');
    const joshCh = await josh.joinChannel(ch.address);
    const otherCh = await other.joinChannel(ch.address);
    const seen: string[] = [];
    other.on('event', f => seen.push(f.type));

    // Only an owner can hand it on.
    await assert.rejects(otherCh.grantOwner('josh', 'xk_not-the-key'), (e: unknown) => e instanceof CrossTalkError && e.code === 'forbidden');

    const received = new Promise<{ channel: string; ownerKey: string; by: { name: string } }>(r => josh.once('owner', r));
    const notice = new Promise<string>(r => other.on('message', m => m.kind === 'notice' && r(m.content)));
    const who = await ch.grantOwner('josh');
    assert.equal(who.id, josh.agent.id);
    const got = await received;
    assert.equal(got.channel, ch.address);
    assert.equal(got.by.name, 'claude-code');
    assert.equal(joshCh.ownerKey, got.ownerKey, 'the SDK keeps the key on the channel');
    assert.match(await notice, /claude-code made josh an owner/);
    assert.ok(!seen.includes('channel.owner'), 'nobody else receives the key');

    // The person can now answer the agent's question with that key.
    const asked = ch.ask('ship it?', { options: ['yes', 'no'], timeoutMs: 5000 });
    let q: UserQuestion | undefined;
    for (let i = 0; i < 50 && !q; i++) {
      q = [...joshCh.questions.values()][0];
      if (!q) await new Promise(r => setTimeout(r, 20));
    }
    await joshCh.answer(q!.id, 'yes');
    assert.equal((await asked).answer, 'yes');

    // Errors: unknown member, yourself, and a name two members share.
    await assert.rejects(ch.grantOwner('nobody'), (e: unknown) => e instanceof CrossTalkError && e.code === 'not_found');
    await assert.rejects(ch.grantOwner('claude-code'), (e: unknown) => e instanceof CrossTalkError && e.code === 'bad_request');
    await (await connect('josh')).joinChannel(ch.address);
    await assert.rejects(ch.grantOwner('josh'), (e: unknown) => e instanceof CrossTalkError && /use an id/.test(e.message));
  } finally {
    for (const c of clients) await c.close().catch(() => {});
    await server.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';

test('@all, @everyone and @here mention every member but the sender', async () => {
  const hub = await startServer({ port: 0, quiet: true, stateFile: false });
  const clients: CrossTalk[] = [];
  const connect = async (name: string) => {
    const c = await CrossTalk.connect({ name, url: hub.url, reconnect: false });
    clients.push(c);
    return c;
  };
  try {
    const josh = await connect('josh');
    const ch = await josh.createChannel('team');
    const a = await connect('claude-code');
    const b = await connect('gemini');
    await a.joinChannel(ch.address);
    await b.joinChannel(ch.address);
    const everyoneElse = [a.agent.id, b.agent.id].sort();

    for (const tag of ['@all', '@everyone', '@here', '@ALL']) {
      const sent = await ch.send(`${tag} release is out, update and restart your listener`);
      assert.deepEqual((sent.mentions ?? []).map(m => m.id).sort(), everyoneElse, `${tag} mentions everyone but the sender`);
    }
    const end = await ch.send('thanks, all.  @all');
    assert.equal(end.mentions?.length, 2, '@all at the very end counts');

    for (const text of ['email me at x@allison.dev', '@alligator', 'all of you', 'see @everyones']) {
      const sent = await ch.send(text);
      assert.equal(sent.mentions, undefined, `"${text}" mentions nobody`);
    }

    // A member actually named "all" is still mentioned by name, once.
    const named = await connect('all');
    await named.joinChannel(ch.address);
    const both = await ch.send('@all hi');
    const ids = (both.mentions ?? []).map(m => m.id);
    assert.equal(ids.length, 3);
    assert.equal(new Set(ids).size, 3, 'no duplicates');
    assert.ok(ids.includes(named.agent.id));
  } finally {
    for (const c of clients) await c.close().catch(() => {});
    await hub.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';

test('members carry pronouns: set on connect, changed with status, kept short and plain', async () => {
  const hub = await startServer({ port: 0, quiet: true, stateFile: false });
  const mimi = await CrossTalk.connect({ name: 'Mimi', url: hub.url, reconnect: false, pronouns: 'she/her' });
  const archie = await CrossTalk.connect({ name: 'Archie', url: hub.url, reconnect: false });
  try {
    const ch = await mimi.createChannel('team');
    const seen = await archie.joinChannel(ch.address);
    assert.equal(seen.members.get(mimi.agent.id)?.pronouns, 'she/her');
    assert.equal(seen.members.get(archie.agent.id)?.pronouns, undefined);

    const updated = new Promise<any>(r => mimi.on('event', f => { if (f.type === 'member.updated' && f.agent.name === 'Archie') r(f.agent); }));
    await archie.setStatus('idle', undefined, { pronouns: '  they/them\n' });
    assert.equal((await updated).pronouns, 'they/them');

    const long = await archie.setStatus('idle', undefined, { pronouns: 'x'.repeat(60) });
    assert.equal(long.pronouns?.length, 24);
    const cleared = await archie.setStatus('idle', undefined, { pronouns: '' });
    assert.equal(cleared.pronouns, undefined);
  } finally {
    await mimi.close();
    await archie.close();
    await hub.close();
  }
});

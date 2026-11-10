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

    // Renaming: the others see it at once, and @mentions use the new name.
    const renamed = new Promise<any>(r => mimi.on('event', f => { if (f.type === 'member.updated' && f.agent.id === archie.agent.id) r(f.agent); }));
    await archie.setStatus('idle', undefined, { name: 'Archibald' });
    assert.equal((await renamed).name, 'Archibald');
    const mentioned = new Promise<any>(r => archie.on('message', r));
    await ch.send('@Archibald hello');
    assert.deepEqual((await mentioned).mentions?.map((m: any) => m.name), ['Archibald']);
    await assert.rejects(archie.setStatus('idle', undefined, { name: ' ' }));
  } finally {
    await mimi.close();
    await archie.close();
    await hub.close();
  }
});

test('members say which tool they run in and where; MCP client names read nicely', async () => {
  const { friendlyClient, detectClient, detectPlace } = await import('../src/client/client-name.js');
  assert.equal(friendlyClient('claude-code'), 'Claude Code');
  assert.equal(friendlyClient('gemini-cli-mcp-client'), 'Gemini CLI');
  assert.equal(friendlyClient('codex-mcp-client'), 'Codex');
  assert.equal(friendlyClient('my_custom-agent'), 'my custom agent');
  assert.equal(detectClient({ CLAUDECODE: '1' }), 'Claude Code');
  assert.equal(detectClient({ CROSSTALK_CLIENT: 'Goose' }), 'Goose');
  assert.equal(detectPlace({ CCR_SESSION_PROFILE: 'x' }), 'cloud');
  assert.equal(detectPlace({}, 'joshs-macbook'), 'computer');
  assert.equal(detectPlace({}, 'grok-bot-vm-528355866'), 'cloud');
  assert.equal(detectClient({ USER: 'box' }, 'grok-bot-vm-528355866'), 'Grok');
  assert.equal(detectClient({}, 'joshs-macbook'), undefined);
  assert.equal(detectPlace({ CROSSTALK_PLACE: 'edge' }), 'edge');

  const hub = await startServer({ port: 0, quiet: true, stateFile: false });
  const sap = await CrossTalk.connect({ name: 'Sap', url: hub.url, reconnect: false, client: 'Claude Code', place: 'cloud' });
  const josh = await CrossTalk.connect({ name: 'Josh', url: hub.url, reconnect: false });
  try {
    const ch = await sap.createChannel('team');
    const seen = await josh.joinChannel(ch.address);
    const s = seen.members.get(sap.agent.id)!;
    assert.equal(s.client, 'Claude Code');
    assert.equal(s.place, 'cloud');
    const withBio = await sap.setStatus(undefined, undefined, { bio: 'Website agent for familymake.com: copy, SEO, audits, fixes.' });
    assert.equal(withBio.bio, 'Website agent for familymake.com: copy, SEO, audits, fixes.');
    const moved = await sap.setStatus(undefined, undefined, { place: 'phone' });
    assert.equal(moved.place, 'phone');
    await assert.rejects(sap.request('status.update', { place: 'moon' } as any), /place must be/);
  } finally {
    await sap.close();
    await josh.close();
    await hub.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server/index.js';
import { MeshHub } from '../src/server/hub.js';
import { CrossTalk } from '../src/client/sdk.js';
import { PROTOCOL_VERSION } from '../src/protocol.js';

test('the sender or the owner can delete a message; it leaves history for everyone', async () => {
  const hub = await startServer({ port: 0, quiet: true, stateFile: false });
  const josh = await CrossTalk.connect({ name: 'Josh', url: hub.url, reconnect: false });
  const archie = await CrossTalk.connect({ name: 'Archie', url: hub.url, reconnect: false });
  const sap = await CrossTalk.connect({ name: 'Sap', url: hub.url, reconnect: false });
  try {
    const ch = await josh.createChannel('team');
    const a = await archie.joinChannel(ch.address);
    const s = await sap.joinChannel(ch.address);

    const secret = await ch.send('the password is hunter2');
    const told = new Promise<any>(r => archie.on('event', f => { if (f.type === 'message.deleted') r(f); }));
    // Someone else's message without the owner key: refused.
    await assert.rejects(s.deleteMessage(secret.id), (e: any) => e.code === 'forbidden');
    await ch.deleteMessage(secret.id);
    const ev = await told;
    assert.equal(ev.message, secret.id);
    assert.equal(ev.by.name, 'Josh');
    assert.ok(!a.messages.some(m => m.id === secret.id), 'members drop it');

    // Your own needs no owner key.
    const oops = await s.send('oops, wrong channel');
    await s.deleteMessage(oops.id);
    await assert.rejects(s.deleteMessage(oops.id), (e: any) => e.code === 'not_found');

    await ch.send('still here');
    const late = await CrossTalk.connect({ name: 'Mimi', url: hub.url, reconnect: false });
    try {
      const m = await late.joinChannel(ch.address);
      const text = m.messages.map(x => x.content).join('\n');
      assert.ok(!text.includes('hunter2') && !text.includes('oops'), 'a late joiner never sees it');
      assert.ok(text.includes('still here'));
    } finally { await late.close(); }
  } finally {
    await Promise.all([josh.close(), archie.close(), sap.close()]);
    await hub.close();
  }
});

test('a deleted message stays gone after a hub restart', async () => {
  const first = new MeshHub();
  const conn = first.connect({ send() {}, close() {} }, '127.0.0.1');
  first.hello(conn, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name: 'owner' } } as any);
  const created: any = await first.request(conn, { type: 'channel.create', id: '1', name: 'x' });
  const { channel, ownerKey } = created.data;
  const sent: any = await first.request(conn, { type: 'message.send', id: '2', channel: channel.id, content: 'secret: hunter2' } as any);
  await first.request(conn, { type: 'message.delete', id: '3', channel: channel.id, message: sent.data.id, ownerKey } as any);
  const state = JSON.stringify(first.exportState());
  assert.ok(!state.includes('hunter2'), 'the text is gone from saved state');
});

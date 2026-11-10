import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server/index.js';
import { MeshHub } from '../src/server/hub.js';
import { CrossTalk } from '../src/client/sdk.js';
import { PROTOCOL_VERSION } from '../src/protocol.js';

test('the owner sets channel rules: joiners get them, members are told when they change, others cannot set them', async () => {
  const hub = await startServer({ port: 0, quiet: true, stateFile: false });
  const josh = await CrossTalk.connect({ name: 'Josh', url: hub.url, reconnect: false });
  const archie = await CrossTalk.connect({ name: 'Archie', url: hub.url, reconnect: false });
  const mimi = await CrossTalk.connect({ name: 'Mimi', url: hub.url, reconnect: false });
  try {
    const ch = await josh.createChannel('team');
    const theirs = await archie.joinChannel(ch.address);
    assert.equal(theirs.rules, undefined);

    const told = new Promise<any>(r => archie.on('event', f => { if (f.type === 'channel.updated' && f.rulesChanged) r(f); }));
    const info = await ch.setRules('  Open the source document before you quote a figure.\r\n\n\n\nMark anything unchecked UNVERIFIED.  ');
    assert.equal(info.rules, 'Open the source document before you quote a figure.\n\nMark anything unchecked UNVERIFIED.');
    assert.equal((await told).channel.rules, info.rules);

    const late = await mimi.joinChannel(ch.address);
    assert.equal(late.rules, info.rules, 'a new member gets the rules on join');

    await assert.rejects(theirs.setRules('anything goes', 'xk_wrong'), (e: any) => e.code === 'forbidden');
    await assert.rejects(ch.setRules('x'.repeat(2001)), /2000/);

    const cleared = await ch.setRules('');
    assert.equal(cleared.rules, undefined);
  } finally {
    await Promise.all([josh.close(), archie.close(), mimi.close()]);
    await hub.close();
  }
});

test('rules survive a hub restart', async () => {
  const first = new MeshHub();
  const conn = first.connect({ send() {}, close() {} }, '127.0.0.1');
  first.hello(conn, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name: 'owner' } } as any);
  const created: any = await first.request(conn, { type: 'channel.create', id: '1', name: 'x' });
  const { channel, ownerKey } = created.data;
  await first.request(conn, { type: 'channel.configure', id: '2', channel: channel.id, ownerKey, rules: 'Cite your sources.' } as any);
  const second = new MeshHub();
  second.restoreState(JSON.parse(JSON.stringify(first.exportState())));
  const peer = second.connect({ send() {}, close() {} }, '127.0.0.1');
  second.hello(peer, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name: 'reader' } } as any);
  const joined: any = await second.request(peer, { type: 'channel.join', id: '3', channel: channel.id });
  assert.equal(joined.data.channel.rules, 'Cite your sources.');
});

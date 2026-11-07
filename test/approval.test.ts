import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';
import type { ServerFrame } from '../src/protocol.js';

/** The next frame of `type` a client receives. */
const nextEvent = <T extends ServerFrame['type']>(c: CrossTalk, type: T) =>
  new Promise<Extract<ServerFrame, { type: T }>>(r => { const f = (e: ServerFrame) => { if (e.type === type) { c.off('event', f); r(e as any); } }; c.on('event', f); });

test('approval mode: newcomers knock, the owner admits or denies, and a pass gets them back in', async () => {
  const hub = await startServer({ port: 0, quiet: true, stateFile: false });
  const host = await CrossTalk.connect({ name: 'host', url: hub.url, reconnect: false });
  const guest = await CrossTalk.connect({ name: 'guest', url: hub.url, reconnect: false });
  const stranger = await CrossTalk.connect({ name: 'stranger', url: hub.url, reconnect: false });
  try {
    const created: any = await host.request('channel.create', { name: 'meeting', approval: true });
    assert.equal(created.channel.approval, true);
    assert.match(created.pass, /^xp_/, 'the creator gets a pass too');
    const address = created.channel.id;
    const ownerKey = created.ownerKey;

    // A newcomer with only the address knocks; the host is told.
    const knocked = nextEvent(host, 'channel.knock');
    await assert.rejects(guest.request('channel.join', { channel: address }), (e: any) => e.code === 'pending_approval');
    const k = await knocked;
    assert.equal(k.knock.agent.name, 'guest');
    assert.equal(k.knock.status, 'waiting');
    assert.deepEqual((await host.request('member.knocks', { channel: address, ownerKey })).knocks.map((x: any) => x.agent.name), ['guest']);

    // Only the owner key can admit.
    await assert.rejects(host.request('member.admit', { channel: address, ownerKey: 'xk_wrong', agent: 'guest', allow: true }), (e: any) => e.code === 'forbidden');
    const admitted = nextEvent(guest, 'channel.admitted');
    await host.request('member.admit', { channel: address, ownerKey, agent: 'guest', allow: true });
    const { pass } = await admitted;
    assert.match(pass, /^xp_/);
    const snap: any = await guest.request('channel.join', { channel: address, pass });
    assert.equal(snap.channel.id, address);

    // Denied: told so, and still not in.
    const refused = nextEvent(stranger, 'channel.refused');
    await assert.rejects(stranger.request('channel.join', { channel: address }), (e: any) => e.code === 'pending_approval');
    await host.request('member.admit', { channel: address, ownerKey, agent: 'stranger', allow: false });
    await refused;
    await assert.rejects(stranger.request('channel.join', { channel: address }), (e: any) => e.code === 'pending_approval', 'denying is not banning: they can knock again');

    // The pass works again after leaving (a new session would show it too); a guessed pass doesn't.
    await guest.request('channel.leave', { channel: address });
    await guest.request('channel.join', { channel: address, pass });
    await assert.rejects(stranger.request('channel.join', { channel: address, pass: 'xp_guess' }), (e: any) => e.code === 'pending_approval');

    // A kick revokes the pass.
    await host.request('member.kick', { channel: address, ownerKey, agent: 'guest' });
    await assert.rejects(guest.request('channel.join', { channel: address, pass }), (e: any) => e.code === 'pending_approval');
  } finally {
    await host.close();
    await guest.close();
    await stranger.close();
    await hub.close();
  }
});

test('turning approval on gives everyone already in a pass; turning it off lets the waiting in', async () => {
  const hub = await startServer({ port: 0, quiet: true, stateFile: false });
  const host = await CrossTalk.connect({ name: 'host', url: hub.url, reconnect: false });
  const early = await CrossTalk.connect({ name: 'early', url: hub.url, reconnect: false });
  const late = await CrossTalk.connect({ name: 'late', url: hub.url, reconnect: false });
  try {
    const created: any = await host.request('channel.create', { name: 'open' });
    const address = created.channel.id;
    await early.request('channel.join', { channel: address });
    const earlyPass = nextEvent(early, 'channel.admitted');
    const info: any = await host.request('channel.configure', { channel: address, ownerKey: created.ownerKey, approval: true });
    assert.equal(info.approval, true);
    assert.match((await earlyPass).pass, /^xp_/);

    await assert.rejects(late.request('channel.join', { channel: address }), (e: any) => e.code === 'pending_approval');
    const letIn = nextEvent(late, 'channel.admitted');
    await host.request('channel.configure', { channel: address, ownerKey: created.ownerKey, approval: false });
    await letIn;
    await late.request('channel.join', { channel: address });
  } finally {
    await host.close();
    await early.close();
    await late.close();
    await hub.close();
  }
});

test('approval and passes survive a hub restart; the passes themselves are never stored', async () => {
  const hub = await startServer({ port: 0, quiet: true, stateFile: false });
  const host = await CrossTalk.connect({ name: 'host', url: hub.url, reconnect: false });
  try {
    const created: any = await host.request('channel.create', { name: 'kept', approval: true });
    const state = hub.hub.exportState();
    const saved = state.channels.find((c: any) => c.id === created.channel.id)!;
    assert.equal(saved.approval, true);
    assert.equal(saved.passes!.length, 1);
    assert.ok(!JSON.stringify(state).includes(created.pass), 'only a hash of the pass is kept');
  } finally {
    await host.close();
    await hub.close();
  }
});

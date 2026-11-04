import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type RunningServer } from '../src/server/index.js';
import { MeshHub } from '../src/server/hub.js';
import { CrossTalk } from '../src/client/sdk.js';
import { PROTOCOL_VERSION } from '../src/protocol.js';

async function setup(extra: Parameters<typeof startServer>[0] = {}) {
  const server = await startServer({ port: 0, quiet: true, stateFile: false, public: { tunnel: false }, ...extra });
  const owner = await CrossTalk.connect({ name: 'owner', url: server.url, reconnect: false, token: extra.token });
  const ch = await owner.createChannel('shared');
  const other = await owner.createChannel('private-elsewhere');
  const door = `http://127.0.0.1:${server.publicDoor!.port}`;
  const invite = (opts: Record<string, unknown> = {}) =>
    (owner as any).request('invite.create', { channel: ch.address, ownerKey: (ch as any).ownerKey, ...opts }) as Promise<{ key: string; invite: any }>;
  return { server, owner, ch, other, door, invite };
}

const session = async (door: string, key: string, name = 'remote-bot') => {
  const res = await fetch(`${door}/v1/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CrossTalk-Invite': key }, body: JSON.stringify({ agent: { name } }) });
  return { status: res.status, body: await res.json() as any };
};
const rpc = async (door: string, key: string, sid: string, frame: Record<string, unknown>) => {
  const res = await fetch(`${door}/v1/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CrossTalk-Invite': key, 'X-CrossTalk-Session': sid }, body: JSON.stringify(frame) });
  return await res.json() as any;
};
const close = async (s: { server: RunningServer; owner: CrossTalk }) => {
  await s.owner.close();
  await s.server.close();
};

test('the public door admits nothing without a live invite key', async () => {
  const s = await setup({ token: 'hub-secret' });
  try {
    assert.equal((await fetch(`${s.door}/health`)).status, 200);
    assert.equal((await session(s.door, '')).status, 401);
    assert.equal((await session(s.door, 'xi_' + 'A'.repeat(32))).status, 401, 'a made-up key');
    // The hub token is not a way in through the public door.
    const withToken = await fetch(`${s.door}/v1/sessions`, { method: 'POST', headers: { Authorization: 'Bearer hub-secret', 'Content-Type': 'application/json' }, body: '{"agent":{"name":"x"}}' });
    assert.equal(withToken.status, 401);
    const { key } = await s.invite();
    // The directory and read-only API don't exist on the public door, even with a key.
    for (const p of ['/api/channels', `/api/channels/${s.ch.address}`, `/api/locks/check?channel=${s.ch.address}&file=a`]) {
      const res = await fetch(`${s.door}${p}`, { headers: { 'X-CrossTalk-Invite': key } });
      assert.equal(res.status, 404, p);
    }
    await assert.rejects(CrossTalk.connect({ name: 'ws-nokey', url: `ws://127.0.0.1:${s.server.publicDoor!.port}`, reconnect: false }));
  } finally {
    await close(s);
  }
});

test('an invite admits remote agents to its own channel only', async () => {
  const s = await setup();
  try {
    const { key, invite } = await s.invite({ label: 'vps-agent' });
    assert.match(key, /^xi_/);
    assert.equal(invite.status, 'active');

    const { status, body } = await session(s.door, key);
    assert.equal(status, 201);
    assert.equal(body.agent.remote, true);
    assert.equal(body.agent.via, 'vps-agent');
    assert.equal(body.channel, s.ch.address);

    const sid = body.session;
    assert.equal((await rpc(s.door, key, sid, { type: 'channel.join', channel: s.ch.address })).ok, true);
    assert.equal((await rpc(s.door, key, sid, { type: 'message.send', channel: s.ch.address, content: 'hello from outside' })).ok, true);
    for (const frame of [
      { type: 'channel.join', channel: s.other.address },
      { type: 'channel.create', name: 'mine' },
      { type: 'invite.create', channel: s.ch.address, ownerKey: 'xk_guess' },
      { type: 'channel.close', channel: s.ch.address, ownerKey: 'xk_guess' }
    ]) {
      const r = await rpc(s.door, key, sid, frame);
      assert.equal(r.ok, false, frame.type);
      assert.equal(r.error.code, 'forbidden', frame.type);
    }
    const listed = await rpc(s.door, key, sid, { type: 'channel.list', scope: 'public' });
    assert.deepEqual(listed.data.channels.map((c: any) => c.id), [s.ch.address], 'only its own channel, whatever scope it asks for');

    // Everyone inside sees it as remote, on the member list and on everything it sends.
    await s.ch.refresh();
    const said = [...s.ch.messages].find(m => m.content === 'hello from outside');
    assert.equal(said?.from.remote, true, 'a name is a label; the remote flag is the hub\'s word');
    assert.equal([...s.ch.messages].find(m => m.from.name === 'owner')?.from.remote, undefined);
    const member = [...s.ch.members.values()].find(m => m.name === 'remote-bot');
    assert.equal(member?.remote, true);

    // A session made at the local door can't be driven through the public one.
    const local = await (await fetch(`${s.server.url.replace('ws', 'http')}/v1/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"agent":{"name":"local"}}' })).json() as any;
    const res = await fetch(`${s.door}/v1/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CrossTalk-Invite': key, 'X-CrossTalk-Session': local.session }, body: '{"type":"channel.list"}' });
    assert.equal(res.status, 401);
  } finally {
    await close(s);
  }
});

test('WebSocket and remote MCP agents get the same policy', async () => {
  const s = await setup();
  try {
    const { key } = await s.invite();
    const ws = await CrossTalk.connect({ name: 'ws-remote', url: `ws://127.0.0.1:${s.server.publicDoor!.port}`, reconnect: false, headers: { 'X-CrossTalk-Invite': key } });
    try {
      assert.equal(ws.agent.remote, true);
      await ws.joinChannel(s.ch.address);
      await assert.rejects(ws.joinChannel(s.other.address), (err: any) => err.code === 'forbidden');
    } finally {
      await ws.close();
    }

    const init = await fetch(`${s.door}/mcp?name=mcp-remote&channel=${s.ch.address},${s.other.address}&key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
    });
    assert.equal(init.status, 200);
    const sid = init.headers.get('mcp-session-id')!;
    // Without the key, the session id alone gets nowhere.
    const noKey = await fetch(`${s.door}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': sid }, body: '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' });
    assert.equal(noKey.status, 401);
    const deadline = Date.now() + 5000;
    let member;
    while (!member && Date.now() < deadline) {
      await s.ch.refresh();
      member = [...s.ch.members.values()].find(m => m.name === 'mcp-remote');
      if (!member) await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(member?.remote, true, 'the MCP agent joined its invite channel as a remote member');
    await s.other.refresh();
    assert.ok(![...s.other.members.values()].some(m => m.name === 'mcp-remote'), 'and not the other channel');
  } finally {
    await close(s);
  }
});

test('max agents, and revoking disconnects at once', async () => {
  const s = await setup();
  try {
    const { key } = await s.invite({ label: 'one-seat', maxAgents: 1 });
    const first = await CrossTalk.connect({ name: 'seat-1', url: `ws://127.0.0.1:${s.server.publicDoor!.port}`, reconnect: false, headers: { 'X-CrossTalk-Invite': key } });
    await first.joinChannel(s.ch.address);
    assert.equal((await session(s.door, key, 'seat-2')).status, 400, 'the invite is full');

    const closed = new Promise(resolve => first.once('disconnected', resolve));
    const revoked = await (s.owner as any).request('invite.revoke', { channel: s.ch.address, ownerKey: (s.ch as any).ownerKey, invite: 'one-seat' });
    assert.equal(revoked.disconnected, 1);
    await closed;
    assert.equal((await session(s.door, key)).status, 401, 'a revoked key is refused');
    const list = await (s.owner as any).request('invite.list', { channel: s.ch.address, ownerKey: (s.ch as any).ownerKey });
    assert.equal(list.invites[0].status, 'revoked');
    await first.close();
  } finally {
    await close(s);
  }
});

test('only the channel owner can make invites', async () => {
  const s = await setup();
  const guest = await CrossTalk.connect({ name: 'guest', url: s.server.url, reconnect: false });
  try {
    await guest.joinChannel(s.ch.address);
    await assert.rejects((guest as any).request('invite.create', { channel: s.ch.address, ownerKey: 'xk_wrong' }));
  } finally {
    await guest.close();
    await close(s);
  }
});

test('invites expire, and survive a restart as hashes only', async () => {
  let now = 1_000_000;
  const hub = new MeshHub({ now: () => now });
  const owner = hub.connect({ send() {}, close() {} }, '127.0.0.1');
  hub.hello(owner, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name: 'owner' } } as any);
  const created = (await hub.request(owner, { id: '1', type: 'channel.create', name: 'x' })) as any;
  const address = created.data.channel.id;
  const ownerKey = created.data.ownerKey;
  const inv = (await hub.request(owner, { id: '2', type: 'invite.create', channel: address, ownerKey, expiresInSeconds: 3600 })) as any;
  const key = inv.data.key;

  let closedWith: number | undefined;
  const remote = hub.connect({ send() {}, close: code => (closedWith = code) }, 'public:1.2.3.4', { inviteKey: key });
  hub.hello(remote, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name: 'r' } } as any);

  const state = JSON.parse(JSON.stringify(hub.exportState()));
  assert.ok(!JSON.stringify(state).includes(key), 'the key itself is never saved');
  const restored = new MeshHub({ now: () => now });
  restored.restoreState(state);
  assert.ok(restored.liveInvite(key), 'the key still works after a restart');

  now += 3601_000;
  hub.sweep();
  assert.equal(closedWith, 4003, 'expired: the remote agent is disconnected');
  assert.equal(hub.liveInvite(key), undefined);
  assert.throws(() => hub.connect({ send() {}, close() {} }, 'public:1.2.3.4', { inviteKey: key }), /invite/);
});

test('the state file of a hub with a public door keeps invites', async () => {
  const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xt-remote-')), 'hub.json');
  const s = await setup({ stateFile });
  const { key } = await s.invite();
  const port = Number(new URL(s.server.url).port);
  await close(s);
  const again = await startServer({ port, quiet: true, stateFile, public: { tunnel: false } });
  try {
    assert.equal((await session(`http://127.0.0.1:${again.publicDoor!.port}`, key)).status, 201);
  } finally {
    await again.close();
  }
});

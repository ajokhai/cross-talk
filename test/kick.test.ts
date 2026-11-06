import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshHub, type Connection } from '../src/server/hub.js';
import { PROTOCOL_VERSION, type ServerFrame } from '../src/protocol.js';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';

function setup() {
  const hub = new MeshHub();
  let seq = 0;
  const agent = (name: string, address = '10.0.0.1') => {
    const inbox: ServerFrame[] = [];
    const conn: Connection = hub.connect({ send: f => inbox.push(f), close: () => {} }, address);
    hub.hello(conn, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name } });
    const call = (frame: Record<string, unknown>) => hub.request(conn, { id: String(++seq), ...frame }) as Promise<any>;
    return { conn, inbox, call, id: conn.agent!.id };
  };
  return { hub, agent };
}

test('the owner kicks a member: it is told, others see it leave, and it can rejoin unless banned', async () => {
  const { agent } = setup();
  const owner = agent('owner');
  const created = (await owner.call({ type: 'channel.create', name: 'k' })).data;
  const channel = created.channel.id;
  const key = created.ownerKey;
  const bob = agent('Bob', '10.0.0.2');
  const carol = agent('carol', '10.0.0.3');
  await bob.call({ type: 'channel.join', channel });
  await carol.call({ type: 'channel.join', channel });

  assert.equal((await carol.call({ type: 'member.kick', channel, ownerKey: 'xk_wrong', agent: 'bob' })).ok, false, 'only the owner');
  const r = await owner.call({ type: 'member.kick', channel, ownerKey: key, agent: 'bob', reason: 'spam' });
  assert.ok(r.ok);
  assert.deepEqual(r.data.kicked.map((a: any) => a.name), ['Bob']);
  const told = bob.inbox.find(f => f.type === 'channel.kicked') as any;
  assert.equal(told.reason, 'spam');
  assert.equal(told.banned, false);
  assert.ok(carol.inbox.some(f => f.type === 'member.left' && (f as any).reason === 'kicked'));
  assert.ok((await bob.call({ type: 'channel.join', channel })).ok, 'a plain kick lets it back');

  await owner.call({ type: 'member.kick', channel, ownerKey: key, agent: bob.id, ban: true });
  const again = await bob.call({ type: 'channel.join', channel });
  assert.equal(again.error.code, 'forbidden');
  const sameName = agent('BOB', '10.0.0.9');
  assert.equal((await sameName.call({ type: 'channel.join', channel })).error.code, 'forbidden', 'the name is banned too');
  const bans = (await owner.call({ type: 'member.bans', channel, ownerKey: key })).data.bans;
  assert.equal(bans.length, 1);
  assert.equal(bans[0].ipCount, 0);
  assert.equal((await owner.call({ type: 'member.unban', channel, ownerKey: key, agent: 'bob' })).data.unbanned, 1);
  assert.ok((await bob.call({ type: 'channel.join', channel })).ok, 'unbanned');
  assert.equal((await owner.call({ type: 'member.kick', channel, ownerKey: key, agent: 'owner' })).error.code, 'bad_request', 'not yourself');
});

test('ip bans: by member with ip:true, or by ip:<address>; addresses are counted, never shown; never the owner\'s own', async () => {
  const { agent } = setup();
  const owner = agent('owner', '10.0.0.1');
  const created = (await owner.call({ type: 'channel.create', name: 'ip' })).data;
  const channel = created.channel.id;
  const key = created.ownerKey;
  const mallory = agent('mallory', '203.0.113.7');
  await mallory.call({ type: 'channel.join', channel });
  assert.equal((await owner.call({ type: 'member.kick', channel, ownerKey: key, agent: 'mallory', ip: true })).error.code, 'bad_request', 'ip needs ban');
  await owner.call({ type: 'member.kick', channel, ownerKey: key, agent: 'mallory', ban: true, ip: true });
  const sock = agent('sock-puppet', '203.0.113.7');
  assert.equal((await sock.call({ type: 'channel.join', channel })).error.code, 'forbidden', 'same address, new name');
  const bans = (await owner.call({ type: 'member.bans', channel, ownerKey: key })).data.bans;
  assert.equal(bans[0].ipCount, 1);
  assert.ok(!JSON.stringify(bans).includes('203.0.113.7'), 'the address itself is not shown');

  const eve = agent('eve', '198.51.100.4');
  await eve.call({ type: 'channel.join', channel });
  const direct = await owner.call({ type: 'member.kick', channel, ownerKey: key, agent: 'ip:198.51.100.4' });
  assert.deepEqual(direct.data.kicked.map((a: any) => a.name), ['eve']);
  assert.equal((await owner.call({ type: 'member.kick', channel, ownerKey: key, agent: 'ip:10.0.0.1' })).error.code, 'bad_request', "can't ban your own address");
  assert.equal((await owner.call({ type: 'member.unban', channel, ownerKey: key, agent: 'ip:198.51.100.4' })).data.unbanned, 1);
});

test('bans survive a restart; the SDK reports a kick as a lost channel', async () => {
  const { agent, hub } = setup();
  const owner = agent('owner');
  const created = (await owner.call({ type: 'channel.create', name: 'p' })).data;
  const bob = agent('bob');
  await bob.call({ type: 'channel.join', channel: created.channel.id });
  await owner.call({ type: 'member.kick', channel: created.channel.id, ownerKey: created.ownerKey, agent: 'bob', ban: true });
  const second = new MeshHub();
  second.restoreState(JSON.parse(JSON.stringify(hub.exportState())));
  const c = second.connect({ send: () => {}, close: () => {} }, '10.0.0.5');
  second.hello(c, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name: 'bob' } });
  assert.equal(((await second.request(c, { id: '1', type: 'channel.join', channel: created.channel.id })) as any).error.code, 'forbidden');

  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const o = await CrossTalk.connect({ name: 'owner', url: server.url, reconnect: false });
  const v = await CrossTalk.connect({ name: 'victim', url: server.url, reconnect: false });
  try {
    const ch = await o.createChannel('sdk');
    await v.joinChannel(ch.address);
    const lost = new Promise<any>(resolve => v.on('channel.lost', resolve));
    const r = await ch.kick('victim', { ban: true, reason: 'bye' });
    assert.equal(r.kicked[0].name, 'victim');
    const l = await lost;
    assert.equal(l.reason, 'kicked');
    assert.equal(l.banned, true);
    assert.equal(l.note, 'bye');
    assert.ok(!v.channels.has(ch.address));
  } finally {
    await o.close();
    await v.close();
    await server.close();
  }
});

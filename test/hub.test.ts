import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshHub, type Connection } from '../src/server/hub.js';
import { LockManager } from '../src/server/locks.js';
import { PROTOCOL_VERSION, type ChannelSnapshot, type ServerFrame } from '../src/protocol.js';

/** A hub plus helpers to drive it with in-memory peers. */
function setup(options: ConstructorParameters<typeof MeshHub>[0] = {}) {
  let clock = 1_000_000;
  const hub = new MeshHub({ now: () => clock, ...options });
  let seq = 0;

  const agent = (name: string, address = '10.0.0.1') => {
    const inbox: ServerFrame[] = [];
    const conn: Connection = hub.connect({ send: f => inbox.push(f), close: () => {} }, address);
    const welcome = hub.hello(conn, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name } });
    const call = async (frame: Record<string, unknown>) => {
      const res = await hub.request(conn, { id: String(++seq), ...frame });
      assert.equal(res.type, 'result');
      return res as Extract<ServerFrame, { type: 'result' }>;
    };
    const ok = async <T = any>(frame: Record<string, unknown>): Promise<T> => {
      const res = await call(frame);
      assert.ok(res.ok, `expected ok, got ${JSON.stringify(res)}`);
      return (res as any).data;
    };
    const err = async (frame: Record<string, unknown>) => {
      const res = await call(frame);
      assert.equal(res.ok, false, `expected an error, got ${JSON.stringify(res)}`);
      return (res as any).error as { code: string; message: string; details?: any };
    };
    const events = (type?: string) => inbox.filter(f => !type || f.type === type) as any[];
    return { conn, id: welcome.agent.id, name, ok, err, events, inbox };
  };

  return { hub, agent, tick: (ms: number) => (clock += ms) };
}

test('every conversation gets its own unguessable address; private by default', async () => {
  const { agent } = setup();
  const a = agent('alice');
  const one = await a.ok<ChannelSnapshot>({ type: 'channel.create', name: 'auth' });
  const two = await a.ok<ChannelSnapshot>({ type: 'channel.create', name: 'auth' });

  assert.match(one.channel.id, /^xt_[A-Za-z0-9_-]{22}$/);
  assert.notEqual(one.channel.id, two.channel.id, 'same label, different conversations');
  assert.equal(one.channel.visibility, 'private');
  assert.equal(one.channel.name, 'auth');
});

test('agents join only by address, never by name', async () => {
  const { agent } = setup();
  const a = agent('alice');
  const b = agent('bob');
  const snap = await a.ok<ChannelSnapshot>({ type: 'channel.create', name: 'auth' });

  assert.equal((await b.err({ type: 'channel.join', channel: 'auth' })).code, 'not_found');
  assert.equal((await b.err({ type: 'channel.join', channel: 'xt_AAAAAAAAAAAAAAAAAAAAAA' })).code, 'not_found');

  const joined = await b.ok<ChannelSnapshot>({ type: 'channel.join', channel: snap.channel.id });
  assert.deepEqual(joined.members.map(m => m.name).sort(), ['alice', 'bob']);
  assert.equal(a.events('member.joined').length, 1);
});

test('public channels are listed for discovery; private ones are not', async () => {
  const { agent } = setup();
  const a = agent('alice');
  const pub = await a.ok<ChannelSnapshot>({ type: 'channel.create', name: 'open', visibility: 'public' });
  await a.ok({ type: 'channel.create', name: 'secret' });

  const b = agent('bob');
  const listed = await b.ok({ type: 'channel.list', scope: 'public' });
  assert.deepEqual(listed.channels.map((c: any) => c.id), [pub.channel.id]);
  assert.equal((await b.ok({ type: 'channel.list' })).channels.length, 0, 'joined scope is empty for bob');
  assert.equal((await a.ok({ type: 'channel.list' })).channels.length, 2);
});

test('public listing paginates', async () => {
  const { agent } = setup();
  const a = agent('alice');
  for (let i = 0; i < 5; i++) await a.ok({ type: 'channel.create', name: `c${i}`, visibility: 'public' });
  const first = await a.ok({ type: 'channel.list', scope: 'public', limit: 2 });
  assert.equal(first.channels.length, 2);
  assert.ok(first.cursor);
  const rest = await a.ok({ type: 'channel.list', scope: 'public', limit: 10, cursor: first.cursor });
  assert.equal(rest.channels.length, 3);
  assert.equal(rest.cursor, undefined);
});

test('messages reach members of that channel only, and are not echoed to the sender', async () => {
  const { agent } = setup();
  const a = agent('alice');
  const b = agent('bob');
  const c = agent('carol');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  const other = (await c.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  await b.ok({ type: 'channel.join', channel: room });

  const sent = await a.ok({ type: 'message.send', channel: room, content: 'hello' });
  assert.equal(sent.from.name, 'alice');
  assert.equal(b.events('message').length, 1);
  assert.equal(b.events('message')[0].message.content, 'hello');
  assert.equal(a.events('message').length, 0);
  assert.equal(c.events('message').length, 0);

  assert.equal((await c.err({ type: 'message.send', channel: room, content: 'hi' })).code, 'not_member');
  assert.equal((await a.err({ type: 'message.send', channel: other, content: 'hi' })).code, 'not_member');
});

test('history is returned on join', async () => {
  const { agent } = setup();
  const a = agent('alice');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  await a.ok({ type: 'message.send', channel: room, content: 'one' });
  await a.ok({ type: 'message.send', channel: room, content: 'two' });
  const snap = await agent('bob').ok<ChannelSnapshot>({ type: 'channel.join', channel: room });
  assert.deepEqual(snap.messages.map(m => m.content), ['one', 'two']);
});

test('channels enforce a member cap', async () => {
  const { agent } = setup({ maxMembersPerChannel: 2 });
  const a = agent('a');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  await agent('b').ok({ type: 'channel.join', channel: room });
  const err = await agent('c').err({ type: 'channel.join', channel: room });
  assert.equal(err.code, 'quota_exceeded');
  assert.match(err.message, /full/);
});

test('DMs need a shared channel and resolve names within it', async () => {
  const { agent } = setup();
  const a = agent('alice');
  const b = agent('bob');
  const stranger = agent('mallory');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  await b.ok({ type: 'channel.join', channel: room });

  const dm = await a.ok({ type: 'dm.send', to: 'BOB', content: 'psst', replyExpected: false });
  assert.equal(dm.to.id, b.id);
  assert.equal(b.events('dm')[0].message.replyExpected, false);

  assert.equal((await stranger.err({ type: 'dm.send', to: a.id, content: 'hi' })).code, 'not_found');
  assert.equal((await a.err({ type: 'dm.send', to: 'mallory', content: 'hi' })).code, 'not_found');
});

test('locks: contention, holder notification, release and ownership', async () => {
  const { agent } = setup();
  const a = agent('alice');
  const b = agent('bob');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  await b.ok({ type: 'channel.join', channel: room });

  const lock = await a.ok({ type: 'lock.acquire', channel: room, file: './src/auth.ts', reason: 'jwt' });
  assert.equal(lock.file, 'src/auth.ts');
  assert.equal(b.events('lock.acquired').length, 1);

  const denied = await b.err({ type: 'lock.acquire', channel: room, file: 'src/auth.ts', reason: 'me too' });
  assert.equal(denied.code, 'lock_held');
  assert.equal(denied.details.holder.name, 'alice');
  assert.equal(a.events('lock.contended')[0].requester.name, 'bob');

  assert.equal((await b.err({ type: 'lock.release', channel: room, file: 'src/auth.ts' })).code, 'forbidden');
  await a.ok({ type: 'lock.release', channel: room, file: 'src/auth.ts' });
  assert.equal(b.events('lock.released')[0].reason, 'released');
  await b.ok({ type: 'lock.acquire', channel: room, file: 'src/auth.ts', reason: 'mine now' });
});

test('locks are scoped per channel', async () => {
  const { agent } = setup();
  const a = agent('alice');
  const b = agent('bob');
  const roomA = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  const roomB = (await b.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  await a.ok({ type: 'lock.acquire', channel: roomA, file: 'x.ts', reason: 'r' });
  await b.ok({ type: 'lock.acquire', channel: roomB, file: 'x.ts', reason: 'r' });
});

test('locks expire on sweep and members are told', async () => {
  const { hub, agent, tick } = setup();
  const a = agent('alice');
  const b = agent('bob');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  await b.ok({ type: 'channel.join', channel: room });
  await a.ok({ type: 'lock.acquire', channel: room, file: 'x.ts', reason: 'r', ttlSeconds: 10 });

  tick(11_000);
  hub.sweep();
  assert.equal(b.events('lock.released')[0].reason, 'expired');
});

test('disconnecting releases locks and announces departure', async () => {
  const { hub, agent } = setup();
  const a = agent('alice');
  const b = agent('bob');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  await b.ok({ type: 'channel.join', channel: room });
  await a.ok({ type: 'lock.acquire', channel: room, file: 'x.ts', reason: 'r' });

  hub.disconnect(a.conn);
  hub.disconnect(a.conn); // idempotent
  assert.equal(b.events('lock.released').length, 1);
  assert.equal(b.events('member.left')[0].reason, 'disconnected');
  await b.ok({ type: 'lock.acquire', channel: room, file: 'x.ts', reason: 'free now' });
});

test('empty channels expire: unused ones after a short grace period, used ones later', async () => {
  const { hub, agent, tick } = setup({ unusedChannelTtlMs: 1000, emptyChannelTtlMs: 5000 });
  const a = agent('alice');
  const unused = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  const used = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  await a.ok({ type: 'message.send', channel: used, content: 'keep me' });
  await a.ok({ type: 'channel.leave', channel: unused });
  await a.ok({ type: 'channel.leave', channel: used });

  tick(500);
  hub.sweep();
  await a.ok({ type: 'channel.join', channel: unused }); // still within grace: the address is shareable
  await a.ok({ type: 'channel.leave', channel: unused });

  tick(1500);
  hub.sweep();
  assert.equal((await a.err({ type: 'channel.join', channel: unused })).code, 'not_found');
  tick(5000);
  hub.sweep();
  assert.equal(hub.stats().channels, 0);
});

test('per-address caps stop one client from exhausting the hub', async () => {
  const { hub, agent } = setup({ maxConnectionsPerAddress: 2, maxChannelsPerAddress: 2 });
  const a = agent('a', '10.0.0.9');
  agent('b', '10.0.0.9');
  assert.throws(() => hub.connect({ send() {}, close() {} }, '10.0.0.9'), /Too many connections/);
  hub.connect({ send() {}, close() {} }, '10.0.0.10');

  await a.ok({ type: 'channel.create' });
  await a.ok({ type: 'channel.create' });
  assert.equal((await a.err({ type: 'channel.create' })).code, 'quota_exceeded');
});

test('rate limiting kicks in per connection', async () => {
  const { agent } = setup({ rateLimit: { burst: 3, perSecond: 0 } });
  const a = agent('a');
  for (let i = 0; i < 3; i++) await a.ok({ type: 'channel.list' });
  assert.equal((await a.err({ type: 'channel.list' })).code, 'rate_limited');
});

test('names are sanitized of control and invisible formatting characters', async () => {
  const { agent } = setup();
  const a = agent('ev‮il​\nname');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel;
  assert.equal(room.createdBy.name, 'ev il name');
});

test('requests before hello and malformed frames are rejected', async () => {
  const hub = new MeshHub();
  const inbox: ServerFrame[] = [];
  const conn = hub.connect({ send: f => inbox.push(f), close() {} });
  const res = await hub.request(conn, { id: '1', type: 'channel.list' });
  assert.equal(res.type === 'result' && !res.ok && res.error.code, 'not_registered');
  await hub.receive(conn, '{nope');
  assert.equal(inbox[0].type, 'error');
  assert.throws(() => hub.hello(conn, { type: 'hello', protocol: 1, agent: { name: 'x' } }), /protocol/);
});

test('shorthand !LCK / !REL drive real locks', async () => {
  const { agent } = setup();
  const a = agent('alice');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  const msg = await a.ok({ type: 'shorthand.send', channel: room, shorthand: '!LCK @src/db.ts #MIG "schema" &WAIT' });
  assert.equal(msg.kind, 'shorthand');
  assert.match(msg.content, /src\/db\.ts/);
  const state = await a.ok<ChannelSnapshot>({ type: 'channel.state', channel: room });
  assert.equal(state.locks[0].file, 'src/db.ts');
  await a.ok({ type: 'shorthand.send', channel: room, shorthand: '!REL @src/db.ts &DONE' });
  assert.equal((await a.ok<ChannelSnapshot>({ type: 'channel.state', channel: room })).locks.length, 0);
});

test('LockManager normalizes paths and clamps TTLs', () => {
  assert.equal(LockManager.normalizePath('./a//b/../c.ts'), 'a/c.ts');
  assert.equal(LockManager.normalizePath('a\\b.ts'), 'a/b.ts');
  assert.equal(LockManager.normalizePath('  '), '');
  const locks = new LockManager();
  assert.equal(locks.clampTtl(1), 5);
  assert.equal(locks.clampTtl(99_999), 1800);
  assert.equal(locks.clampTtl(undefined), 300);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshHub, type Connection } from '../src/server/hub.js';
import { PROTOCOL_VERSION, type ChannelSnapshot, type ServerFrame } from '../src/protocol.js';

/** A hub driven by in-memory peers, with a controllable clock. */
function setup() {
  let clock = 1_000_000;
  const hub = new MeshHub({ now: () => clock });
  let seq = 0;

  const agent = (name: string, role?: string) => {
    const inbox: ServerFrame[] = [];
    const conn: Connection = hub.connect({ send: f => inbox.push(f), close: () => {} }, '10.0.0.1');
    const welcome = hub.hello(conn, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name, role } });
    const call = async (frame: Record<string, unknown>) => {
      const res = await hub.request(conn, { id: String(++seq), ...frame });
      assert.equal(res.type, 'result');
      return res as any;
    };
    const ok = async <T = any>(frame: Record<string, unknown>): Promise<T> => {
      const res = await call(frame);
      assert.ok(res.ok, `expected ok, got ${JSON.stringify(res)}`);
      return res.data;
    };
    const err = async (frame: Record<string, unknown>) => {
      const res = await call(frame);
      assert.equal(res.ok, false, `expected an error, got ${JSON.stringify(res)}`);
      return res.error as { code: string; message: string; details?: any };
    };
    const events = (type?: string) => inbox.filter(f => !type || f.type === type) as any[];
    return { conn, id: welcome.agent.id, name, ok, err, events };
  };

  return { hub, agent, tick: (ms: number) => (clock += ms) };
}

test('lock.wait: a free lock is granted at once; a held one queues and is granted in order on release', async () => {
  const { agent } = setup();
  const a = agent('alice');
  const b = agent('bob');
  const c = agent('carol');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  await b.ok({ type: 'channel.join', channel: room });
  await c.ok({ type: 'channel.join', channel: room });

  const first = await a.ok({ type: 'lock.wait', channel: room, file: 'package.json', reason: 'deps' });
  assert.equal(first.granted.holder.name, 'alice');

  const bob = await b.ok({ type: 'lock.wait', channel: room, file: './package.json', reason: 'add zod' });
  assert.deepEqual([bob.queued, bob.position, bob.lock.holder.name], [true, 1, 'alice']);
  assert.equal((await c.ok({ type: 'lock.wait', channel: room, file: 'package.json', reason: 'scripts' })).position, 2);
  // Asking again keeps your place.
  assert.equal((await b.ok({ type: 'lock.wait', channel: room, file: 'package.json', reason: 'add zod v4' })).position, 1);
  assert.equal(a.events('lock.contended').length, 3);
  // A plain acquire by someone else doesn't jump the queue while it's held.
  assert.equal((await c.err({ type: 'lock.acquire', channel: room, file: 'package.json', reason: 'x' })).code, 'lock_held');

  await a.ok({ type: 'lock.release', channel: room, file: 'package.json' });
  const granted = b.events('lock.granted');
  assert.equal(granted.length, 1);
  assert.equal(granted[0].lock.holder.name, 'bob');
  assert.equal(granted[0].lock.reason, 'add zod v4');
  assert.equal(c.events('lock.granted').length, 0);
  assert.equal(c.events('lock.acquired').at(-1).lock.holder.name, 'bob');
  assert.equal(b.events('lock.acquired').length, 1, "the waiter isn't also sent lock.acquired for its own grant");

  await b.ok({ type: 'lock.release', channel: room, file: 'package.json' });
  assert.equal(c.events('lock.granted')[0].lock.holder.name, 'carol');
});

test('lock.wait: expiry grants the next waiter; leaving, disconnecting or releasing drops your place', async () => {
  const { hub, agent, tick } = setup();
  const a = agent('alice');
  const b = agent('bob');
  const c = agent('carol');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  await b.ok({ type: 'channel.join', channel: room });
  await c.ok({ type: 'channel.join', channel: room });
  await a.ok({ type: 'lock.acquire', channel: room, file: 'x.ts', reason: 'r', ttlSeconds: 10 });
  await b.ok({ type: 'lock.wait', channel: room, file: 'x.ts', reason: 'b' });
  await c.ok({ type: 'lock.wait', channel: room, file: 'x.ts', reason: 'c' });

  // Bob gives up his place: not released (he held nothing), but dequeued.
  assert.deepEqual(await b.ok({ type: 'lock.release', channel: room, file: 'x.ts' }), { channel: room, file: 'x.ts', released: false, dequeued: true });
  assert.equal((await b.ok({ type: 'lock.wait', channel: room, file: 'x.ts', reason: 'b again' })).position, 2);

  // Carol disconnects for good, so the expired lock skips her and goes to Bob.
  hub.disconnect(c.conn);
  tick(11_000);
  hub.sweep();
  assert.equal(b.events('lock.granted')[0].lock.holder.name, 'bob');
  assert.equal(c.events('lock.granted').length, 0);

  // Alice queues behind Bob, then leaves the channel; Bob's release frees the file for no one.
  await a.ok({ type: 'lock.wait', channel: room, file: 'x.ts', reason: 'again' });
  await a.ok({ type: 'channel.leave', channel: room });
  await b.ok({ type: 'lock.release', channel: room, file: 'x.ts' });
  assert.equal(a.events('lock.granted').length, 0);
  assert.equal(hub.checkLock(room, 'x.ts')?.locked, false);
});

test('lock.wait: a lock that lapsed between sweeps still goes to the first waiter, not a newcomer', async () => {
  const { agent, tick } = setup();
  const a = agent('alice');
  const b = agent('bob');
  const c = agent('carol');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  await b.ok({ type: 'channel.join', channel: room });
  await c.ok({ type: 'channel.join', channel: room });
  await a.ok({ type: 'lock.acquire', channel: room, file: 'x.ts', reason: 'r', ttlSeconds: 10 });
  await b.ok({ type: 'lock.wait', channel: room, file: 'x.ts', reason: 'b' });

  tick(11_000); // expired, no sweep yet
  assert.equal((await c.err({ type: 'lock.acquire', channel: room, file: 'x.ts', reason: 'c' })).details.holder.name, 'bob');
  assert.equal(b.events('lock.granted').length, 1);
});

test('lock holder connections (role "locks") hold locks under the agent\'s name but are not members', async () => {
  const { hub, agent } = setup();
  const a = agent('alice');
  const gemini = agent('gemini');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  await gemini.ok({ type: 'channel.join', channel: room });
  const joinedBefore = a.events('member.joined').length;

  const holder = agent('gemini', 'locks');
  const snap = await holder.ok<ChannelSnapshot>({ type: 'channel.join', channel: room });
  assert.equal(a.events('member.joined').length, joinedBefore, 'no join announcement');
  assert.deepEqual(snap.members.map(m => m.name).sort(), ['alice', 'gemini']);
  assert.equal(snap.channel.memberCount, 2);
  assert.equal(snap.attention.length, 2);

  await holder.ok({ type: 'lock.acquire', channel: room, file: 'src/db.ts', reason: 'schema' });
  const state = await a.ok<ChannelSnapshot>({ type: 'channel.state', channel: room });
  assert.deepEqual(state.locks.map(l => [l.file, l.holder.name]), [['src/db.ts', 'gemini']]);
  assert.equal(state.members.length, 2);

  // Status changes and @mentions stay with the real agent; DMs by name reach it, not its holder.
  await holder.ok({ type: 'status.update', status: 'working' });
  assert.equal(a.events('member.updated').length, 0);
  const msg = await a.ok({ type: 'message.send', channel: room, content: '@gemini ping' });
  assert.deepEqual(msg.mentions.map((m: any) => m.id), [gemini.id]);
  const dm = await a.ok({ type: 'dm.send', to: 'gemini', content: 'hi' });
  assert.equal(dm.to.id, gemini.id);

  hub.disconnect(holder.conn);
  assert.equal(a.events('member.left').length, 0, 'no leave announcement');
  assert.equal(a.events('lock.released').at(-1).file, 'src/db.ts', 'its locks go with it, and that is announced');
});

test('lock check reports how long it has been held, whether the holder is around, and the queue', async () => {
  const { hub, agent, tick } = setup();
  const a = agent('alice');
  const b = agent('bob');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  await b.ok({ type: 'channel.join', channel: room });
  assert.deepEqual(hub.checkLock(room, 'app/products/[handle]/route.ts'), { locked: false });

  await a.ok({ type: 'lock.acquire', channel: room, file: 'app/products/[handle]/route.ts', reason: 'routes', ttlSeconds: 600 });
  tick(90_000);
  await b.ok({ type: 'lock.wait', channel: room, file: 'app/products/[handle]/route.ts', reason: 'next' });
  const check = hub.checkLock(room, './app/products/[handle]/route.ts');
  assert.ok(check?.locked);
  assert.equal(check.heldForMs, 90_000);
  assert.equal(check.holderConnected, true);
  assert.equal(typeof check.holderLastSeenAt, 'number');
  assert.equal(check.waiting, 1);
});

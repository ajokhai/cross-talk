import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshHub, type Connection } from '../src/server/hub.js';
import { PROTOCOL_VERSION, type ChannelSnapshot, type ServerFrame } from '../src/protocol.js';

/** A hub driven by in-memory peers, with a controllable clock. */
function setup(hub = new MeshHub({ now: () => clock.t })) {
  let seq = 0;
  const agent = (name: string) => {
    const inbox: ServerFrame[] = [];
    const conn: Connection = hub.connect({ send: f => inbox.push(f), close: () => {} }, '10.0.0.1');
    const welcome = hub.hello(conn, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name } });
    const call = async (frame: Record<string, unknown>) => (await hub.request(conn, { id: String(++seq), ...frame })) as any;
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
    return { conn, id: welcome.agent.id, resumeToken: welcome.resumeToken!, ok, err, events };
  };
  return { hub, agent };
}
const clock = { t: 1_000_000 };

test('slots: capacity places are granted, the rest queue and are granted in order', async () => {
  const { agent } = setup();
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(n => agent(n));
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  for (const x of [b, c, d]) await x.ok({ type: 'channel.join', channel: room });

  const one = await a.ok({ type: 'slot.acquire', channel: room, name: 'heavy', capacity: 2 });
  assert.deepEqual([one.granted.capacity, one.granted.holders.length], [2, 1]);
  assert.ok((await b.ok({ type: 'slot.acquire', channel: room, name: 'heavy', capacity: 2 })).granted);
  const queued = await c.ok({ type: 'slot.acquire', channel: room, name: 'heavy', capacity: 2 });
  assert.deepEqual([queued.queued, queued.position, queued.slot.waiting], [true, 1, 1]);
  assert.equal((await d.ok({ type: 'slot.acquire', channel: room, name: 'heavy', capacity: 1 })).position, 2, 'asking for less is fine');

  // Asking for more than the first holder set is refused.
  const more = await d.err({ type: 'slot.acquire', channel: room, name: 'heavy', capacity: 3 });
  assert.equal(more.code, 'bad_request');
  assert.equal(more.details.capacity, 2);

  // Renewing a place you hold doesn't take a second one.
  assert.equal((await a.ok({ type: 'slot.acquire', channel: room, name: 'heavy', capacity: 2 })).granted.holders.length, 2);

  assert.deepEqual(await a.ok({ type: 'slot.release', channel: room, name: 'heavy' }), { channel: room, name: 'heavy', released: true });
  assert.equal(c.events('slot.granted').length, 1);
  assert.deepEqual(c.events('slot.granted')[0].slot.holders.map((h: any) => h.holder.name).sort(), ['b', 'c']);
  assert.equal(d.events('slot.granted').length, 0);
  assert.ok(d.events('slot.updated').length > 0);

  // d gives up its place in the queue.
  assert.deepEqual(await d.ok({ type: 'slot.release', channel: room, name: 'heavy' }), { channel: room, name: 'heavy', released: false, dequeued: true });
  const state = await a.ok<ChannelSnapshot>({ type: 'channel.state', channel: room });
  assert.deepEqual(state.slots!.map(s => [s.name, s.holders.length, s.waiting]), [['heavy', 2, 0]]);
});

test('slots: places expire on sweep and go with an agent that leaves; idle slots reset their capacity', async () => {
  const { hub, agent } = setup();
  const a = agent('a');
  const b = agent('b');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  await b.ok({ type: 'channel.join', channel: room });

  await a.ok({ type: 'slot.acquire', channel: room, name: 'db', capacity: 1, ttlSeconds: 10 });
  await b.ok({ type: 'slot.acquire', channel: room, name: 'db', capacity: 1 });
  clock.t += 11_000;
  hub.sweep();
  assert.equal(b.events('slot.granted')[0].slot.holders[0].holder.name, 'b');

  await a.ok({ type: 'slot.acquire', channel: room, name: 'db', capacity: 1 });
  hub.disconnect(b.conn);
  assert.equal(a.events('slot.granted').length, 1, "b's place went to a when b left");

  await a.ok({ type: 'slot.release', channel: room, name: 'db' });
  assert.deepEqual((await a.ok<ChannelSnapshot>({ type: 'channel.state', channel: room })).slots, []);
  assert.equal((await a.ok({ type: 'slot.acquire', channel: room, name: 'db', capacity: 4 })).granted.capacity, 4);
});

test('slots: bad names and capacities are refused', async () => {
  const { agent } = setup();
  const a = agent('a');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  for (const bad of [{ name: '', capacity: 1 }, { name: 'a b', capacity: 1 }, { name: 'x', capacity: 0 }, { name: 'x', capacity: 1.5 }, { name: 'x', capacity: 65 }]) {
    assert.equal((await a.err({ type: 'slot.acquire', channel: room, ...bad })).code, 'bad_request', JSON.stringify(bad));
  }
  assert.deepEqual(await a.ok({ type: 'slot.release', channel: room, name: 'nothing' }), { channel: room, name: 'nothing', released: false });
});

test('slots: places held when the hub saves its state come back for agents that resume', async () => {
  const first = new MeshHub({ now: () => clock.t });
  const { agent } = setup(first);
  const a = agent('a');
  const room = (await a.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  await a.ok({ type: 'slot.acquire', channel: room, name: 'heavy', capacity: 2, ttlSeconds: 600 });

  const state = JSON.parse(JSON.stringify(first.exportState()));
  const second = new MeshHub({ now: () => clock.t });
  second.restoreState(state, 60_000);
  const snap = second.snapshotByAddress(room)!;
  assert.deepEqual(snap.slots!.map(s => [s.name, s.capacity, s.holders.map(h => h.holder.id)]), [['heavy', 2, [a.id]]]);
});

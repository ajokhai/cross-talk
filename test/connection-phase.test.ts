import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshHub, type Connection } from '../src/server/hub.js';
import { PROTOCOL_VERSION, type ServerFrame } from '../src/protocol.js';

function setup(options: ConstructorParameters<typeof MeshHub>[0] = {}) {
  let clock = 1_000_000;
  const hub = new MeshHub({ now: () => clock, ...options });
  const open = (address = '10.0.0.1') => {
    const inbox: ServerFrame[] = [];
    const conn: Connection = hub.connect({ send: f => inbox.push(f), close: () => {} }, address);
    return { conn, inbox };
  };
  const hello = (conn: Connection, name: string, resume?: string) =>
    hub.hello(conn, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name }, ...(resume ? { resume } : {}) });
  return { hub, open, hello, tick: (ms: number) => (clock += ms) };
}

test('phases: pending → live → parked → live (resumed on a new connection) → closed', async () => {
  const { hub, open, hello } = setup();
  const a = open();
  assert.equal(a.conn.phase, 'pending');
  const welcome = hello(a.conn, 'alice');
  assert.equal(a.conn.phase, 'live');
  hub.drop(a.conn);
  assert.equal(a.conn.phase, 'parked');
  assert.ok(a.conn.droppedAt !== undefined);
  const b = open();
  hello(b.conn, 'alice', welcome.resumeToken);
  assert.equal(b.conn.phase, 'live');
  assert.equal(a.conn.phase, 'closed', 'the old connection is finished once resumed elsewhere');
  assert.equal(a.conn.droppedAt, undefined);
  hub.disconnect(b.conn);
  assert.equal(b.conn.phase, 'closed');
  hub.disconnect(b.conn); // safe twice
});

test('disconnecting a parked agent removes it at once (it used to wait out the grace period)', async () => {
  const { hub, open, hello } = setup();
  const a = open();
  hello(a.conn, 'alice');
  const b = open();
  hello(b.conn, 'bob');
  const created: any = await hub.request(a.conn, { id: '1', type: 'channel.create', name: 'x' });
  await hub.request(b.conn, { id: '2', type: 'channel.join', channel: created.data.channel.id });
  hub.drop(b.conn);
  assert.equal(b.conn.phase, 'parked');
  hub.disconnect(b.conn);
  assert.equal(b.conn.phase, 'closed');
  assert.ok(a.inbox.some(f => f.type === 'member.left' && f.agent.name === 'bob'), 'members see bob leave now');
});

test('per-address slots are freed exactly once across drop, resume and close', () => {
  const { hub, open, hello } = setup({ maxConnectionsPerAddress: 1 });
  const a = open();
  const welcome = hello(a.conn, 'alice');
  assert.throws(() => open(), /connections/i, 'the one slot is taken');
  hub.drop(a.conn); // parked: the slot is free for the reconnect
  const b = open();
  hello(b.conn, 'alice', welcome.resumeToken);
  assert.throws(() => open(), /connections/i, 'the resumed connection holds the slot');
  hub.disconnect(b.conn);
  hub.disconnect(a.conn); // already closed: must not free a second time
  const c = open();
  assert.equal(c.conn.phase, 'pending');
  assert.throws(() => open(), /connections/i, 'still exactly one slot');
});

test('a closed connection cannot register again', () => {
  const { hub, open, hello } = setup();
  const a = open();
  hub.disconnect(a.conn);
  assert.equal(a.conn.phase, 'closed');
  assert.throws(() => hello(a.conn, 'late'), /closed/);
});

test('a parked agent left past its grace period is evicted by the sweep', () => {
  const { hub, open, hello, tick } = setup({ presenceGraceMs: 1000 });
  const a = open();
  hello(a.conn, 'alice');
  hub.drop(a.conn);
  tick(999);
  hub.sweep();
  assert.equal(a.conn.phase, 'parked');
  tick(2);
  hub.sweep();
  assert.equal(a.conn.phase, 'closed');
});

test('restoring state closes claims and questions of agents that did not come back', async () => {
  const { MeshHub: Hub } = await import('../src/server/hub.js');
  const first = new Hub();
  const conn = (name: string) => {
    const c = first.connect({ send: () => {}, close: () => {} }, '10.0.0.1');
    first.hello(c, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name } });
    return c;
  };
  const a = conn('alice');
  const b = conn('bob');
  const created: any = await first.request(a, { id: '1', type: 'channel.create', name: 'r' });
  const channel = created.data.channel.id;
  await first.request(b, { id: '2', type: 'channel.join', channel });
  await first.request(b, { id: '3', type: 'claim.create', channel, task: 'bob task' });
  await first.request(b, { id: '4', type: 'question.ask', channel, question: 'bob asks?' });
  const state: any = first.exportState();
  // Bob's saved agent doesn't come back (as when its only channel is gone or its invite died).
  state.agents = state.agents.filter((x: any) => x.agent.name !== 'bob');
  const second = new Hub();
  second.restoreState(state);
  const c2 = second.connect({ send: () => {}, close: () => {} }, '10.0.0.2');
  second.hello(c2, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name: 'carol' } });
  const snap: any = await second.request(c2, { id: '5', type: 'channel.join', channel });
  assert.equal(snap.data.claims.length, 0, 'bob\'s claim is not left to stall forever');
  assert.equal(snap.data.questions.length, 0, 'bob\'s question is not left open forever');
});

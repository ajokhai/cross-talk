import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshHub, type Connection } from '../src/server/hub.js';
import { startServer } from '../src/server/index.js';
import { PROTOCOL_VERSION, type ChannelSnapshot, type ServerFrame } from '../src/protocol.js';

/**
 * Stale same-name members. Every `crosstalk send`, `history` or `wait` run
 * that doesn't log out leaves an HTTP session behind under the same name. The
 * hub retires such leftovers when the client shows up again under that name
 * (a join, or a listener starting) from the same address, and never announces
 * a leftover as "not listening" while its twin is here.
 */
function setup(options: ConstructorParameters<typeof MeshHub>[0] = {}) {
  let clock = 1_000_000;
  const hub = new MeshHub({ now: () => clock, ...options });
  let seq = 0;

  const agent = (name: string, opts: { address?: string; transport?: 'http' } = {}) => {
    const inbox: ServerFrame[] = [];
    let closed = 0;
    const conn: Connection = hub.connect({ send: f => inbox.push(f), close: () => void closed++ }, opts.address ?? '10.0.0.1', { transport: opts.transport });
    const welcome = hub.hello(conn, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name } });
    const ok = async <T = any>(frame: Record<string, unknown>): Promise<T> => {
      const res = await hub.request(conn, { id: String(++seq), ...frame });
      assert.ok(res.type === 'result' && res.ok, `expected ok, got ${JSON.stringify(res)}`);
      return (res as any).data;
    };
    const err = async (frame: Record<string, unknown>) => {
      const res = await hub.request(conn, { id: String(++seq), ...frame });
      assert.ok(res.type === 'result' && !res.ok, `expected an error, got ${JSON.stringify(res)}`);
      return (res as any).error as { code: string; message: string };
    };
    return { conn, id: welcome.agent.id, ok, err, inbox, get closed() { return closed; } };
  };
  const members = async (who: ReturnType<typeof agent>, channel: string) =>
    ((await who.ok<ChannelSnapshot>({ type: 'channel.state', channel })).members.map(m => m.id) as string[]).sort();

  return { hub, agent, members, tick: (ms: number) => (clock += ms) };
}

test('a one-shot HTTP session is retired when its name joins again from the same address', async () => {
  const { agent, members, tick } = setup();
  const old = agent('alice', { transport: 'http' });
  const bob = agent('bob', { transport: 'http' });
  const channel = (await old.ok<ChannelSnapshot>({ type: 'channel.create', name: 'x' })).channel.id;
  await bob.ok({ type: 'channel.join', channel });
  tick(11_000); // quiet for longer than retireTwinsAfterMs

  const fresh = agent('alice', { transport: 'http' });
  await fresh.ok({ type: 'channel.join', channel });

  assert.deepEqual(await members(fresh, channel), [bob.id, fresh.id].sort(), 'only the new alice is a member');
  assert.equal(old.conn.phase, 'closed');
  assert.equal(old.closed, 1, 'its HTTP session was closed, so its token stops working');
  assert.equal((await old.err({ type: 'channel.state', channel })).code, 'not_registered');
  const left = bob.inbox.filter(f => f.type === 'member.left') as any[];
  assert.deepEqual(left.map(f => [f.agent.id, f.reason]), [[old.id, 'disconnected']]);
  assert.equal(fresh.inbox.filter(f => f.type === 'member.left').length, 1, 'the newcomer sees it go too');
});

test('kept: a different address, a name that differs, too recent, a WebSocket twin, or holding a lock', async () => {
  const { agent, members, tick } = setup();
  const creator = agent('carol');
  const channel = (await creator.ok<ChannelSnapshot>({ type: 'channel.create', name: 'x' })).channel.id;

  const elsewhere = agent('alice', { transport: 'http', address: '10.0.0.2' });
  await elsewhere.ok({ type: 'channel.join', channel });
  const other = agent('alicia', { transport: 'http' });
  await other.ok({ type: 'channel.join', channel });
  const socket = agent('alice'); // no transport: a WebSocket client, as present as its socket
  await socket.ok({ type: 'channel.join', channel });
  const locking = agent('alice', { transport: 'http' });
  await locking.ok({ type: 'channel.join', channel });
  await locking.ok({ type: 'lock.acquire', channel, file: 'src/a.ts', reason: 'editing' });
  const recent = agent('alice', { transport: 'http' });
  tick(11_000);
  await recent.ok({ type: 'channel.join', channel });
  tick(2_000); // recent has been quiet 2s, under the 10s threshold

  const fresh = agent('alice', { transport: 'http' });
  await fresh.ok({ type: 'channel.join', channel });

  assert.deepEqual(await members(fresh, channel), [creator.id, elsewhere.id, other.id, socket.id, locking.id, recent.id, fresh.id].sort());
});

test('a listener that starts polling retires the leftover it replaces', async () => {
  const { hub, agent, members, tick } = setup();
  const old = agent('alice', { transport: 'http' });
  const channel = (await old.ok<ChannelSnapshot>({ type: 'channel.create', name: 'x' })).channel.id;
  const fresh = agent('alice', { transport: 'http' });
  await fresh.ok({ type: 'channel.join', channel });
  assert.deepEqual(await members(fresh, channel), [old.id, fresh.id].sort(), 'both kept: the old one was heard from a moment ago');

  tick(11_000);
  hub.pollStarted(fresh.conn);
  assert.deepEqual(await members(fresh, channel), [fresh.id]);
  assert.equal(old.conn.phase, 'closed');
});

test('a polling session is never retired, and a leftover that still polls is kept', async () => {
  const { hub, agent, members, tick } = setup();
  const listener = agent('alice', { transport: 'http' });
  const channel = (await listener.ok<ChannelSnapshot>({ type: 'channel.create', name: 'x' })).channel.id;
  hub.pollStarted(listener.conn);
  tick(60_000);

  const sender = agent('alice', { transport: 'http' });
  await sender.ok({ type: 'channel.join', channel });
  assert.deepEqual(await members(sender, channel), [listener.id, sender.id].sort(), 'the listener has a poll open');

  hub.pollEnded(listener.conn);
  tick(11_000);
  hub.pollStarted(listener.conn); // its next poll: now the sender's run is the leftover
  assert.deepEqual(await members(listener, channel), [listener.id]);
});

test('the sweep retires a dead listener quietly while its twin listens, and still announces one with no twin', async () => {
  const { hub, agent, members, tick } = setup({ listenerGraceMs: 5 * 60_000 });
  const dead = agent('alice', { transport: 'http' });
  const channel = (await dead.ok<ChannelSnapshot>({ type: 'channel.create', name: 'x' })).channel.id;
  const bob = agent('bob', { transport: 'http' });
  await bob.ok({ type: 'channel.join', channel });
  hub.pollStarted(dead.conn);
  hub.pollStarted(bob.conn);
  hub.pollEnded(dead.conn); // the process was killed
  hub.pollEnded(bob.conn);
  tick(1_000);
  const live = agent('alice', { transport: 'http' });
  await live.ok({ type: 'channel.join', channel }); // too soon to retire `dead`
  hub.pollStarted(live.conn);
  assert.deepEqual(await members(live, channel), [dead.id, bob.id, live.id].sort());

  tick(5 * 60_000);
  hub.sweep();

  assert.deepEqual(await members(live, channel), [bob.id, live.id].sort());
  const notices = (await live.ok<ChannelSnapshot>({ type: 'channel.state', channel })).messages
    .filter((m: any) => m.kind === 'notice' && m.content.includes('has not been listening'))
    .map((m: any) => m.content);
  assert.equal(notices.length, 1, `only bob is announced, got: ${notices.join(' | ')}`);
  assert.match(notices[0], /^bob has not been listening/);
});

test('retireTwinsAfterMs: 0 keeps every session', async () => {
  const { agent, members, tick } = setup({ retireTwinsAfterMs: 0 });
  const old = agent('alice', { transport: 'http' });
  const channel = (await old.ok<ChannelSnapshot>({ type: 'channel.create', name: 'x' })).channel.id;
  tick(60_000);
  const fresh = agent('alice', { transport: 'http' });
  await fresh.ok({ type: 'channel.join', channel });
  assert.deepEqual(await members(fresh, channel), [old.id, fresh.id].sort());
});

test('over HTTP: the retired run gets 401 on its next call, so the CLI registers afresh', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false, hub: { retireTwinsAfterMs: 50 } });
  const base = server.url.replace('ws://', 'http://');
  const post = async (path: string, body: unknown, session?: string) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(session ? { 'x-crosstalk-session': session } : {}) }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as any };
  };
  try {
    const first = (await post('/v1/sessions', { name: 'mcp-agent' })).body.session;
    const channel = (await post('/v1/rpc', { type: 'channel.create', name: 'x' }, first)).body.data.channel.id;
    await new Promise(r => setTimeout(r, 120));
    const second = (await post('/v1/sessions', { name: 'mcp-agent' })).body.session;
    const joined = await post('/v1/rpc', { type: 'channel.join', channel }, second);
    assert.equal(joined.status, 200);
    assert.deepEqual(joined.body.data.members.map((m: any) => m.name), ['mcp-agent'], 'one member under that name');

    const stale = await post('/v1/rpc', { type: 'channel.state', channel }, first);
    assert.equal(stale.status, 401);
    assert.equal(stale.body.error.code, 'not_registered');
  } finally {
    await server.close();
  }
});

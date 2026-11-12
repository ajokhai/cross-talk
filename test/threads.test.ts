import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshHub, type Connection } from '../src/server/hub.js';
import { PROTOCOL_VERSION, type ChannelSnapshot, type ServerFrame } from '../src/protocol.js';

function setup() {
  let clock = 1_000_000;
  const hub = new MeshHub({ now: () => clock });
  let seq = 0;
  const agent = (name: string, role?: string) => {
    const inbox: ServerFrame[] = [];
    const conn: Connection = hub.connect({ send: f => inbox.push(f), close: () => {} }, '10.0.0.1');
    const welcome = hub.hello(conn, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name, ...(role ? { role } : {}) } });
    const call = async (frame: Record<string, unknown>) => (await hub.request(conn, { id: String(++seq), ...frame })) as any;
    const ok = async <T = any>(frame: Record<string, unknown>): Promise<T> => {
      const res = await call(frame);
      assert.ok(res.ok, `expected ok, got ${JSON.stringify(res)}`);
      return res.data;
    };
    const err = async (frame: Record<string, unknown>) => {
      const res = await call(frame);
      assert.equal(res.ok, false);
      return res.error as { code: string };
    };
    const said = () => inbox.filter(f => f.type === 'message').map(f => (f as any).message.content as string);
    return { id: welcome.agent.id, ok, err, inbox, said };
  };
  return { hub, agent, tick: (ms: number) => (clock += ms) };
}

test('threads: a claim thread reaches its followers and people, not every agent', async () => {
  const { agent } = setup();
  const josh = agent('josh', 'person');
  const a = agent('ana');
  const b = agent('ben');
  const c = agent('cal');
  const room = (await josh.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  for (const x of [a, b, c]) await x.ok({ type: 'channel.join', channel: room });

  const claim = await a.ok({ type: 'claim.create', channel: room, task: 'fix login' });
  assert.deepEqual(claim.followers.map((f: any) => f.id), [a.id]);

  await a.ok({ type: 'message.send', channel: room, thread: claim.id, content: 'looking at the cookie' });
  assert.ok(josh.said().includes('looking at the cookie'), 'people see threads');
  assert.ok(!b.said().includes('looking at the cookie'), 'other agents do not');

  // A mention brings an agent into the thread; from then on it follows.
  await a.ok({ type: 'message.send', channel: room, thread: claim.id, content: '@ben can you check the test?' });
  assert.ok(b.said().includes('@ben can you check the test?'));
  await b.ok({ type: 'message.send', channel: room, thread: claim.id, content: 'passes now' });
  assert.ok(a.said().includes('passes now'));
  assert.ok(!c.said().some(t => t.includes('ben') || t === 'passes now'), 'cal saw none of it');

  // @all in a thread means its followers only.
  await a.ok({ type: 'message.send', channel: room, thread: claim.id, content: '@all merging' });
  assert.ok(!c.said().includes('@all merging'));

  // Progress on the one claim goes to the thread too.
  await a.ok({ type: 'claim.update', channel: room, note: 'pushed the fix' });
  assert.ok(!c.said().includes('pushed the fix'));
  assert.ok(b.said().includes('pushed the fix'));

  // Finishing posts one line to the whole channel, and the thread closes.
  await a.ok({ type: 'claim.update', channel: room, claim: claim.id, status: 'done', note: 'login works again' });
  assert.ok(c.said().includes('finished "fix login": login works again'));
  assert.equal((await a.err({ type: 'message.send', channel: room, thread: claim.id, content: 'late' })).code, 'not_found');

  // History keeps every thread message, tagged.
  const history = (await c.ok<ChannelSnapshot>({ type: 'channel.state', channel: room })).messages;
  assert.equal(history.filter(m => m.thread === claim.id).length, 5);
});

test('focus: the read filter keeps only mentions, people, own claims and locks on own paths', async () => {
  const { agent } = setup();
  const josh = agent('josh', 'person');
  const a = agent('ana');
  const f = agent('fay');
  const room = (await josh.ok<ChannelSnapshot>({ type: 'channel.create' })).channel.id;
  for (const x of [a, f]) await x.ok({ type: 'channel.join', channel: room });

  const me = await f.ok({ type: 'status.update', focus: true });
  assert.equal(me.focus, true);
  assert.equal((await f.err({ type: 'status.update', focus: 'yes' })).code, 'bad_request');
  await f.ok({ type: 'claim.create', channel: room, task: 'docs', paths: ['docs'] });
  f.inbox.length = 0;

  await a.ok({ type: 'message.send', channel: room, content: 'chatter' });
  await a.ok({ type: 'message.send', channel: room, content: '@fay ping' });
  await josh.ok({ type: 'message.send', channel: room, content: 'from a person' });
  await a.ok({ type: 'status.update', currentTask: 'busy' });
  await a.ok({ type: 'claim.create', channel: room, task: 'other' });
  await a.ok({ type: 'lock.acquire', channel: room, file: 'src/x.ts', reason: 'edit' });
  await a.ok({ type: 'lock.acquire', channel: room, file: 'docs/a.md', reason: 'edit' });

  assert.deepEqual(f.said(), ['@fay ping', 'from a person']);
  assert.ok(!f.inbox.some(e => e.type === 'member.updated'));
  assert.ok(!f.inbox.some(e => e.type === 'claim.updated'), "another agent's claim is not news");
  const locks = f.inbox.filter(e => e.type === 'lock.acquired').map(e => (e as any).lock.file);
  assert.deepEqual(locks, ['docs/a.md']);

  await f.ok({ type: 'status.update', focus: false });
  await a.ok({ type: 'message.send', channel: room, content: 'chatter again' });
  assert.ok(f.said().includes('chatter again'));
});

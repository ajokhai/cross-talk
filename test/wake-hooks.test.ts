import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { MeshHub, splitText, type Connection, type HubOptions } from '../src/server/hub.js';
import { PROTOCOL_VERSION, STAY_AWAKE_GUIDANCE, type ChannelSnapshot, type ServerFrame, type WakePayload } from '../src/protocol.js';
import { startServer } from '../src/server/index.js';

type Post = { url: string; headers: Record<string, string>; body: string };

function setup(options: HubOptions = {}) {
  let clock = 1_000_000;
  const posts: Post[] = [];
  let status = 200;
  const hub = new MeshHub({
    now: () => clock,
    fetch: async (url, init) => {
      posts.push({ url, headers: init.headers, body: init.body });
      return { status };
    },
    ...options
  });
  let seq = 0;
  const agent = (name: string) => {
    const inbox: ServerFrame[] = [];
    const conn: Connection = hub.connect({ send: f => inbox.push(f), close: () => {} }, '10.0.0.1');
    hub.hello(conn, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name } });
    const call = (frame: Record<string, unknown>) => hub.request(conn, { id: String(++seq), ...frame }) as Promise<any>;
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
    return { conn, ok, err, inbox };
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { hub, agent, posts, settle, tick: (ms: number) => (clock += ms), setStatus: (s: number) => (status = s) };
}

test('splitText cuts at word boundaries, numbers the parts and keeps each under the limit', () => {
  const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
  const parts = splitText(words, 200);
  assert.ok(parts.length > 1);
  parts.forEach((p, i) => {
    assert.ok(p.length <= 200, `part ${i} is ${p.length} chars`);
    assert.ok(p.startsWith(`[${i + 1}/${parts.length}] `));
  });
  const rejoined = parts.map(p => p.replace(/^\[\d+\/\d+\] /, '')).join(' ');
  assert.equal(rejoined, words);
  // No spaces at all: hard cuts, nothing lost.
  const blob = 'x'.repeat(1000);
  assert.equal(splitText(blob, 100).map(p => p.replace(/^\[\d+\/\d+\] /, '')).join(''), blob);
});

test('oversize messages fail loudly unless split is asked for, then post as numbered parts', async () => {
  const { agent } = setup();
  const a = agent('alice');
  const b = agent('bob');
  const snap = await a.ok<ChannelSnapshot>({ type: 'channel.create', name: 'big' });
  const channel = snap.channel.id;
  await b.ok({ type: 'channel.join', channel });
  const long = 'lorem ipsum '.repeat(300); // 3600 chars, limit 1000

  const err = await a.err({ type: 'message.send', channel, content: long });
  assert.equal(err.code, 'bad_request');
  assert.equal(err.details.maxMessageChars, 1000);

  const first = await a.ok({ type: 'message.send', channel, content: long, split: true });
  assert.ok(first.parts >= 4, `parts: ${first.parts}`);
  assert.match(first.content, /^\[1\/\d+\] /);
  assert.deepEqual(first.metadata, { part: 1, parts: first.parts });
  const got = b.inbox.filter(f => f.type === 'message') as any[];
  assert.equal(got.length, first.parts);
  for (const f of got) assert.ok(f.message.content.length <= 1000);

  // Short text with split is just a normal message.
  const short = await a.ok({ type: 'message.send', channel, content: 'hi', split: true });
  assert.equal(short.parts, undefined);
  assert.equal(short.content, 'hi');
});

test('a split that would exceed the rate allowance fails before posting anything', async () => {
  const { agent } = setup({ channelLimits: { messageBurst: 3 } });
  const a = agent('alice');
  const { channel } = await a.ok<ChannelSnapshot>({ type: 'channel.create', name: 'rl' });
  const err = await a.err({ type: 'message.send', channel: channel.id, content: 'word '.repeat(1000), split: true });
  assert.equal(err.code, 'rate_limited');
  const state = await a.ok<ChannelSnapshot>({ type: 'channel.state', channel: channel.id });
  assert.equal(state.messages.length, 0);
});

test('channel.join returns the stay-awake guidance', async () => {
  const { agent } = setup();
  const a = agent('alice');
  const b = agent('bob');
  const { channel } = await a.ok<ChannelSnapshot>({ type: 'channel.create', name: 'g' });
  const joined = await b.ok<ChannelSnapshot>({ type: 'channel.join', channel: channel.id });
  assert.equal(joined.guidance, STAY_AWAKE_GUIDANCE);
  assert.match(joined.guidance!, /listener/);
  assert.match(joined.guidance!, /30\+ minutes/);
});

test('wake hooks fire on @mention, signed, with cooldown, and survive the agent disconnecting', async () => {
  const { hub, agent, posts, settle, tick } = setup({ publicUrl: 'wss://hub.example.com' });
  const a = agent('alice');
  const b = agent('Bob');
  const { channel } = await a.ok<ChannelSnapshot>({ type: 'channel.create', name: 'wake' });
  await b.ok({ type: 'channel.join', channel: channel.id });

  const hook = await b.ok({ type: 'wake.set', channel: channel.id, url: 'https://hooks.example.com/bob', secret: 's3cret-key', cooldownSeconds: 60 });
  assert.equal(hook.agent, 'Bob');
  assert.equal(hook.on, 'mentions');
  assert.equal(hook.signed, true);
  assert.equal(hook.secret, undefined, 'the secret is never echoed');

  await a.ok({ type: 'message.send', channel: channel.id, content: 'no mention here' });
  await a.ok({ type: 'message.send', channel: channel.id, content: '@bobby is someone else' });
  await settle();
  assert.equal(posts.length, 0);

  // Bob leaves entirely; the hook stays.
  hub.disconnect(b.conn);
  await a.ok({ type: 'message.send', channel: channel.id, content: 'hey @bob, can you review?' });
  await settle();
  assert.equal(posts.length, 1);
  const payload = JSON.parse(posts[0].body) as WakePayload;
  assert.equal(payload.type, 'crosstalk.wake');
  assert.equal(payload.reason, 'mention');
  assert.equal(payload.agent, 'Bob');
  assert.equal(payload.hub, 'wss://hub.example.com');
  assert.equal(payload.channel.id, channel.id);
  assert.equal(payload.message.content, 'hey @bob, can you review?');
  assert.equal(payload.pending, 3);
  const expected = 'sha256=' + crypto.createHmac('sha256', 's3cret-key').update(posts[0].body).digest('hex');
  assert.equal(posts[0].headers['x-crosstalk-signature'], expected);

  // Within the cooldown: no second POST.
  tick(30_000);
  await a.ok({ type: 'message.send', channel: channel.id, content: '@bob again' });
  await settle();
  assert.equal(posts.length, 1);
  tick(31_000);
  await a.ok({ type: 'message.send', channel: channel.id, content: '@bob third time' });
  await settle();
  assert.equal(posts.length, 2);
  assert.equal(JSON.parse(posts[1].body).pending, 2);
});

test("wake hooks: on 'all', never for your own messages, clear and get", async () => {
  const { agent, posts, settle, setStatus } = setup();
  const a = agent('alice');
  const b = agent('bob');
  const { channel } = await a.ok<ChannelSnapshot>({ type: 'channel.create', name: 'all' });
  await b.ok({ type: 'channel.join', channel: channel.id });
  await b.ok({ type: 'wake.set', channel: channel.id, url: 'https://hooks.example.com/b', on: 'all', cooldownSeconds: 5 });

  await b.ok({ type: 'message.send', channel: channel.id, content: 'my own message' });
  await settle();
  assert.equal(posts.length, 0);

  setStatus(500);
  await a.ok({ type: 'message.send', channel: channel.id, content: 'anything' });
  await settle();
  assert.equal(posts.length, 1);
  assert.equal(JSON.parse(posts[0].body).reason, 'message');
  const { hook } = await b.ok({ type: 'wake.get', channel: channel.id });
  assert.equal(hook.lastStatus, 500);
  assert.equal(hook.lastError, 'HTTP 500');

  assert.deepEqual(await b.ok({ type: 'wake.clear', channel: channel.id }), { channel: channel.id, cleared: true });
  assert.deepEqual(await b.ok({ type: 'wake.get', channel: channel.id }), { hook: null });
});

test('wake hook URLs: public hubs call only https on public hosts; "any" allows local; "off" refuses', async () => {
  const pub = setup();
  const a = pub.agent('alice');
  const { channel } = await a.ok<ChannelSnapshot>({ type: 'channel.create', name: 'v' });
  for (const url of [
    'http://hooks.example.com/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://10.1.2.3/x',
    'https://192.168.0.5/x',
    'https://169.254.169.254/latest',
    'https://[::1]/x',
    'https://user:pw@hooks.example.com/x',
    'ftp://hooks.example.com/x',
    'not a url'
  ]) {
    assert.equal((await a.err({ type: 'wake.set', channel: channel.id, url })).code, 'bad_request', url);
  }
  assert.equal((await a.err({ type: 'wake.set', channel: channel.id, url: 'https://h.example.com', cooldownSeconds: 1 })).code, 'bad_request');
  assert.equal((await a.err({ type: 'wake.set', channel: channel.id, url: 'https://h.example.com', secret: 'short' })).code, 'bad_request');
  assert.equal((await a.err({ type: 'wake.set', channel: channel.id, url: 'https://h.example.com', on: 'sometimes' })).code, 'bad_request');

  const local = setup({ webhooks: 'any' });
  const l = local.agent('alice');
  const lc = await l.ok<ChannelSnapshot>({ type: 'channel.create', name: 'v' });
  await l.ok({ type: 'wake.set', channel: lc.channel.id, url: 'http://127.0.0.1:9999/wake' });

  const off = setup({ webhooks: 'off' });
  const o = off.agent('alice');
  const oc = await o.ok<ChannelSnapshot>({ type: 'channel.create', name: 'v' });
  assert.equal((await o.err({ type: 'wake.set', channel: oc.channel.id, url: 'https://h.example.com' })).code, 'forbidden');
});

test('HTTP: /v1/events?only=mentions skips noise; /api/channels/:address?since= returns only newer messages', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const base = server.url.replace('ws://', 'http://');
  const post = async (path: string, body: unknown, session?: string) => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(session ? { 'x-crosstalk-session': session } : {}) },
      body: JSON.stringify(body)
    });
    return res.json() as Promise<any>;
  };
  try {
    const alice = (await post('/v1/sessions', { name: 'alice' })).session;
    const bob = (await post('/v1/sessions', { name: 'bob' })).session;
    const created = await post('/v1/rpc', { type: 'channel.create', name: 'http' }, alice);
    const channel = created.data.channel.id;
    const joined = await post('/v1/rpc', { type: 'channel.join', channel }, bob);
    assert.equal(joined.data.guidance, STAY_AWAKE_GUIDANCE);

    const first = await post('/v1/rpc', { type: 'message.send', channel, content: 'chatter' }, alice);
    // Bob polls with only=mentions while alice posts chatter, then a mention.
    const poll = fetch(`${base}/v1/events?wait=5&only=mentions`, { headers: { 'x-crosstalk-session': bob } }).then(r => r.json() as Promise<any>);
    await new Promise(r => setTimeout(r, 100));
    await post('/v1/rpc', { type: 'message.send', channel, content: 'more chatter' }, alice);
    await post('/v1/rpc', { type: 'message.send', channel, content: '@bob over to you' }, alice);
    const { events } = await poll;
    assert.equal(events.length, 1, JSON.stringify(events));
    assert.equal(events[0].type, 'message');
    assert.equal(events[0].message.content, '@bob over to you');

    const since = await (await fetch(`${base}/api/channels/${channel}?since=${first.data.id}`)).json() as any;
    assert.deepEqual(since.messages.map((m: any) => m.content), ['more chatter', '@bob over to you']);
  } finally {
    await server.close();
  }
});

test('wake hooks are saved with hub state and fire again after a restart', async () => {
  const first = setup();
  const a = first.agent('alice');
  const b = first.agent('bob');
  const { channel } = await a.ok<ChannelSnapshot>({ type: 'channel.create', name: 'persist' });
  await b.ok({ type: 'channel.join', channel: channel.id });
  const before = first.hub.revision;
  await b.ok({ type: 'wake.set', channel: channel.id, url: 'https://hooks.example.com/b', secret: 'persisted-secret' });
  assert.ok(first.hub.revision > before, 'setting a hook marks state as changed');

  const state = JSON.parse(JSON.stringify(first.hub.exportState()));
  const second = setup();
  second.hub.restoreState(state);
  const c = second.agent('carol');
  await c.ok({ type: 'channel.join', channel: channel.id });
  await c.ok({ type: 'message.send', channel: channel.id, content: '@bob are you there?' });
  await second.settle();
  assert.equal(second.posts.length, 1);
  const expected = 'sha256=' + crypto.createHmac('sha256', 'persisted-secret').update(second.posts[0].body).digest('hex');
  assert.equal(second.posts[0].headers['x-crosstalk-signature'], expected);
});

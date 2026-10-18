import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshHub, type Connection } from '../src/server/hub.js';
import { PROTOCOL_VERSION, type ChannelSnapshot, type ServerFrame } from '../src/protocol.js';

/** A hub on a fake clock with in-memory agents. */
function setup(options: ConstructorParameters<typeof MeshHub>[0] = {}) {
  let clock = 1_000_000;
  const hub = new MeshHub({ now: () => clock, ...options });
  let seq = 0;
  const agent = (name: string) => {
    const conn: Connection = hub.connect({ send: () => {}, close: () => {} }, `10.0.0.${++seq}`);
    hub.hello(conn, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name } });
    const call = async (frame: Record<string, unknown>) =>
      (await hub.request(conn, { id: String(++seq), ...frame })) as Extract<ServerFrame, { type: 'result' }>;
    const ok = async <T = any>(frame: Record<string, unknown>): Promise<T> => {
      const res = await call(frame);
      assert.ok(res.ok, `expected ok, got ${JSON.stringify(res)}`);
      return (res as any).data;
    };
    const err = async (frame: Record<string, unknown>) => {
      const res = await call(frame);
      assert.equal(res.ok, false, `expected an error, got ${JSON.stringify(res).slice(0, 200)}`);
      return (res as any).error as { code: string; message: string; details?: any };
    };
    return { conn, ok, err };
  };
  return { hub, agent, tick: (ms: number) => (clock += ms) };
}

test('channels get the default limits, and creators can pick their own within the hub ceilings', async () => {
  const { agent } = setup();
  const a = agent('alice');
  const plain = await a.ok<ChannelSnapshot>({ type: 'channel.create', name: 'plain' });
  assert.deepEqual(plain.channel.limits, { maxMessageChars: 1000, messagesPerMinute: 120, messageBurst: 30 });

  const custom = await a.ok<ChannelSnapshot>({ type: 'channel.create', name: 'tweets', limits: { maxMessageChars: 280, messagesPerMinute: 10 } });
  assert.deepEqual(custom.channel.limits, { maxMessageChars: 280, messagesPerMinute: 10, messageBurst: 30 });

  for (const limits of [{ maxMessageChars: 20_000 }, { messagesPerMinute: 601 }, { messageBurst: 0 }, { maxMessageChars: 2.5 }, 'big']) {
    assert.equal((await a.err({ type: 'channel.create', limits })).code, 'bad_request', JSON.stringify(limits));
  }
});

test('a message over the channel limit is refused and says the limit; DMs only answer to the hub ceiling', async () => {
  const { agent } = setup();
  const a = agent('alice');
  const b = agent('bob');
  const snap = await a.ok<ChannelSnapshot>({ type: 'channel.create', limits: { maxMessageChars: 280 } });
  const channel = snap.channel.id;
  await b.ok({ type: 'channel.join', channel });

  await a.ok({ type: 'message.send', channel, content: 'x'.repeat(280) });
  const long = await a.err({ type: 'message.send', channel, content: 'x'.repeat(281) });
  assert.equal(long.code, 'bad_request');
  assert.match(long.message, /281 characters; this channel allows 280/);
  assert.deepEqual(long.details, { maxMessageChars: 280 });
  assert.equal((await a.err({ type: 'shorthand.send', channel, shorthand: '!LCK @a.ts ' + 'x'.repeat(280) })).code, 'bad_request');

  // A full invite is ~1500 characters and must still fit in a DM.
  await a.ok({ type: 'dm.send', to: 'bob', content: 'i'.repeat(1500) });
  assert.match((await a.err({ type: 'dm.send', to: 'bob', content: 'i'.repeat(16_001) })).message, /this hub allows 16000/);
});

test('each member gets a burst, then the per-minute rate; leaving and rejoining does not reset it', async () => {
  const { agent, tick } = setup({ rateLimit: { burst: 1000, perSecond: 1000 } });
  const a = agent('alice');
  const b = agent('bob');
  const snap = await a.ok<ChannelSnapshot>({ type: 'channel.create', limits: { messagesPerMinute: 60, messageBurst: 3 } });
  const channel = snap.channel.id;
  await b.ok({ type: 'channel.join', channel });

  for (let i = 0; i < 3; i++) await a.ok({ type: 'message.send', channel, content: `m${i}` });
  const limited = await a.err({ type: 'message.send', channel, content: 'flood' });
  assert.equal(limited.code, 'rate_limited');
  assert.match(limited.message, /60 messages a minute per member \(bursts of 3\); try again in 1s/);
  assert.equal(limited.details.retryAfterMs, 1000);
  await b.ok({ type: 'message.send', channel, content: 'bob has his own allowance' });

  await a.ok({ type: 'channel.leave', channel });
  await a.ok({ type: 'channel.join', channel });
  assert.equal((await a.err({ type: 'message.send', channel, content: 'still limited' })).code, 'rate_limited');

  tick(1000);
  await a.ok({ type: 'message.send', channel, content: 'one more after a second' });
  assert.equal((await a.err({ type: 'message.send', channel, content: 'and no more' })).code, 'rate_limited');
});

test('DMs have their own rate, at the hub default channel rate', async () => {
  const { agent } = setup({ channelLimits: { messagesPerMinute: 60, messageBurst: 2 }, rateLimit: { burst: 1000, perSecond: 1000 } });
  const a = agent('alice');
  const b = agent('bob');
  const snap = await a.ok<ChannelSnapshot>({ type: 'channel.create' });
  await b.ok({ type: 'channel.join', channel: snap.channel.id });
  await a.ok({ type: 'dm.send', to: 'bob', content: '1' });
  await a.ok({ type: 'dm.send', to: 'bob', content: '2' });
  const limited = await a.err({ type: 'dm.send', to: 'bob', content: '3' });
  assert.equal(limited.code, 'rate_limited');
  assert.match(limited.message, /Too many DMs/);
});

test('rateLimits: false turns every rate bucket off, but length limits stay', async () => {
  const { agent } = setup({ rateLimits: false, rateLimit: { burst: 1, perSecond: 0.001 }, channelLimits: { messageBurst: 1, messagesPerMinute: 1 } });
  const a = agent('alice');
  const snap = await a.ok<ChannelSnapshot>({ type: 'channel.create' });
  const channel = snap.channel.id;
  for (let i = 0; i < 20; i++) await a.ok({ type: 'message.send', channel, content: `m${i}` });
  assert.equal((await a.err({ type: 'message.send', channel, content: 'x'.repeat(1001) })).code, 'bad_request');
});

test('the per-connection request rate is tunable', async () => {
  const { agent } = setup({ rateLimit: { burst: 2, perSecond: 0.001 } });
  const a = agent('alice');
  await a.ok({ type: 'channel.list' });
  await a.ok({ type: 'channel.list' });
  const limited = await a.err({ type: 'channel.list' });
  assert.equal(limited.code, 'rate_limited');
  assert.match(limited.message, /Too many requests/);
});

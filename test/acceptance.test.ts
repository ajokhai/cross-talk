/**
 * The acceptance test from the "agents say 'on it' and then go idle" report,
 * end to end against a real hub:
 *
 *   an agent claims a task, says "on it" and goes quiet; 30s later it is
 *   @mentioned. Expected: once it has been quiet past the idle threshold the
 *   sender is warned, the claim turns stalled, and a wake supervisor resumes
 *   the agent with the message, after which it reads and the claim revives.
 *
 * Run once with the agent as a plain WebSocket member and once as a device
 * behind a crosstalk-bridge over TCP. The outcome must be the same.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startServer } from '../src/server/index.js';
import { CrossTalk, type Channel } from '../src/client/sdk.js';
import { WakeSupervisor } from '../src/client/wake.js';
import { BinaryCodec, BinaryOpcode, DeviceBridge, ResyncingLink } from '../packages/embedded/src/index.js';
// The embedded package depends on the published entry point (dist), so its bridge gets a client from there.
import { CrossTalk as PackageCrossTalk } from 'cross-talk';
import type { ChannelMessage, TaskClaim } from '../src/protocol.js';

const IDLE_AFTER_MS = 2 * 60_000;

async function until<T>(probe: () => T | undefined | false, what: string, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 20));
  }
}

/** The agent under test, however it reaches the hub. */
interface Member {
  /** Its own view of the channel. */
  channel: Pick<Channel, 'claim' | 'markRead' | 'send'>;
  /** Says "on it" the way this kind of member talks. */
  sayOnIt(): Promise<void>;
  /** Ends its turn: stops reading the channel. */
  goQuiet(): Promise<void>;
  close(): Promise<void>;
}

type MemberFactory = (url: string, address: string) => Promise<Member>;

/** A WebSocket client that reads only when it says so, like an MCP agent between turns. */
const websocketMember: MemberFactory = async (url, address) => {
  const client = await CrossTalk.connect({ name: 'gemini', url, reconnect: false });
  const channel = await client.joinChannel(address);
  return {
    channel,
    sayOnIt: async () => void (await channel.send('on it')),
    goQuiet: async () => {},
    close: () => client.close()
  };
};

/**
 * A device on a TCP link to a bridge that holds its hub session. Going quiet
 * is the link dropping: the session stays in the channel, nothing reads.
 */
const bridgeMember: MemberFactory = async (url, address) => {
  const server = net.createServer();
  const accepted = new Promise<net.Socket>(resolve => server.once('connection', resolve));
  server.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const device = net.connect((server.address() as net.AddressInfo).port, '127.0.0.1');
  // The device speaks the same length-prefixed framing as the bridge.
  const deviceLink = new ResyncingLink(device, 2048);
  const link = new ResyncingLink(await accepted, 2048);
  const client = await PackageCrossTalk.connect({ name: 'gemini', url, reconnect: false });
  const bridge = new DeviceBridge({ transport: link, channel: address, name: 'gemini', client, registerWindowMs: 0, attentionIntervalMs: 50 });
  bridge.on('error', () => {});
  const channel = await bridge.start();
  return {
    channel,
    sayOnIt: async () => {
      deviceLink.send(BinaryCodec.encode({ opcode: BinaryOpcode.BROADCAST, flags: {}, timestamp: Date.now(), payload: Buffer.from('on it') }));
    },
    goQuiet: async () => {
      const closed = new Promise(r => bridge.once('closed', r));
      device.destroy();
      await closed;
    },
    close: async () => {
      await bridge.stop();
      device.destroy();
      server.close();
      await client.close();
    }
  };
};

async function acceptance(makeMember: MemberFactory) {
  let skew = 0;
  const hub = await startServer({ port: 0, quiet: true, hub: { now: () => Date.now() + skew, idleAfterMs: IDLE_AFTER_MS } });
  const alice = await CrossTalk.connect({ name: 'alice', url: hub.url, reconnect: false });
  const sup = await CrossTalk.connect({ name: 'wake', url: hub.url, reconnect: false });
  const ch = await alice.createChannel('acceptance');
  const member = await makeMember(hub.url, ch.address);
  const supervisor = new WakeSupervisor(await sup.joinChannel(ch.address), sup, {
    agent: 'gemini',
    // Long enough that only the stalled claim triggers the wake inside this test.
    graceMs: 60_000,
    cooldownMs: 0,
    adapter: async prompt => {
      prompts.push(prompt);
      // The resumed agent reads the channel and reports progress.
      await member.channel.markRead();
      await member.channel.send('back on it: fixing the red tests now');
    }
  });
  const prompts: string[] = [];
  const seen: ChannelMessage[] = [];
  const claims: TaskClaim[] = [];
  ch.on('message', (m: ChannelMessage) => seen.push(m));
  ch.on('claim.updated', (c: TaskClaim) => claims.push(c));
  const gemini = () => ch.attention.find(a => a.agent.name === 'gemini')!;

  try {
    // "on it", as a claim, then the turn ends.
    const claim = await member.channel.claim('fix the red tests', { everySeconds: 60 });
    await member.sayOnIt();
    await until(() => seen.some(m => m.content === 'on it'), '"on it" to reach alice');
    await member.goQuiet();

    // 30 seconds later: not idle yet, so no warning.
    skew = 30_000;
    const first = await ch.send('@gemini status? the tests are still red');
    assert.equal(first.idleMentions, undefined);

    // Past the idle threshold: the sender is warned, the claim stalls.
    skew = IDLE_AFTER_MS + 60_000;
    const second = await ch.send('@gemini still there?');
    assert.deepEqual(second.idleMentions?.map(a => a.agent.name), ['gemini'], 'the sender is warned');
    assert.ok(second.idleMentions![0].unread >= 2, 'both pings are unread');
    await ch.refresh();
    assert.equal(gemini().idle, true);

    hub.hub.sweep();
    const stalled = await until(() => claims.find(c => c.id === claim.id && c.status === 'stalled'), 'the claim to stall');
    assert.equal(stalled.owner.name, 'gemini');

    // The supervisor resumes the agent with what it missed.
    await until(() => prompts.length > 0, 'the wake prompt');
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /alice: @gemini status\? the tests are still red/);
    assert.match(prompts[0], /alice: @gemini still there\?/);
    assert.match(prompts[0], /claim cl_\w+ \("fix the red tests"\) is stalled/);
    assert.ok(seen.some(m => /^Waking gemini \(last read/.test(m.content)), 'the channel is told about the wake');

    // Woken, it reads and reports: no longer idle, the claim is live again.
    await until(() => seen.some(m => m.content.startsWith('back on it')), 'the agent to report back');
    await until(() => claims.find(c => c.id === claim.id && c.status === 'active'), 'the claim to revive');
    await ch.refresh();
    assert.equal(gemini().idle, false);
    assert.equal(gemini().unread, 0);
  } finally {
    supervisor.stop();
    await member.close();
    await alice.close();
    await sup.close();
    await hub.close();
  }
}

test('acceptance over WebSocket: "on it", silence, @mention, warning, stalled claim, wake', () => acceptance(websocketMember));

test('acceptance over a TCP bridge member: the same outcome', () => acceptance(bridgeMember));

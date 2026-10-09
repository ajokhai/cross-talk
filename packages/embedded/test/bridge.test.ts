/**
 * DeviceBridge against a real hub: a fake device link on one side, a normal
 * SDK agent on the other.
 *
 *   node --import tsx --test packages/embedded/test/bridge.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { CrossTalk, DialectEngine, startServer, type ChannelMessage, type DirectMessage } from 'cross-talk';
import {
  BinaryCodec,
  BinaryOpcode,
  DeviceBridge,
  ResyncingLink,
  splitAttributed,
  type BinaryFrame,
  type ICrossTalkTransport
} from '../src/index.js';

/** In-memory device link: `deliver` plays the device sending, `frames` is what the device received. */
class FakeLink extends EventEmitter implements ICrossTalkTransport {
  isConnected = true;
  readonly frames: BinaryFrame[] = [];
  private waiters: Array<() => void> = [];

  send(data: Buffer | string): void {
    this.frames.push(BinaryCodec.decode(Buffer.isBuffer(data) ? data : Buffer.from(data))!);
    for (const w of this.waiters.splice(0)) w();
  }
  close(): void {
    this.isConnected = false;
  }
  deliver(opcode: BinaryOpcode, payload: Buffer | string = Buffer.alloc(0)): void {
    this.emit('message', BinaryCodec.encode({ opcode, flags: {}, timestamp: Date.now(), payload }));
  }
  /** Resolves with the next received frame matching `pred`. */
  async next(pred: (f: BinaryFrame) => boolean, timeoutMs = 2000): Promise<BinaryFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.frames.findIndex(pred);
      if (i !== -1) return this.frames.splice(i, 1)[0];
      if (Date.now() > deadline) throw new Error('timed out waiting for a device frame');
      await new Promise<void>(resolve => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }
}

const packed = (expr: string) => DialectEngine.packToBits(expr);
const unpack = (f: BinaryFrame) => DialectEngine.unpackFromBits(f.raw!).parsed;

async function scenario(fn: (ctx: { url: string; agent: CrossTalk; address: string }) => Promise<void>) {
  const hub = await startServer({ port: 0, quiet: true });
  const agent = await CrossTalk.connect({ name: 'laptop', url: hub.url, reconnect: false });
  const ch = await agent.createChannel('hardware');
  try {
    await fn({ url: hub.url, agent, address: ch.address });
  } finally {
    await agent.close();
    await hub.close();
  }
}

test('device registers a name, chats, and receives channel messages', async () => {
  await scenario(async ({ url, agent, address }) => {
    const link = new FakeLink();
    const bridge = new DeviceBridge({ transport: link, channel: address, name: 'fallback', hub: { url, reconnect: false } });
    const started = bridge.start();
    link.deliver(BinaryOpcode.REGISTER, 'esp32-motor');
    await started;

    const ch = agent.channel(address)!;
    const heard = new Promise<ChannelMessage>(resolve => ch.once('message', resolve));
    link.deliver(BinaryOpcode.BROADCAST, 'temp=41C');
    const msg = await heard;
    assert.equal(msg.from.name, 'esp32-motor');
    assert.equal(msg.content, 'temp=41C');

    await ch.send('slow down to 50%');
    const down = await link.next(f => f.opcode === BinaryOpcode.BROADCAST);
    assert.deepEqual(splitAttributed(down.raw!), { name: 'laptop', text: 'slow down to 50%' });

    link.deliver(BinaryOpcode.REGISTER);
    const id = await link.next(f => f.opcode === BinaryOpcode.REGISTER && !!f.flags.isResponse);
    assert.match(id.raw!.toString(), /^ag_/);
    await bridge.stop();
  });
});

test('device locks go through the channel and contention reaches the device', async () => {
  await scenario(async ({ url, agent, address }) => {
    const link = new FakeLink();
    const bridge = new DeviceBridge({ transport: link, channel: address, name: 'pico', hub: { url, reconnect: false }, registerWindowMs: 0 });
    await bridge.start();

    link.deliver(BinaryOpcode.LOCK_ACQUIRE, packed('!LCK @firmware/motor.c #FIX "stall" ~200 &WAIT'));
    const ack = await link.next(f => f.opcode === BinaryOpcode.LOCK_ACK);
    assert.ok(ack.flags.isResponse);
    assert.equal(unpack(ack).target, 'firmware/motor.c');

    const ch = agent.channel(address)!;
    await assert.rejects(ch.lock('firmware/motor.c', 'me too'), /locked by pico/);
    const contended = await link.next(f => f.opcode === BinaryOpcode.LOCK_ACQUIRE && !!f.flags.conflictAlert);
    assert.equal(unpack(contended).action, '!WARN');
    assert.equal(unpack(contended).reason, 'laptop');

    link.deliver(BinaryOpcode.LOCK_RELEASE, packed('!REL @firmware/motor.c &DONE &PROCEED'));
    const relAck = await link.next(f => f.opcode === BinaryOpcode.LOCK_ACK);
    assert.equal(unpack(relAck).action, '!REL');
    await ch.lock('firmware/motor.c', 'my turn');
    const seen = await link.next(f => f.opcode === BinaryOpcode.LOCK_ACQUIRE && !f.flags.isResponse);
    assert.equal(unpack(seen).reason, 'laptop');

    link.deliver(BinaryOpcode.LOCK_ACQUIRE, packed('!LCK @firmware/motor.c "again"'));
    const denied = await link.next(f => f.opcode === BinaryOpcode.LOCK_DENIED);
    assert.equal(unpack(denied).reason, 'held by laptop');
    await bridge.stop();
  });
});

test('DMs both ways, status and state queries', async () => {
  await scenario(async ({ url, agent, address }) => {
    const link = new FakeLink();
    const bridge = new DeviceBridge({ transport: link, channel: address, name: 'sensor', hub: { url, reconnect: false }, registerWindowMs: 0 });
    await bridge.start();

    const dm = new Promise<DirectMessage>(resolve => agent.once('dm', resolve));
    const to = Buffer.from('laptop');
    link.deliver(BinaryOpcode.DIRECT_MSG, Buffer.concat([Buffer.from([to.length]), to, Buffer.from('calibrated')]));
    assert.equal((await dm).content, 'calibrated');

    await agent.dm('sensor', 'recalibrate now');
    const down = await link.next(f => f.opcode === BinaryOpcode.DIRECT_MSG);
    assert.deepEqual(splitAttributed(down.raw!), { name: 'laptop', text: 'recalibrate now' });

    link.deliver(BinaryOpcode.HEARTBEAT, 'sampling');
    await link.next(f => f.opcode === BinaryOpcode.HEARTBEAT && !!f.flags.isResponse);
    const ch = await agent.channel(address)!.refresh();
    assert.equal([...ch.members.values()].find(m => m.name === 'sensor')?.currentTask, 'sampling');

    link.deliver(BinaryOpcode.STATE_QUERY);
    const state = await link.next(f => f.opcode === BinaryOpcode.STATE_QUERY);
    assert.equal(state.raw!.toString(), 'members=2 locks=0');
    await bridge.stop();
  });
});

test('frames sent to the device always fit and always parse', async () => {
  await scenario(async ({ url, agent, address }) => {
    const link = new FakeLink();
    const errors: Error[] = [];
    const bridge = new DeviceBridge({ transport: link, channel: address, name: 'tiny', hub: { url, reconnect: false }, registerWindowMs: 0 });
    bridge.on('error', e => errors.push(e));
    await bridge.start();
    const ch = agent.channel(address)!;

    // A path too long for a 118-byte frame is skipped, not truncated into garbage.
    await ch.lock('d/'.repeat(100) + 'x.c', 'long');
    // A path with spaces and quotes survives packing.
    await ch.lock('src/my "odd" file.c', 'quoted');
    const frame = await link.next(f => f.opcode === BinaryOpcode.LOCK_ACQUIRE);
    assert.equal(unpack(frame).target, 'src/my "odd" file.c');
    assert.ok(errors.some(e => /does not fit/.test(e.message)));

    await ch.send('é'.repeat(200));
    const text = await link.next(f => f.opcode === BinaryOpcode.BROADCAST);
    assert.ok(text.raw!.length <= 118);
    assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(text.raw!.subarray(1)));
    for (const f of link.frames) assert.ok(f.raw!.length <= 118);
    await bridge.stop();
  });
});

test('ResyncingLink recovers from line noise and closes once', () => {
  const stream = new PassThrough();
  const link = new ResyncingLink(stream, 128);
  const got: Buffer[] = [];
  let closes = 0;
  link.on('message', (b: Buffer) => got.push(b));
  link.on('close', () => closes++);

  const frame = BinaryCodec.encode({ opcode: BinaryOpcode.HEARTBEAT, flags: {}, timestamp: 0, payload: 'ok' });
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16BE(frame.length);
  // Boot noise, including a bogus huge length prefix, then a real frame split across writes.
  stream.write(Buffer.from([0xff, 0xfe, 0x00, 0x13, 0x00, 0x00, 0xff]));
  stream.write(Buffer.concat([prefix, frame.subarray(0, 4)]));
  stream.write(frame.subarray(4));
  assert.equal(got.length, 1);
  assert.equal(BinaryCodec.decode(got[0])!.payload, 'ok');

  // An oversized but well-formed frame whose payload smuggles a fake frame is skipped whole.
  const fake = BinaryCodec.encode({ opcode: BinaryOpcode.BROADCAST, flags: {}, timestamp: 0, payload: 'smuggled' });
  const fakePrefixed = Buffer.concat([Buffer.from([0, fake.length]), fake]);
  const big = BinaryCodec.encode({ opcode: BinaryOpcode.BROADCAST, flags: {}, timestamp: 0, payload: Buffer.concat(Array(10).fill(fakePrefixed)) });
  const bigPrefix = Buffer.alloc(2);
  bigPrefix.writeUInt16BE(big.length);
  const stream2 = Buffer.concat([bigPrefix, big, prefix, frame]);
  for (let i = 0; i < stream2.length; i += 7) stream.write(stream2.subarray(i, i + 7));
  assert.equal(got.length, 2, 'only the real frame after the oversized one arrives');
  assert.equal(BinaryCodec.decode(got[1])!.payload, 'ok');

  stream.end();
  stream.destroy();
  link.close();
  setImmediate(() => assert.equal(closes, 1));
});

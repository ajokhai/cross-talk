/**
 * DeviceBridge in a channel that approves new members: the device is told
 * it's waiting, joins once the owner admits it, keeps the pass for later
 * rejoins, and is told when it's refused.
 *
 *   node --import tsx --test test/embedded-approval.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';
import type { ChannelMessage, ServerFrame } from '../src/protocol.js';
import {
  BinaryCodec,
  BinaryOpcode,
  DeviceBridge,
  splitAttributed,
  type BinaryFrame,
  type ICrossTalkTransport
} from '../packages/embedded/src/index.js';

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
  async next(pred: (f: BinaryFrame) => boolean, timeoutMs = 3000): Promise<BinaryFrame> {
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
  /** The next notice the bridge itself sent the device. */
  notice(): Promise<string> {
    return this.next(f => f.opcode === BinaryOpcode.BROADCAST && splitAttributed(f.raw!)?.name === 'crosstalk')
      .then(f => splitAttributed(f.raw!)!.text);
  }
}

/** The next frame of `type` a client receives. */
const nextEvent = <T extends ServerFrame['type']>(c: CrossTalk, type: T) =>
  new Promise<Extract<ServerFrame, { type: T }>>(r => { const f = (e: ServerFrame) => { if (e.type === type) { c.off('event', f); r(e as any); } }; c.on('event', f); });

async function until<T>(probe: () => T | undefined | false | Promise<T | undefined | false>, what: string, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 50));
  }
}

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xt-bridge-approval-')), 'hub.json');

test('a device waits to be admitted, joins with its pass, and reuses the pass after the hub restarts', async () => {
  const stateFile = tmpFile();
  let server = await startServer({ port: 0, quiet: true, stateFile });
  const port = Number(new URL(server.url).port);
  const url = server.url;
  const host = await CrossTalk.connect({ name: 'host', url, reconnect: false });
  let host2: CrossTalk | undefined;
  let bridge: DeviceBridge | undefined;
  let again: DeviceBridge | undefined;
  try {
    const created: any = await host.request('channel.create', { name: 'bench', approval: true });
    const address: string = created.channel.id;
    const ownerKey: string = created.ownerKey;
    const heard: ChannelMessage[] = [];
    host.on('message', (m: ChannelMessage) => heard.push(m));

    const link = new FakeLink();
    bridge = new DeviceBridge({ transport: link, channel: address, name: 'sensor', hub: { url }, registerWindowMs: 0 });
    bridge.on('error', () => {});
    let waits = 0;
    bridge.on('waiting', () => waits++);
    let ready = false;
    const knocked = nextEvent(host, 'channel.knock');
    const started = bridge.start().then(ch => { ready = true; return ch; });

    // The owner is asked, and the device is told it's waiting; nothing is joined yet.
    assert.equal((await knocked).knock.agent.name, 'sensor');
    assert.equal(await link.notice(), 'waiting for approval');
    assert.equal(ready, false);
    assert.equal(waits, 1);
    // Frames the device sends meanwhile are held, then delivered once it's in.
    link.deliver(BinaryOpcode.BROADCAST, 'hello from the bench');

    const passed = new Promise<string>(r => bridge!.once('pass', r));
    await host.request('member.admit', { channel: address, ownerKey, agent: 'sensor', allow: true });
    const pass = await passed;
    assert.match(pass, /^xp_/);
    const ch = await started;
    assert.equal(ch.address, address);
    assert.equal(bridge.currentPass, pass);
    assert.equal(await link.notice(), 'admitted');
    await until(() => heard.find(m => m.from.name === 'sensor' && m.content === 'hello from the bench'), 'the held message');

    // Hub restart, and the device's session doesn't survive it (a new agent):
    // the bridge gets back in with its pass instead of knocking and waiting.
    await server.close();
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    state.agents = [];
    state.locks = [];
    fs.writeFileSync(stateFile, JSON.stringify(state));
    server = await startServer({ port, quiet: true, stateFile });

    host2 = await CrossTalk.connect({ name: 'host2', url, reconnect: false });
    const snapshot: any = await host2.request('channel.join', { channel: address, ownerKey });
    assert.equal(snapshot.channel.approval, true, 'approval survived the restart');
    const back = await host2.joinChannel(address);
    await until(async () => {
      await back.refresh();
      return [...back.members.values()].some(m => m.name === 'sensor');
    }, 'the device to rejoin with its pass');
    assert.equal(waits, 1, 'no second wait: the pass got it straight back in');
    assert.equal(bridge.currentPass, pass);

    // And it can talk again.
    const said = new Promise<ChannelMessage>(r => back.on('message', m => { if (m.from.name === 'sensor') r(m); }));
    link.deliver(BinaryOpcode.BROADCAST, 'back online');
    assert.equal((await said).content, 'back online');

    // A pass saved by the caller skips the knock altogether (a restarted bridge).
    const link2 = new FakeLink();
    again = new DeviceBridge({ transport: link2, channel: address, name: 'sensor-2', hub: { url, reconnect: false }, registerWindowMs: 0, pass });
    again.on('error', () => {});
    let waited = false;
    again.on('waiting', () => { waited = true; });
    assert.equal((await again.start()).address, address);
    assert.equal(waited, false);
  } finally {
    await again?.stop();
    await bridge?.stop();
    await host.close();
    await host2?.close();
    await server.close();
  }
});

test('a refused device is told so and the bridge stops trying', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const host = await CrossTalk.connect({ name: 'host', url: server.url, reconnect: false });
  try {
    const created: any = await host.request('channel.create', { name: 'private', approval: true });
    const address: string = created.channel.id;
    const ownerKey: string = created.ownerKey;

    const link = new FakeLink();
    const bridge = new DeviceBridge({ transport: link, channel: address, name: 'intruder', hub: { url: server.url, reconnect: false }, registerWindowMs: 0 });
    bridge.on('error', () => {});
    const refusedEvent = new Promise(r => bridge.once('refused', r));
    const closed = new Promise(r => bridge.once('closed', r));
    const knocked = nextEvent(host, 'channel.knock');
    const started = bridge.start();
    await knocked;
    assert.equal(await link.notice(), 'waiting for approval');

    await host.request('member.admit', { channel: address, ownerKey, agent: 'intruder', allow: false });
    await assert.rejects(started, /Refused by the owner/);
    assert.equal(await link.notice(), 'refused');
    await refusedEvent;
    await closed;
    assert.equal(link.isConnected, false, 'the device link is let go');

    // No retry: nobody is knocking any more (the bridge's session is gone).
    await until(async () => (await host.request('member.knocks', { channel: address, ownerKey })).knocks.every((k: any) => k.agent.name !== 'intruder'), 'the knock to clear');
    const snap: any = await host.request('channel.state', { channel: address });
    assert.ok(!snap.members.some((m: any) => m.name === 'intruder'));
  } finally {
    await host.close();
    await server.close();
  }
});

test('channels without approval are unaffected: the device joins at once and is told nothing', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const host = await CrossTalk.connect({ name: 'host', url: server.url, reconnect: false });
  try {
    const ch = await host.createChannel('open');
    const link = new FakeLink();
    const bridge = new DeviceBridge({ transport: link, channel: ch.address, name: 'plain', hub: { url: server.url, reconnect: false }, registerWindowMs: 0 });
    bridge.on('error', () => {});
    assert.equal((await bridge.start()).address, ch.address);
    assert.equal(bridge.currentPass, undefined);
    assert.ok(!link.frames.some(f => f.opcode === BinaryOpcode.BROADCAST && splitAttributed(f.raw!)?.name === 'crosstalk'));
    await bridge.stop();
  } finally {
    await host.close();
    await server.close();
  }
});

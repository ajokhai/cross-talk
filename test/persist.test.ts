import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, defaultStateFile } from '../src/server/index.js';
import { MeshHub } from '../src/server/hub.js';
import { PROTOCOL_VERSION } from '../src/protocol.js';
import { CrossTalk, type ChannelLost, type LocksLost } from '../src/client/sdk.js';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xt-state-')), 'hub.json');
const once = <T>(emitter: NodeJS.EventEmitter, event: string, ms = 8000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${ms}ms`)), ms);
    emitter.once(event, (v: T) => {
      clearTimeout(timer);
      resolve(v);
    });
  });

test('a restarted hub keeps channels and locks, and clients resume as the same agent', async () => {
  const stateFile = tmpFile();
  let server = await startServer({ port: 0, quiet: true, stateFile });
  const port = Number(new URL(server.url).port);
  const url = server.url;
  const alice = await CrossTalk.connect({ name: 'alice', url });
  const bob = await CrossTalk.connect({ name: 'bob', url });
  try {
    const ch = await alice.createChannel('survives');
    await bob.joinChannel(ch.address);
    await ch.lock('src/a.ts', 'long edit', 600);
    await ch.send('before the restart');
    const aliceId = alice.agent.id;

    await server.close();
    assert.ok(fs.statSync(stateFile).size > 0);
    assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
    const saved = fs.readFileSync(stateFile, 'utf8');
    assert.ok(!saved.includes('"resumeToken"'), 'only token hashes are saved');

    server = await startServer({ port, quiet: true, stateFile });
    await Promise.all([once(alice, 'reconnected'), once(bob, 'reconnected')]);

    assert.equal(alice.agent.id, aliceId, 'resumed, not a new agent');
    const bobCh = bob.channels.get(ch.address)!;
    assert.equal(bobCh.locks.get('src/a.ts')?.holder.name, 'alice');
    assert.equal(ch.myLocks().length, 1);
    assert.ok(bobCh.messages.some(m => m.content === 'before the restart'));

    // Another agent still can't take the lock.
    await assert.rejects(bobCh.lock('src/a.ts', 'mine now'), (err: any) => err.code === 'lock_held');
    const released = await ch.unlock('src/a.ts');
    assert.equal(released.released, true);
    assert.equal((await ch.unlock('src/a.ts')).released, false, 'nothing left to release');
  } finally {
    await alice.close();
    await bob.close();
    await server.close();
  }
});

test('without saved state, a reconnect reports lost locks and channels', async () => {
  let server = await startServer({ port: 0, quiet: true, stateFile: false });
  const port = Number(new URL(server.url).port);
  const alice = await CrossTalk.connect({ name: 'alice', url: server.url });
  try {
    const ch = await alice.createChannel('ephemeral');
    await ch.lock('src/a.ts', 'editing');
    const locksLost = once<LocksLost>(alice, 'locks.lost');
    const channelLost = once<ChannelLost>(alice, 'channel.lost');
    await server.close();
    server = await startServer({ port, quiet: true, stateFile: false });
    const [locks, channel] = await Promise.all([locksLost, channelLost]);
    assert.deepEqual(locks.locks.map(l => l.file), ['src/a.ts']);
    assert.equal(channel.channel, ch.address);
    assert.equal(alice.channels.size, 0);
  } finally {
    await alice.close();
    await server.close();
  }
});

test('restored agents that never come back are evicted and their locks released', () => {
  let now = 1_000_000;
  const first = new MeshHub({ now: () => now });
  const peer = { send() {}, close() {} };
  const conn = first.connect(peer, '127.0.0.1');
  first.hello(conn, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name: 'gone' } } as any);
  return first.request(conn, { type: 'channel.create', id: '1', name: 'x' }).then(async created => {
    const address = (created as any).data.channel.id;
    await first.request(conn, { type: 'lock.acquire', id: '2', channel: address, file: 'a.ts', reason: 'r', ttlSeconds: 600 });
    const state = JSON.parse(JSON.stringify(first.exportState()));

    const second = new MeshHub({ now: () => now });
    assert.deepEqual(second.restoreState(state, 60_000), { channels: 1, agents: 1, locks: 1 });
    assert.equal(second.locks.list().length, 1);
    now += 59_000;
    second.sweep();
    assert.equal(second.locks.list().length, 1, 'still inside the grace period');
    now += 2_000;
    second.sweep();
    assert.equal(second.locks.list().length, 0, 'evicted after the grace period');
  });
});

test('state file defaults: loopback hubs on a fixed port only, and an env override', () => {
  const saved = process.env.CROSSTALK_STATE_FILE;
  try {
    delete process.env.CROSSTALK_STATE_FILE;
    assert.match(defaultStateFile('127.0.0.1', 4488)!, /\.crosstalk[\\/]hub-4488\.json$/);
    assert.equal(defaultStateFile('127.0.0.1', 0), undefined);
    assert.equal(defaultStateFile('0.0.0.0', 4488), undefined);
    process.env.CROSSTALK_STATE_FILE = 'off';
    assert.equal(defaultStateFile('127.0.0.1', 4488), undefined);
    process.env.CROSSTALK_STATE_FILE = '/tmp/x.json';
    assert.equal(defaultStateFile('0.0.0.0', 4488), '/tmp/x.json');
  } finally {
    if (saved === undefined) delete process.env.CROSSTALK_STATE_FILE;
    else process.env.CROSSTALK_STATE_FILE = saved;
  }
});

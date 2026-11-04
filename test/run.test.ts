import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';
import { formatSize, parseSize, runWithSlot } from '../src/client/slots.js';

const node = (code: string) => [process.execPath, '-e', code];

test('parseSize and formatSize', () => {
  assert.equal(parseSize('5G'), 5 * 1024 ** 3);
  assert.equal(parseSize('512m'), 512 * 1024 ** 2);
  assert.equal(parseSize('1.5TB'), 1.5 * 1024 ** 4);
  assert.equal(parseSize('100'), 100);
  assert.throws(() => parseSize('lots'), /Not a size/);
  assert.equal(formatSize(5 * 1024 ** 3), '5.0 GB');
});

test('crosstalk run: at most --max commands run at once; each exits with its own code and frees its place', async () => {
  const server = await startServer({ port: 0, quiet: true });
  const owner = await CrossTalk.connect({ name: 'owner', url: server.url, reconnect: false });
  try {
    const ch = await owner.createChannel('builds');
    const lines: string[] = [];
    // Each run appends +1 when it starts and -1 when it ends, so overlap can be measured.
    const trace = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xt-run-')), 'trace');
    const job = (label: string, exit: number) =>
      runWithSlot({
        url: server.url,
        channel: ch.address,
        name: `agent-${label}`,
        slot: 'heavy',
        max: 2,
        log: l => lines.push(`${label}: ${l}`),
        command: node(`const fs=require('fs');fs.appendFileSync(${JSON.stringify(trace)},'+1\\n');setTimeout(()=>{fs.appendFileSync(${JSON.stringify(trace)},'-1\\n');process.exit(${exit})},300)`)
      });
    const codes = await Promise.all([job('a', 0), job('b', 3), job('c', 0), job('d', 0)]);
    assert.deepEqual(codes, [0, 3, 0, 0]);
    let running = 0;
    let peak = 0;
    for (const step of fs.readFileSync(trace, 'utf8').trim().split('\n')) peak = Math.max(peak, (running += Number(step)));
    assert.equal(peak, 2, 'never more than --max at once');
    assert.ok(lines.some(l => /slot heavy is full .*waiting, number \d in line/.test(l)), lines.join('\n'));

    const state = await owner.request('channel.state', { channel: ch.address });
    assert.deepEqual(state.slots, [], 'every place was released');
    assert.equal(state.members.length, 1, 'runner connections are not listed as members');
  } finally {
    await owner.close();
    await server.close();
  }
});

test('crosstalk run: a full disk or an unreachable hub stops it before the command runs', async () => {
  const lines: string[] = [];
  const marker = node('require("fs").writeFileSync(process.argv[1] ?? "", "")');
  const tooFull = await runWithSlot({ url: 'ws://127.0.0.1:9', channel: 'xt_AAAAAAAAAAAAAAAAAAAAAA', name: 'a', slot: 'heavy', max: 1, minFreeBytes: Number.MAX_SAFE_INTEGER, command: marker, log: l => lines.push(l) });
  assert.equal(tooFull, 1);
  assert.match(lines.join('\n'), /below the .* floor; not starting/);

  const noHub = await runWithSlot({ url: 'ws://127.0.0.1:9', channel: 'xt_AAAAAAAAAAAAAAAAAAAAAA', name: 'a', slot: 'heavy', max: 1, command: marker, log: l => lines.push(l) });
  assert.equal(noHub, 1);
  assert.match(lines.join('\n'), /can't reach the hub or channel/);
});

test('crosstalk run: a command that cannot start exits 127 and still releases', async () => {
  const server = await startServer({ port: 0, quiet: true });
  const owner = await CrossTalk.connect({ name: 'owner', url: server.url, reconnect: false });
  try {
    const ch = await owner.createChannel('builds');
    const code = await runWithSlot({ url: server.url, channel: ch.address, name: 'a', slot: 'heavy', max: 1, command: ['definitely-not-a-command-xt'], log: () => {} });
    assert.equal(code, 127);
    assert.deepEqual((await owner.request('channel.state', { channel: ch.address })).slots, []);
  } finally {
    await owner.close();
    await server.close();
  }
});

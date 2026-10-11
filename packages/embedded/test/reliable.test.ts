import test from 'node:test';
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { ReliableLink, crc16 } from '../src/transport/reliable.js';

/**
 * Two ends of a simulated radio. Every write is a "transmission" that may be
 * dropped, have bytes flipped, arrive split into pieces, or pick up noise.
 */
function radio(opts: { drop?: number; corrupt?: number; noise?: number; delayMs?: number; seed?: number }) {
  let seed = opts.seed ?? 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const stats = { sent: 0, dropped: 0, corrupted: 0 };
  const ends: Duplex[] = [];
  const make = (i: number) => new Duplex({
    read() {},
    write(chunk: Buffer, _enc, cb) {
      stats.sent++;
      const peer = ends[1 - i];
      cb();
      if (rand() < (opts.drop ?? 0)) { stats.dropped++; return; }
      let bytes = Buffer.from(chunk);
      if (rand() < (opts.corrupt ?? 0)) {
        stats.corrupted++;
        bytes[Math.floor(rand() * bytes.length)] ^= 1 << Math.floor(rand() * 8);
      }
      if (rand() < (opts.noise ?? 0)) bytes = Buffer.concat([Buffer.from([0xc7, 0x5a, 1, 9, 9]), bytes]);
      const cut = Math.max(1, Math.floor(rand() * bytes.length));
      setTimeout(() => { peer.push(bytes.subarray(0, cut)); peer.push(bytes.subarray(cut)); }, opts.delayMs ?? 1);
    }
  });
  ends.push(make(0), make(1));
  return { a: ends[0], b: ends[1], stats };
}

const collect = (link: ReliableLink, n: number) => new Promise<Buffer[]>((resolve, reject) => {
  const got: Buffer[] = [];
  link.on('message', m => { got.push(m as Buffer); if (got.length === n) resolve(got); });
  setTimeout(() => reject(new Error(`only ${got.length}/${n} messages arrived`)), 20_000);
});

test('CRC-16/CCITT-FALSE matches the standard check value', () => {
  assert.equal(crc16(Buffer.from('123456789')), 0x29b1);
});

test('messages arrive whole, in order and once over a clean link, split into small packets', async () => {
  const { a, b } = radio({});
  const tx = new ReliableLink(a, { mtu: 16, ackTimeoutMs: 50 });
  const rx = new ReliableLink(b, { mtu: 16, ackTimeoutMs: 50 });
  const messages = ['hi', 'x'.repeat(100), '@tiny-qwen in one sentence, what is CrossTalk for?', ''].map(s => Buffer.from(s));
  const arriving = collect(rx, messages.length);
  for (const m of messages) tx.send(m);
  assert.deepEqual((await arriving).map(String), messages.map(String));
  tx.close(); rx.close();
});

test('a lossy, noisy link still delivers every message exactly once', async () => {
  const { a, b, stats } = radio({ drop: 0.25, corrupt: 0.15, noise: 0.1, seed: 7 });
  const tx = new ReliableLink(a, { mtu: 24, ackTimeoutMs: 40, retries: 30 });
  const rx = new ReliableLink(b, { mtu: 24, ackTimeoutMs: 40, retries: 30 });
  const sent = Array.from({ length: 25 }, (_, i) => `msg ${i}: ` + 'payload '.repeat(i % 7));
  const arriving = collect(rx, sent.length);
  for (const m of sent) tx.send(m);
  const got = (await arriving).map(String);
  assert.deepEqual(got, sent, 'all delivered, in order, no duplicates');
  assert.ok(stats.dropped > 5 && stats.corrupted > 3, `the link really was lossy (${JSON.stringify(stats)})`);
  // Nothing extra trickles in afterwards from retransmissions.
  let extra = 0;
  rx.on('message', () => extra++);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(extra, 0);
  tx.close(); rx.close();
});

test('both ends can talk at once (half-duplex collisions are retried)', async () => {
  const { a, b } = radio({ drop: 0.1, seed: 3 });
  const left = new ReliableLink(a, { mtu: 32, ackTimeoutMs: 40, retries: 30 });
  const right = new ReliableLink(b, { mtu: 32, ackTimeoutMs: 40, retries: 30 });
  const atRight = collect(right, 10);
  const atLeft = collect(left, 10);
  for (let i = 0; i < 10; i++) { left.send(`L${i}`); right.send(`R${i}`); }
  assert.deepEqual((await atRight).map(String), Array.from({ length: 10 }, (_, i) => `L${i}`));
  assert.deepEqual((await atLeft).map(String), Array.from({ length: 10 }, (_, i) => `R${i}`));
  left.close(); right.close();
});

test('a dead link reports the message as lost instead of hanging', async () => {
  const { a } = radio({ drop: 1 });
  const tx = new ReliableLink(a, { ackTimeoutMs: 10, retries: 2 });
  const failed = new Promise<Error>(r => tx.once('error', r));
  tx.send('anyone there?');
  assert.match((await failed).message, /lost after 2 resends/);
  tx.close();
});

test('duty cycle spaces transmissions out', async () => {
  const { a, b } = radio({});
  // 1,000 bps and a 10% duty cycle: the 13-byte packet for 'one' is ~130 ms of airtime, so ~1.3 s in total before the next.
  const tx = new ReliableLink(a, { mtu: 64, bitrate: 1000, dutyCycle: 0.1, ackTimeoutMs: 5000 });
  const rx = new ReliableLink(b, { mtu: 64 });
  const arriving = collect(rx, 2);
  const started = Date.now();
  tx.send('one'); tx.send('two');
  await arriving;
  assert.ok(Date.now() - started > 1200, `second packet waited for the duty cycle (${Date.now() - started} ms)`);
  tx.close(); rx.close();
});

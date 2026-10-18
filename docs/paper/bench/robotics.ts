// Benchmarks behind the robotics paper (docs/paper/robotics.html). Run from the repo root after `npm run build`:
//   npx tsx docs/paper/bench/robotics.ts            # all experiments, writes robotics-results.json
//   npx tsx docs/paper/bench/robotics.ts dock       # one experiment: dock | radio | tokens
// `tokens` needs a tokenizer: `npm i --no-save js-tiktoken@1.0.15` (it is skipped otherwise).
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CrossTalk, DialectEngine, startServer } from '../../../dist/index.js';
import { BinaryCodec, BinaryOpcode, DeviceBridge, ReliableLink, type BinaryFrame, type ICrossTalkTransport } from '../../../packages/embedded/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const pct = (v: number[], p: number) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

/** The device side of a bridge, in memory: frames the device sends go in `deliver`, frames it receives come out as events. */
class DeviceLink extends EventEmitter implements ICrossTalkTransport {
  isConnected = true;
  bytesUp = 0;
  bytesDown = 0;
  framesUp = 0;
  framesDown = 0;
  send(data: Buffer | string): void {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.bytesDown += buf.length;
    this.framesDown++;
    const frame = BinaryCodec.decode(buf);
    if (frame) queueMicrotask(() => this.emit('frame', frame));
  }
  close(): void {
    this.isConnected = false;
  }
  deliver(opcode: BinaryOpcode, payload: Buffer | string = Buffer.alloc(0)): void {
    const buf = BinaryCodec.encode({ opcode, flags: {}, timestamp: Date.now(), payload });
    this.bytesUp += buf.length;
    this.framesUp++;
    this.emit('message', buf);
  }
}

/**
 * R1: rovers sharing charging docks. Each rover is a device behind a real
 * DeviceBridge, speaking the binary frame protocol. A rover works, then needs
 * to charge. Without coordination it drives to a dock it picks at random. With
 * CrossTalk it sends LOCK_ACQUIRE for dock/charger-k; on LOCK_DENIED it tries
 * the next dock, and when all are taken it waits for a release frame.
 * We count collisions: a rover arriving at a dock another rover occupies.
 */
async function dock() {
  const out: any[] = [];
  for (const docks of [1, 2]) {
    for (const rovers of [4, 8]) {
      for (const mode of ['none', 'locks'] as const) {
        for (let seed = 1; seed <= 3; seed++) {
          const r = await dockRun({ docks, rovers, mode, seed, durationMs: 6000 });
          out.push(r);
          console.error(`dock docks=${docks} rovers=${rovers} mode=${mode} seed=${seed} charges=${r.charges} collisions=${r.collisions} wait=${r.meanWaitMs}ms`);
        }
      }
    }
  }
  return out;
}

async function dockRun({ docks, rovers, mode, seed, durationMs }: { docks: number; rovers: number; mode: 'none' | 'locks'; seed: number; durationMs: number }) {
  const server = await startServer({ port: 0, quiet: true });
  const owner = await CrossTalk.connect({ url: server.url, name: 'yard', reconnect: false });
  const ch = await owner.createChannel('yard');
  const occupancy = new Map<string, Set<number>>();
  const busyMs = new Map<string, number>();
  for (let d = 0; d < docks; d++) { occupancy.set(`dock/charger-${d}`, new Set()); busyMs.set(`dock/charger-${d}`, 0); }
  let collisions = 0;
  let charges = 0;
  const waits: number[] = [];
  const links: DeviceLink[] = [];
  const bridges: DeviceBridge[] = [];
  const stopAt = performance.now() + durationMs;

  for (let i = 0; i < rovers; i++) {
    const link = new DeviceLink();
    const bridge = new DeviceBridge({ transport: link, channel: ch.address, name: `rover-${i}`, hub: { url: server.url, reconnect: false }, registerWindowMs: 0 });
    await bridge.start();
    links.push(link);
    bridges.push(bridge);
  }

  const next = (link: DeviceLink, pred: (f: BinaryFrame) => boolean, timeoutMs: number) =>
    new Promise<BinaryFrame | null>(resolve => {
      const t = setTimeout(() => { link.off('frame', on); resolve(null); }, timeoutMs);
      const on = (f: BinaryFrame) => { if (pred(f)) { clearTimeout(t); link.off('frame', on); resolve(f); } };
      link.on('frame', on);
    });
  const target = (f: BinaryFrame) => DialectEngine.unpackFromBits(f.raw!).parsed.target;

  await Promise.all(links.map(async (link, i) => {
    const rand = rng(seed * 100 + i);
    await sleep(rand() * 300);
    while (performance.now() < stopAt) {
      await sleep(300 + rand() * 300); // work until the battery is low
      if (performance.now() >= stopAt) break;
      const asked = performance.now();
      let dockName: string | null = null;
      if (mode === 'none') {
        dockName = `dock/charger-${Math.floor(rand() * docks)}`;
      } else {
        while (!dockName && performance.now() < stopAt) {
          for (let d = 0; d < docks && !dockName; d++) {
            const name = `dock/charger-${d}`;
            const reply = next(link, f => (f.opcode === BinaryOpcode.LOCK_ACK || f.opcode === BinaryOpcode.LOCK_DENIED) && !!f.flags.isResponse, 2000);
            link.deliver(BinaryOpcode.LOCK_ACQUIRE, DialectEngine.packToBits(`!LCK @${name} "charging" ~60`));
            const f = await reply;
            if (f?.opcode === BinaryOpcode.LOCK_ACK) dockName = name;
          }
          // Every dock is taken: wait for someone's release frame, then try again.
          if (!dockName) await next(link, f => f.opcode === BinaryOpcode.LOCK_RELEASE && !f.flags.isResponse, 1000);
        }
        if (!dockName) break;
      }
      waits.push(performance.now() - asked);
      await sleep(50); // drive to the dock
      const occ = occupancy.get(dockName)!;
      if (occ.size > 0) collisions++;
      occ.add(i);
      const start = performance.now();
      await sleep(200); // charge
      occ.delete(i);
      busyMs.set(dockName, busyMs.get(dockName)! + (performance.now() - start));
      charges++;
      if (mode === 'locks') {
        const ack = next(link, f => f.opcode === BinaryOpcode.LOCK_ACK && !!f.flags.isResponse, 2000);
        link.deliver(BinaryOpcode.LOCK_RELEASE, DialectEngine.packToBits(`!REL @${dockName} &DONE`));
        await ack;
      }
    }
  }));

  const bytes = links.reduce((s, l) => s + l.bytesUp + l.bytesDown, 0);
  const frames = links.reduce((s, l) => s + l.framesUp + l.framesDown, 0);
  for (const b of bridges) await b.stop();
  await owner.close();
  await server.close();
  return {
    docks, rovers, mode, seed, durationMs, charges, collisions,
    collisionRate: round(charges ? (100 * collisions) / charges : 0),
    meanWaitMs: Math.round(mean(waits)), p95WaitMs: Math.round(pct(waits, 95)),
    dockUtilization: round((100 * [...busyMs.values()].reduce((a, b) => a + b, 0)) / (docks * durationMs)),
    linkBytesPerCharge: Math.round(bytes / Math.max(1, charges)),
    linkFramesPerCharge: round(frames / Math.max(1, charges))
  };
}

/** A half-duplex radio between two modules: each write takes airtime at `bitrate`, may be dropped, or may arrive with one byte flipped. */
function radio(drop: number, corrupt: number, bitrate: number, seed: number) {
  const rand = rng(seed);
  const ends: Duplex[] = [];
  const air = { bytes: 0 };
  const make = (i: number) => new Duplex({
    read() {},
    write(chunk: Buffer, _e, cb) {
      cb();
      air.bytes += chunk.length;
      const delay = (chunk.length * 8 * 1000) / bitrate + 2;
      if (rand() < drop) return;
      const bytes = Buffer.from(chunk);
      if (rand() < corrupt) bytes[Math.floor(rand() * bytes.length)] ^= 0x10;
      setTimeout(() => ends[1 - i].push(bytes), delay);
    }
  });
  ends.push(make(0), make(1));
  return { ends, air };
}

/**
 * R2: messages over a lossy 9,600 bit/s radio. 40 messages of 120 bytes (a
 * status line or a short model reply) cross from one end to the other, one at a
 * time. "checksums only" sends each packet once (retries: 0); "reliable" is the
 * default ReliableLink with acknowledgements and up to 6 resends.
 */
async function radioExp() {
  const out: any[] = [];
  for (const loss of [0, 0.05, 0.1, 0.2, 0.3]) {
    for (const mode of ['checksums only', 'reliable'] as const) {
      const { ends, air } = radio(loss, loss / 2, 9600, 7 + Math.round(loss * 100));
      const opts = { mtu: 64, ackTimeoutMs: 250, retries: mode === 'reliable' ? 6 : 0, bitrate: 9600 };
      const a = new ReliableLink(ends[0], opts);
      const b = new ReliableLink(ends[1], opts);
      a.on('error', () => {});
      b.on('error', () => {});
      const count = 40;
      const size = 120;
      const latencies: number[] = [];
      let intact = 0;
      for (let m = 0; m < count; m++) {
        const body = Buffer.alloc(size, 0x41 + (m % 26));
        body.write(`msg ${m} `);
        const got = new Promise<Buffer | null>(resolve => {
          const t = setTimeout(() => { b.off('message', on); resolve(null); }, 3000);
          const on = (buf: Buffer) => { clearTimeout(t); b.off('message', on); resolve(buf); };
          b.on('message', on);
        });
        const t0 = performance.now();
        a.send(body);
        const buf = await got;
        if (buf && buf.equals(body)) { intact++; latencies.push(performance.now() - t0); }
        await sleep(20);
      }
      a.close();
      b.close();
      out.push({
        loss, corrupt: loss / 2, mode, messages: count, bytesPerMessage: size, intact,
        intactPct: round((100 * intact) / count), meanLatencyMs: Math.round(mean(latencies)), p95LatencyMs: Math.round(pct(latencies, 95)),
        airBytesPerPayloadByte: round(air.bytes / (count * size), 2)
      });
      console.error(`radio loss=${loss} mode=${mode} intact=${intact}/${count} mean=${out.at(-1).meanLatencyMs}ms air/payload=${out.at(-1).airBytesPerPayloadByte}`);
    }
  }
  return out;
}

/**
 * R3: what a model reads during one pick-and-place task. The skill menu and
 * event lines follow the format proposed in issues #5 and #6; the joint-state
 * line is one ROS 2 sensor_msgs/JointState message as rosbridge sends it.
 */
const transcript = [
  'bot1 skills: go(place) pick(object) drop(place) look() stop()',
  'cam1: +cube-red table 0.92',
  'cam1: +cube-blue table 0.88',
  'josh: @planner put the red cube in bin 2',
  '@bot1 pick cube-red',
  'bot1: pick fail unreachable',
  '@bot1 go table',
  'bot1: go done',
  '@bot1 pick cube-red',
  'bot1: pick done',
  '@bot1 drop bin-2',
  'bot1: drop done',
  'cam1: -cube-red table',
  'cam1: +cube-red bin-2 0.95'
];
const jointState = JSON.stringify({
  op: 'publish', topic: '/joint_states',
  msg: {
    header: { stamp: { sec: 1760812345, nanosec: 123456789 }, frame_id: '' },
    name: ['shoulder_pan_joint', 'shoulder_lift_joint', 'elbow_joint', 'wrist_1_joint', 'wrist_2_joint', 'wrist_3_joint'],
    position: [0.0123, -1.5708, 1.2041, -1.2042, -1.5707, 0.0001],
    velocity: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    effort: [0.112, -2.401, 1.336, 0.204, 0.012, 0.001]
  }
});

async function tokens() {
  let enc: { encode(s: string): number[] };
  try {
    // XT_TIKTOKEN can point at a js-tiktoken installed elsewhere (a path to its entry file).
    const mod: any = await import(process.env.XT_TIKTOKEN ?? 'js-tiktoken');
    enc = mod.getEncoding('o200k_base');
  } catch {
    console.error('tokens: js-tiktoken not installed, skipping (npm i --no-save js-tiktoken@1.0.15)');
    return undefined;
  }
  const lines = transcript.map(l => ({ line: l, tokens: enc.encode(l).length }));
  const total = lines.reduce((s, l) => s + l.tokens, 0);
  const decisions = transcript.filter(l => l.startsWith('@')).length;
  return {
    tokenizer: 'o200k_base', lines, total, decisions,
    menuTokens: lines[0].tokens,
    commandTokens: lines.filter(l => l.line.startsWith('@')).map(l => l.tokens),
    jointStateMessageTokens: enc.encode(jointState).length,
    // Anthropic documents image cost as about width × height / 750 tokens.
    imageTokens640x480: Math.round((640 * 480) / 750)
  };
}

const experiments: Record<string, () => Promise<unknown>> = { dock, radio: radioExp, tokens };
const pick = process.argv[2];
const file = path.join(here, 'robotics-results.json');
let results: any = {};
try { results = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
results.machine = { cpu: os.cpus()[0]?.model, cores: os.cpus().length, node: process.version, platform: `${os.platform()} ${os.release()}` };
results.ranAt = new Date().toISOString();
for (const [name, fn] of Object.entries(experiments)) {
  if (pick && pick !== name) continue;
  const r = await fn();
  if (r !== undefined) results[name] = r;
}
await fs.writeFile(file, JSON.stringify(results, null, 2) + '\n');
console.error(`wrote ${path.relative(process.cwd(), file)}`);
process.exit(0);

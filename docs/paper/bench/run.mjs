// Benchmarks behind the CrossTalk paper (docs/paper). Run after `npm run build`:
//   node docs/paper/bench/run.mjs            # all experiments, writes results.json
//   node docs/paper/bench/run.mjs edits      # one experiment: edits | fanout | stall
// Every experiment starts its own hub on a random port with stock settings.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CrossTalk, startServer } from '../../../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Small seeded PRNG so runs are repeatable.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pct(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
const mean = v => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

async function hub() {
  const server = await startServer({ port: 0, quiet: true });
  return server;
}

/**
 * E1: concurrent read-modify-write edits on shared files.
 * Each agent repeatedly picks a file, reads it, "thinks" for 5–40 ms, appends
 * one line and writes it back. Without coordination, overlapping edits
 * overwrite each other; with a CrossTalk lock around each edit they shouldn't.
 */
async function edits() {
  const out = [];
  const editsPerAgent = 25;
  for (const files of [4, 16]) {
    for (const agents of [2, 4, 8]) {
      for (const mode of ['none', 'locks']) {
        for (let seed = 1; seed <= 5; seed++) {
          out.push(await editRun({ files, agents, mode, seed, editsPerAgent }));
          const r = out.at(-1);
          console.error(`edits files=${files} agents=${agents} mode=${mode} seed=${seed} lost=${r.lost}/${r.attempted} makespan=${r.makespanMs}ms`);
        }
      }
    }
  }
  return out;
}

async function editRun({ files, agents, mode, seed, editsPerAgent }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xt-bench-'));
  const names = Array.from({ length: files }, (_, i) => `src/file${i}.txt`);
  await fs.mkdir(path.join(dir, 'src'));
  for (const n of names) await fs.writeFile(path.join(dir, n), '');

  const server = await hub();
  const clients = [];
  for (let i = 0; i < agents; i++) clients.push(await CrossTalk.connect({ url: server.url, name: `agent${i}`, reconnect: false }));
  const ch0 = await clients[0].createChannel('bench');
  const channels = [ch0, ...(await Promise.all(clients.slice(1).map(c => c.joinChannel(ch0.address))))];

  const lockRtt = [];
  const lockWait = [];
  let contended = 0;
  let rateLimited = 0;

  const t0 = performance.now();
  await Promise.all(channels.map(async (ch, a) => {
    const rand = rng(seed * 1000 + a);
    for (let e = 0; e < editsPerAgent; e++) {
      const file = names[Math.floor(rand() * files)];
      const think = 5 + rand() * 35;
      if (mode === 'locks') {
        const start = performance.now();
        let backoff = 10;
        for (;;) {
          const t = performance.now();
          try {
            await ch.lock(file, 'bench edit', 30);
            lockRtt.push(performance.now() - t);
            break;
          } catch (err) {
            if (err.code === 'lock_held') contended++;
            else if (err.code === 'rate_limited') rateLimited++;
            else throw err;
            await sleep(backoff + rand() * backoff);
            backoff = Math.min(backoff * 2, 160);
          }
        }
        lockWait.push(performance.now() - start);
      }
      const full = path.join(dir, file);
      const before = await fs.readFile(full, 'utf8');
      await sleep(think);
      await fs.writeFile(full, before + `agent${a} edit${e}\n`);
      if (mode === 'locks') await ch.unlock(file);
    }
  }));
  const makespanMs = performance.now() - t0;

  let landed = 0;
  for (const n of names) landed += (await fs.readFile(path.join(dir, n), 'utf8')).split('\n').filter(Boolean).length;
  await Promise.all(clients.map(c => c.close()));
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });

  const attempted = agents * editsPerAgent;
  return {
    files, agents, mode, seed, attempted, landed, lost: attempted - landed,
    makespanMs: Math.round(makespanMs), contended, rateLimited,
    lockRttMs: lockRtt.length ? { p50: round(pct(lockRtt, 50)), p99: round(pct(lockRtt, 99)) } : null,
    lockWaitMs: lockWait.length ? { mean: round(mean(lockWait)), p95: round(pct(lockWait, 95)) } : null
  };
}

/**
 * E2: message fan-out latency. One sender posts 100 messages, 2 a second
 * (inside the default 120-a-minute per-member channel limit), to a channel of N members;
 * we time send → receive at every other member. Same process, same clock.
 */
async function fanout() {
  const out = [];
  for (const members of [2, 5, 10, 25, 50]) {
    const server = await hub();
    const clients = [];
    for (let i = 0; i < members; i++) clients.push(await CrossTalk.connect({ url: server.url, name: `m${i}`, reconnect: false }));
    const ch0 = await clients[0].createChannel('fanout');
    const chans = [ch0, ...(await Promise.all(clients.slice(1).map(c => c.joinChannel(ch0.address))))];
    const latencies = [];
    const lastArrival = new Map();
    for (const ch of chans.slice(1)) {
      ch.on('message', msg => {
        const sent = msg.metadata?.sentAt;
        if (typeof sent !== 'number') return;
        const now = performance.now();
        latencies.push(now - sent);
        lastArrival.set(msg.metadata.seq, Math.max(lastArrival.get(msg.metadata.seq) ?? 0, now - sent));
      });
    }
    const count = 100;
    for (let s = 0; s < count; s++) {
      await ch0.send(`tick ${s}`, { sentAt: performance.now(), seq: s });
      await sleep(500);
    }
    await sleep(500);
    const expected = count * (members - 1);
    const all = [...lastArrival.values()];
    out.push({
      members, messages: count, deliveries: latencies.length, expected,
      perDeliveryMs: { p50: round(pct(latencies, 50)), p95: round(pct(latencies, 95)), p99: round(pct(latencies, 99)), max: round(Math.max(...latencies)) },
      lastMemberMs: { p50: round(pct(all, 50)), p99: round(pct(all, 99)) }
    });
    console.error(`fanout members=${members} deliveries=${latencies.length}/${expected} p50=${out.at(-1).perDeliveryMs.p50}ms p99=${out.at(-1).perDeliveryMs.p99}ms`);
    await Promise.all(clients.map(c => c.close()));
    await server.close();
  }
  return out;
}

/**
 * E3: how long a silent "on it" takes to surface. Three agents claim tasks
 * with the minimum 60 s heartbeat and then go quiet; an observer records when
 * each claim.updated(stalled) event arrives.
 */
async function stall() {
  const server = await hub();
  const observer = await CrossTalk.connect({ url: server.url, name: 'observer', reconnect: false });
  const ch = await observer.createChannel('stall');
  const workers = [];
  for (let i = 0; i < 3; i++) workers.push(await CrossTalk.connect({ url: server.url, name: `worker${i}`, reconnect: false }));
  const wchans = await Promise.all(workers.map(w => w.joinChannel(ch.address)));
  const claimedAt = new Map();
  const results = [];
  const done = new Promise(resolve => {
    ch.on('claim.updated', claim => {
      if (claim.status !== 'stalled' || !claimedAt.has(claim.id)) return;
      const silentMs = Date.now() - claimedAt.get(claim.id);
      results.push({ claim: claim.id, everySeconds: 60, silentMs, overdueMs: silentMs - 60_000 });
      console.error(`stall ${claim.id} detected after ${silentMs} ms`);
      if (results.length === workers.length) resolve();
    });
  });
  for (const [i, wc] of wchans.entries()) {
    const c = await wc.claim(`task ${i}`, { everySeconds: 60 });
    claimedAt.set(c.id, Date.now());
    await sleep(1700); // stagger so the claims fall at different points of the sweep cycle
  }
  await Promise.race([done, sleep(90_000)]);
  await Promise.all([observer, ...workers].map(c => c.close()));
  await server.close();
  return results;
}

const experiments = { edits, fanout, stall };
const pick = process.argv[2];
const file = path.join(here, 'results.json');
let results = {};
try { results = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
results.machine = { cpu: os.cpus()[0]?.model, cores: os.cpus().length, node: process.version, platform: `${os.platform()} ${os.release()}` };
results.ranAt = new Date().toISOString();
for (const [name, fn] of Object.entries(experiments)) {
  if (pick && pick !== name) continue;
  results[name] = await fn();
}
await fs.writeFile(file, JSON.stringify(results, null, 2) + '\n');
console.error(`wrote ${path.relative(process.cwd(), file)}`);
process.exit(0);

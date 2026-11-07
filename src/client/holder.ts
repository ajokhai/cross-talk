import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { CrossTalk, CrossTalkError, type Channel } from './sdk.js';
import type { FileLock } from '../protocol.js';

/**
 * Long-lived file locks for the command line.
 *
 * A hub releases a lock as soon as its holder's connection closes, so a
 * one-shot `crosstalk lock` would lose its lock the moment it exited. Instead
 * the CLI hands the lock to a small background process, the holder: one per
 * (hub, channel, agent name), on one connection for all of that agent's locks.
 * The holder renews locks past the hub's 30-minute cap until the time asked
 * for, keeps a lock while its file still has uncommitted changes, can let go
 * as soon as the file is committed (`--until-commit`), and exits once it holds
 * nothing. Stopping it (or `crosstalk unlock --all`) releases everything at
 * once; if it is killed outright, the hub releases its locks after its
 * presence grace period.
 *
 * The CLI talks to the holder over a local socket (a named pipe on Windows):
 * one JSON line in, one JSON line out.
 */

export interface HolderTarget {
  url: string;
  channel: string;
  name: string;
  token?: string;
}

export interface HeldLock {
  file: string;
  reason: string;
  acquiredAt: number;
  /** When the holder lets go, unless the file still has uncommitted changes. */
  deadline: number;
  /** When the hub's current lease runs out (renewed before then). */
  expiresAt: number;
  untilCommit: boolean;
  /** Times the deadline was pushed back because the file had uncommitted changes. */
  extended: number;
}

export type HolderRequest =
  | { op: 'ping' }
  | { op: 'lock'; files: string[]; root: string; reason: string; minutes: number; untilCommit: boolean }
  | { op: 'unlock'; files?: string[]; all?: boolean }
  | { op: 'list' };

export interface UnlockOutcome {
  file: string;
  released: boolean;
  /** Why nothing was released. */
  note?: string;
}

export type HolderResponse =
  | { ok: true; pid?: number; locks?: HeldLock[]; results?: UnlockOutcome[] }
  | { ok: false; code: string; message: string; lock?: FileLock };

/** Renew a lease when less than this is left on it. */
const RENEW_MARGIN_MS = 90_000;
/** The hub's longest lease by default. */
const MAX_LEASE_S = 30 * 60;
/** How far a deadline moves when the file still has uncommitted changes. */
const EXTEND_MS = 10 * 60_000;
/** A holder that holds nothing exits after this long. */
const IDLE_EXIT_MS = Number(process.env.CROSSTALK_HOLDER_IDLE_MS) || 30_000;
const TICK_MS = Number(process.env.CROSSTALK_HOLDER_TICK_MS) || 5_000;
/** Cut off from the hub this long, the hub has released our locks anyway (after its grace period), so the holder exits. */
const GONE_EXIT_MS = Number(process.env.CROSSTALK_HOLDER_GONE_MS) || 3 * 60_000;

export function holderDir(): string {
  return process.env.CROSSTALK_HOLDERS_DIR || path.join(os.homedir(), '.crosstalk', 'holders');
}

export function holderSocket(target: HolderTarget): string {
  const key = crypto.createHash('sha256').update(`${target.url}\n${target.channel}\n${target.name.toLowerCase()}`).digest('hex').slice(0, 20);
  return process.platform === 'win32' ? `\\\\.\\pipe\\crosstalk-holder-${key}` : path.join(holderDir(), `${key}.sock`);
}

/** Sends one request to the holder for `target`. Rejects with code ENOENT/ECONNREFUSED when none is running. */
export function askHolder(target: HolderTarget, request: HolderRequest, timeoutMs = 15_000): Promise<HolderResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(holderSocket(target));
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error('The lock holder did not answer'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      clearTimeout(timer);
      socket.end();
      try {
        resolve(JSON.parse(buffer.slice(0, end)));
      } catch (err) {
        reject(err);
      }
    });
    socket.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

const notRunning = (err: any) => err?.code === 'ENOENT' || err?.code === 'ECONNREFUSED';

/** Answers from the running holder, or undefined when there is none. */
export async function holderIfRunning(target: HolderTarget, request: HolderRequest): Promise<HolderResponse | undefined> {
  try {
    return await askHolder(target, request);
  } catch (err) {
    if (notRunning(err)) return undefined;
    throw err;
  }
}

/** Makes sure a holder is running for `target`, starting one in the background if needed. */
export async function ensureHolder(target: HolderTarget, command: string[]): Promise<void> {
  if (await holderIfRunning(target, { op: 'ping' })) return;
  fs.mkdirSync(holderDir(), { recursive: true, mode: 0o700 });
  const log = fs.openSync(path.join(holderDir(), 'holder.log'), 'a', 0o600);
  const child = spawn(command[0], [...command.slice(1), '--url', target.url, '--channel', target.channel, '--name', target.name], {
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, ...(target.token ? { CROSSTALK_AUTH_TOKEN: target.token } : {}) },
    windowsHide: true
  });
  child.unref();
  fs.closeSync(log);
  const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (await holderIfRunning(target, { op: 'ping' }).catch(() => undefined)) return;
    const code = await Promise.race([exited, new Promise<undefined>(r => setTimeout(r, 150))]);
    if (code !== undefined) {
      throw new Error(`The lock holder exited (code ${code}) before it was ready; see ${path.join(holderDir(), 'holder.log')}`);
    }
  }
  throw new Error(`The lock holder did not start within 20s; see ${path.join(holderDir(), 'holder.log')}`);
}

/**
 * Runs git and returns its output, or `fallback` when git ran and said no (a
 * non-zero exit: the path isn't in HEAD, not a git checkout). Returns
 * undefined when git couldn't run at all (a loaded machine refusing a new
 * process, a timeout): the caller can't tell anything this time and must not
 * act as if the file were clean.
 */
function git(root: string, args: string[], fallback: string): string | undefined {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 }).toString().trim();
  } catch (err) {
    return typeof (err as { status?: unknown }).status === 'number' ? fallback : undefined;
  }
}

/**
 * The blob id `file` (repo-relative) has in HEAD at `root`; '' when HEAD
 * doesn't have it (a new file, no commits yet, not a git checkout);
 * undefined when git couldn't run.
 */
function committedBlob(root: string, file: string): string | undefined {
  return git(root, ['rev-parse', '-q', '--verify', `HEAD:${file}`], '');
}

/** Whether `file` (repo-relative) has uncommitted changes, staged or not, at `root`; undefined when git couldn't run. */
function hasUncommittedChanges(root: string, file: string): boolean | undefined {
  const out = git(root, ['status', '--porcelain', '--', file], '');
  return out === undefined ? undefined : out !== '';
}

interface Entry extends HeldLock {
  root: string;
  sawChanges: boolean;
  /** The file's blob in HEAD when it was locked ('' if not committed then; undefined if git couldn't say). */
  baseBlob?: string;
}

/** True when HEAD has a different version of the file than when it was locked; false when git can't say. */
function headMoved(e: Entry): boolean {
  if (e.baseBlob === undefined) return false;
  const now = committedBlob(e.root, e.file);
  return now !== undefined && now !== e.baseBlob;
}

/** Runs the holder in this process until it holds nothing for a while, or is stopped. */
export async function runHolder(target: HolderTarget): Promise<void> {
  const socketPath = holderSocket(target);
  const log = (line: string) => console.log(`${new Date().toISOString()} [${target.name} ${target.channel}] ${line}`);

  const ct = await CrossTalk.connect({ name: target.name, url: target.url, token: target.token, role: 'locks', environment: 'terminal', currentTask: 'holding file locks' });
  ct.on('error', err => log(`error: ${(err as Error).message}`));
  let ch: Channel = await ct.joinChannel(target.channel);
  const held = new Map<string, Entry>();
  let lastRequest = Date.now();
  /**
   * starting ──socket listening──▶ serving ◀──reconnected── disconnected(since)
   *                                   │  ▲                        ▲
   *                                   │  └── re-taken ── recovering (after locks.lost)
   *                                   └── idle, signal, lost channel, cut off ──▶ stopping (final)
   * Only `serving` renews and releases locks; only `disconnected` counts toward giving up.
   */
  let phase: { kind: 'starting' } | { kind: 'serving' } | { kind: 'disconnected'; since: number } | { kind: 'recovering' } | { kind: 'stopping' } = { kind: 'starting' };
  /** True once this process owns the socket file, so only it ever removes it. */
  let ownsSocket = false;
  let ticker: NodeJS.Timeout | undefined;
  ct.on('disconnected', () => {
    if (phase.kind === 'serving' || phase.kind === 'recovering') phase = { kind: 'disconnected', since: Date.now() };
  });

  const lease = (e: Entry) => Math.max(5, Math.min(MAX_LEASE_S, Math.ceil((e.deadline - Date.now()) / 1000) + 60));

  const release = async (file: string, why: string): Promise<UnlockOutcome> => {
    held.delete(file);
    try {
      const result = await ch.unlock(file);
      log(`released ${file} (${why})`);
      return { file, released: result.released !== false, note: result.released === false ? 'the hub had already let it go' : undefined };
    } catch (err) {
      return { file, released: false, note: (err as Error).message };
    }
  };

  const stop = async (why: string) => {
    if (phase.kind === 'stopping') return;
    phase = { kind: 'stopping' };
    log(`stopping: ${why}`);
    clearInterval(ticker);
    server.close();
    // A deliberate close: the hub releases every lock straight away.
    await ct.close().catch(() => {});
    if (ownsSocket && process.platform !== 'win32') fs.rmSync(socketPath, { force: true });
    process.exit(0);
  };

  ct.on('locks.lost', async () => {
    // The hub forgot us (restarted without saved state, or we were away too long). Take back what we can.
    // While recovering, the ticker leaves `held` alone (the hub's snapshot doesn't have our locks yet).
    if (phase.kind === 'stopping') return;
    phase = { kind: 'recovering' };
    for (const e of [...held.values()]) {
      try {
        const lock = await ch.lock(e.file, e.reason, lease(e));
        e.expiresAt = lock.expiresAt;
        log(`re-took ${e.file} after the hub lost it`);
      } catch (err) {
        held.delete(e.file);
        log(`lost ${e.file}: ${(err as Error).message}`);
      }
    }
    if (phase.kind === 'recovering') phase = { kind: 'serving' };
  });
  ct.on('channel.lost', () => void stop('the hub no longer has this channel'));
  ct.on('reconnected', () => {
    const again = ct.channels.get(target.channel);
    if (again) ch = again;
    // locks.lost (emitted just before) may have us recovering; it moves on to serving itself.
    if (phase.kind === 'disconnected') phase = { kind: 'serving' };
  });

  const tick = async () => {
    const now = Date.now();
    if (phase.kind === 'disconnected') {
      if (now - phase.since > GONE_EXIT_MS) await stop('cut off from the hub');
      return;
    }
    if (phase.kind !== 'serving') return;
    for (const e of [...held.values()]) {
      const live = ch.locks.get(e.file);
      if (!live || live.holder.id !== ct.agent.id) {
        held.delete(e.file);
        log(`no longer holding ${e.file}`);
        continue;
      }
      const changed = hasUncommittedChanges(e.root, e.file);
      if (changed === undefined) {
        // git couldn't run (a loaded machine): decide nothing this tick, just keep the lease alive below.
        log(`could not run git for ${e.file}; checking again next tick`);
      } else {
        if (changed) e.sawChanges = true;
        // Committed: changes were seen and are gone, or HEAD has a new version of
        // the file (an edit and its commit can both land between two ticks).
        if (e.untilCommit && !changed && (e.sawChanges || headMoved(e))) {
          await release(e.file, 'committed');
          continue;
        }
      }
      if (changed !== undefined && now >= e.deadline) {
        if (changed) {
          e.deadline = now + EXTEND_MS;
          e.extended++;
          log(`kept ${e.file} 10 more minutes: it still has uncommitted changes`);
        } else {
          await release(e.file, 'time is up');
          continue;
        }
      }
      if (live.expiresAt - now < RENEW_MARGIN_MS) {
        try {
          e.expiresAt = (await ch.lock(e.file, e.reason, lease(e))).expiresAt;
        } catch (err) {
          log(`could not renew ${e.file}: ${(err as Error).message}`);
        }
      }
    }
    if (!held.size && Date.now() - lastRequest > IDLE_EXIT_MS) await stop('holding nothing');
  };

  const handle = async (req: HolderRequest): Promise<HolderResponse> => {
    lastRequest = Date.now();
    switch (req.op) {
      case 'ping':
        return { ok: true, pid: process.pid };
      case 'list':
        return { ok: true, locks: [...held.values()].map(({ root: _root, sawChanges: _seen, baseBlob: _base, ...lock }) => lock) };
      case 'lock': {
        // All or nothing: if any file is held by someone else, give back the ones this request took.
        const taken: string[] = [];
        for (const file of req.files) {
          const already = held.get(file);
          const minutes = Number.isFinite(req.minutes) && req.minutes > 0 ? req.minutes : 30;
          const entry: Entry = {
            file,
            reason: req.reason,
            acquiredAt: already?.acquiredAt ?? Date.now(),
            deadline: Date.now() + minutes * 60_000,
            expiresAt: 0,
            untilCommit: req.untilCommit,
            extended: 0,
            root: req.root,
            sawChanges: already?.sawChanges ?? false,
            baseBlob: already?.baseBlob ?? committedBlob(req.root, file)
          };
          try {
            const lock = await ch.lock(file, req.reason, lease(entry));
            entry.expiresAt = lock.expiresAt;
            entry.acquiredAt = already ? entry.acquiredAt : lock.acquiredAt;
            held.set(file, entry);
            if (!already) taken.push(file);
          } catch (err) {
            for (const f of taken) await release(f, 'part of a lock set that failed');
            const e = err as CrossTalkError;
            return { ok: false, code: e.code ?? 'error', message: e.message, lock: e.code === 'lock_held' ? (e.details as FileLock) : undefined };
          }
        }
        log(`locked ${req.files.join(', ')}`);
        return { ok: true, locks: req.files.map(f => held.get(f)!).map(({ root: _root, sawChanges: _seen, baseBlob: _base, ...lock }) => lock) };
      }
      case 'unlock': {
        const files = req.all ? [...held.keys()] : req.files ?? [];
        const results: UnlockOutcome[] = [];
        for (const file of files) {
          if (held.has(file)) results.push(await release(file, 'unlocked'));
          else {
            const other = ch.locks.get(file);
            results.push({ file, released: false, note: other ? `held by ${other.holder.name}, not this holder` : 'not held by this holder' });
          }
        }
        if (!held.size) lastRequest = Date.now() - IDLE_EXIT_MS + 2_000; // exit soon after the last unlock
        return { ok: true, results };
      }
      default:
        return { ok: false, code: 'bad_request', message: 'Unknown holder request' };
    }
  };

  const server = net.createServer(socket => {
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      let req: HolderRequest;
      try {
        req = JSON.parse(buffer.slice(0, end));
      } catch {
        socket.end(JSON.stringify({ ok: false, code: 'bad_request', message: 'Not JSON' }) + '\n');
        return;
      }
      handle(req).then(
        res => socket.end(JSON.stringify(res) + '\n'),
        err => socket.end(JSON.stringify({ ok: false, code: 'internal', message: (err as Error).message }) + '\n')
      );
    });
    socket.on('error', () => {});
  });

  // A socket file left by a holder that died: remove it if nothing answers there.
  if (process.platform !== 'win32' && fs.existsSync(socketPath)) {
    if (await holderIfRunning(target, { op: 'ping' }).catch(() => undefined)) {
      // Never started serving: no ticker, and the socket belongs to the other holder.
      phase = { kind: 'stopping' };
      await ct.close();
      log('another holder is already running');
      return;
    }
    fs.rmSync(socketPath, { force: true });
  }
  fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });
  ownsSocket = true;
  if (process.platform !== 'win32') fs.chmodSync(socketPath, 0o600);
  phase = { kind: 'serving' };
  ticker = setInterval(() => void tick().catch(err => log(`tick failed: ${(err as Error).message}`)), TICK_MS);
  log(`holding locks for ${target.name} (pid ${process.pid})`);

  process.once('SIGTERM', () => void stop('SIGTERM'));
  process.once('SIGINT', () => void stop('SIGINT'));
}

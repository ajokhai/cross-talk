import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { CrossTalk } from './sdk.js';
import type { ServerFrame, SlotHold } from '../protocol.js';

/**
 * `crosstalk run --slot <name> -- <command>`: run a heavy command (a build, a
 * full test suite, a test server) only while holding one of a channel's
 * counted slots, so at most `--max` of them run at once across every agent.
 * The slot belongs to this process's connection, so it frees however the
 * command ends, a crash included (after the hub's grace period if the whole
 * process is killed).
 */

/** Parses sizes such as 5G, 512M, 1.5T or a plain number of bytes. */
export function parseSize(text: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmgt]?)i?b?\s*$/i.exec(text);
  if (!m) throw new Error(`Not a size: "${text}" (try 5G or 512M)`);
  const power = { '': 0, k: 1, m: 2, g: 3, t: 4 }[m[2].toLowerCase() as '' | 'k' | 'm' | 'g' | 't'];
  return Math.round(Number(m[1]) * 1024 ** power);
}

export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Bytes free to this user on the filesystem holding `dir`. */
export function freeBytes(dir = process.cwd()): number {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}

/** Runs `command` with inherited stdio and resolves to its exit code (128 + signal number when killed). */
export function runCommand(command: string[]): { done: Promise<number>; kill: (signal: NodeJS.Signals) => void } {
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' });
  const done = new Promise<number>(resolve => {
    child.once('error', err => {
      console.error(`crosstalk run: could not start ${command[0]}: ${err.message}`);
      resolve(127);
    });
    child.once('exit', (code, signal) => {
      const signals: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };
      resolve(code ?? 128 + (signal ? signals[signal] ?? 1 : 1));
    });
  });
  return { done, kill: signal => child.kill(signal) };
}

export interface RunWithSlotOptions {
  url: string;
  channel: string;
  /** Agent name the slot is held under (shown to others). */
  name: string;
  slot: string;
  /** Places in the slot; the first holder fixes it for everyone. */
  max: number;
  /** Refuse to start (exit 1) when less than this many bytes are free in `cwd`. */
  minFreeBytes?: number;
  /** Lease per renewal, in seconds; renewed every third of it. Default 300. */
  ttlSeconds?: number;
  token?: string;
  command: string[];
  /** Where to check free disk space. Default: the current directory. */
  cwd?: string;
  /** Progress lines (queued, granted, released). Default: stderr. */
  log?: (line: string) => void;
}

/**
 * Holds one place in a channel's slot while `command` runs, and resolves to
 * the command's exit code. Exits 1 without running when the disk is below
 * the floor or the hub can't be reached; queues (and says so) when the slot
 * is full; renews the place while the command runs; releases however the
 * command ends, and forwards SIGINT/SIGTERM to it.
 */
export async function runWithSlot(o: RunWithSlotOptions): Promise<number> {
  const log = o.log ?? ((line: string) => process.stderr.write(line + '\n'));
  const ttl = Math.max(15, Math.min(o.ttlSeconds ?? 300, 1800));
  const lowDisk = () => {
    if (o.minFreeBytes === undefined) return false;
    const free = freeBytes(o.cwd);
    if (free >= o.minFreeBytes) return false;
    log(`crosstalk run: only ${formatSize(free)} free, below the ${formatSize(o.minFreeBytes)} floor; not starting ${o.command[0]}`);
    return true;
  };
  if (lowDisk()) return 1;

  let client: CrossTalk;
  try {
    client = await CrossTalk.connect({ name: o.name, role: 'runner', environment: 'terminal', url: o.url, token: o.token });
    await client.joinChannel(o.channel);
  } catch (err) {
    log(`crosstalk run: can't reach the hub or channel (${(err as Error).message}); not starting ${o.command[0]}`);
    return 1;
  }

  let stopped: NodeJS.Signals | undefined;
  let child: ReturnType<typeof runCommand> | undefined;
  let wake: (() => void) | undefined;
  const onSignal = (signal: NodeJS.Signals) => {
    stopped = signal;
    if (child) child.kill(signal);
    else wake?.();
  };
  const onInt = () => onSignal('SIGINT');
  const onTerm = () => onSignal('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  let renew: NodeJS.Timeout | undefined;
  const acquire = () => client.request('slot.acquire', { channel: o.channel, name: o.slot, capacity: o.max, ttlSeconds: ttl });

  try {
    const first = await acquire();
    if ('queued' in first) {
      const holders = first.slot.holders.map((h: SlotHold) => h.holder.name).join(', ');
      log(`crosstalk run: slot ${o.slot} is full (${first.slot.capacity} held by ${holders}); waiting, number ${first.position} in line`);
      await new Promise<void>(resolve => {
        wake = resolve;
        client.on('event', (f: ServerFrame) => {
          if (f.type === 'slot.granted' && f.slot.channel === o.channel && f.slot.name === o.slot) resolve();
        });
      });
      if (stopped) return 128 + (stopped === 'SIGINT' ? 2 : 15);
    }
    if (lowDisk()) return 1;
    log(`crosstalk run: holding slot ${o.slot} (1 of ${o.max}); running ${o.command.join(' ')}`);
    renew = setInterval(() => {
      acquire().then(
        r => {
          if ('queued' in r) log(`crosstalk run: lost the place in slot ${o.slot} (the hub dropped it); the command keeps running, queued again at ${r.position}`);
        },
        err => log(`crosstalk run: couldn't renew slot ${o.slot}: ${(err as Error).message}`)
      );
    }, (ttl * 1000) / 3);
    renew.unref();
    child = runCommand(o.command);
    return await child.done;
  } catch (err) {
    log(`crosstalk run: ${(err as Error).message}`);
    return 1;
  } finally {
    if (renew) clearInterval(renew);
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
    // Releasing also drops a queued place; closing alone would free it too, but say so first.
    await client.request('slot.release', { channel: o.channel, name: o.slot }).catch(() => {});
    await client.close().catch(() => {});
  }
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Owner keys for channels created on this machine, kept in
 * ~/.crosstalk/owner-keys.json (mode 0600). An owner key answers agents'
 * questions and switches them on or off, so it never goes through a channel:
 * the MCP server and CLI save it here, and `crosstalk inbox` reads it back.
 */

export interface OwnedChannel {
  address: string;
  name: string;
  /** Hub URL the channel lives on. */
  url: string;
  key: string;
  createdAt: number;
}

export function keyFile(): string {
  return process.env.CROSSTALK_KEYS_FILE || path.join(os.homedir(), '.crosstalk', 'owner-keys.json');
}

export function loadOwnedChannels(file = keyFile()): OwnedChannel[] {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data?.channels) ? data.channels.filter((c: any) => typeof c?.address === 'string' && typeof c?.key === 'string') : [];
  } catch {
    return [];
  }
}

function save(channels: OwnedChannel[], file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ channels }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function saveOwnedChannel(entry: Omit<OwnedChannel, 'createdAt'>, file = keyFile()): void {
  const rest = loadOwnedChannels(file).filter(c => c.address !== entry.address);
  // Keep the most recent 200; channels on a hub don't outlive it anyway.
  save([...rest, { ...entry, createdAt: Date.now() }].slice(-200), file);
}

export function forgetOwnedChannels(addresses: string[], file = keyFile()): void {
  if (!addresses.length) return;
  save(loadOwnedChannels(file).filter(c => !addresses.includes(c.address)), file);
}

/** Same hub? Compares scheme-insensitive host, port and path, so ws:// and http:// forms match. */
export function sameHub(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const url = new URL(u.replace(/^http/, 'ws'));
      const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
      const port = url.port || (url.protocol === 'wss:' ? '443' : '80');
      return `${host}:${port}${url.pathname.replace(/\/$/, '')}`;
    } catch {
      return u;
    }
  };
  return norm(a) === norm(b);
}

/**
 * Passes for channels that approve new members (2.20+): what lets an admitted
 * agent back in without knocking again. Kept in ~/.crosstalk/passes.json
 * (mode 0600), by hub and address. Like owner keys, never sent to a channel.
 */
export function passFile(): string {
  return process.env.CROSSTALK_PASSES_FILE || path.join(os.homedir(), '.crosstalk', 'passes.json');
}

interface SavedPass { address: string; url: string; pass: string; at: number }

function loadPasses(file: string): SavedPass[] {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data?.passes) ? data.passes.filter((p: any) => typeof p?.address === 'string' && typeof p?.pass === 'string') : [];
  } catch {
    return [];
  }
}

export function loadPass(address: string, url: string, file = passFile()): string | undefined {
  return loadPasses(file).find(p => p.address === address && sameHub(p.url, url))?.pass;
}

export function savePass(address: string, url: string, pass: string, file = passFile()): void {
  const rest = loadPasses(file).filter(p => !(p.address === address && sameHub(p.url, url)));
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ passes: [...rest, { address, url, pass, at: Date.now() }].slice(-500) }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

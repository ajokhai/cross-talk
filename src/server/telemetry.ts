import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VERSION } from '../version.js';

/**
 * Opt-in, anonymous usage check-in for `crosstalk serve`.
 *
 * Off unless the operator sets CROSSTALK_TELEMETRY=1 or passes --telemetry.
 * When on, the hub POSTs once at startup and then once a day:
 *
 *   {"id": "<random 32 hex, kept in ~/.crosstalk/telemetry-id>", "v": "<version>", "kind": "hub"}
 *
 * Nothing else is sent: no hostnames, paths, channel or agent names, and no
 * message content. The receiving endpoint derives a country from the request
 * and does not store IPs. Failures are silent and never affect the hub.
 */

/** Default endpoint (the project site); override with CROSSTALK_TELEMETRY_URL. */
export const TELEMETRY_URL = 'https://cross-talk-amber.vercel.app/api/ping';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TelemetryOptions {
  /** Explicit opt-in (e.g. the --telemetry flag). The env var also opts in. */
  enabled?: boolean;
  url?: string;
  /** Where the anonymous id is kept. */
  idFile?: string;
  intervalMs?: number;
  log?: (line: string) => void;
}

export function telemetryEnabled(flag?: boolean): boolean {
  const env = (process.env.CROSSTALK_TELEMETRY ?? '').trim().toLowerCase();
  if (env === '0' || env === 'false' || env === 'off') return false;
  return flag === true || env === '1' || env === 'true' || env === 'on';
}

/** Returns the stored anonymous id, creating it on first use. */
export function telemetryId(file = path.join(os.homedir(), '.crosstalk', 'telemetry-id')): string {
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{32}$/.test(existing)) return existing;
  } catch {
    // First run.
  }
  const id = crypto.randomBytes(16).toString('hex');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, id + '\n', { mode: 0o600 });
  } catch {
    // Unwritable home: use a per-process id rather than fail.
  }
  return id;
}

/** Sends one check-in. Resolves true on a 2xx, false on anything else; never throws. */
export async function checkIn(url: string, id: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': `crosstalk-hub/${VERSION}` },
      body: JSON.stringify({ id, v: VERSION, kind: 'hub' }),
      redirect: 'error',
      signal: AbortSignal.timeout(3000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Starts the daily check-in if the operator opted in. Returns a stop function
 * (a no-op when telemetry is off). Never blocks and never throws.
 */
export function startTelemetry(options: TelemetryOptions = {}): () => void {
  const log = options.log ?? (() => {});
  if (!telemetryEnabled(options.enabled)) return () => {};

  const url = (options.url ?? process.env.CROSSTALK_TELEMETRY_URL ?? TELEMETRY_URL).trim();
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    log('telemetry requested but no valid endpoint is configured (set CROSSTALK_TELEMETRY_URL); nothing will be sent');
    return () => {};
  }

  const id = telemetryId(options.idFile);
  log(`telemetry on: once a day sends {id: ${id.slice(0, 6)}… (random), version: ${VERSION}} to ${url}. Disable with CROSSTALK_TELEMETRY=0`);

  void checkIn(url, id);
  const timer = setInterval(() => void checkIn(url, id), options.intervalMs ?? DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VERSION } from '../version.js';

/**
 * Anonymous usage check-in for `crosstalk serve`, feeding the site's usage map.
 *
 * On by default. Off with --no-telemetry, CROSSTALK_TELEMETRY=0, DO_NOT_TRACK=1,
 * in Claude Code cloud containers,
 * or on a CI service (GitHub Actions, GitLab CI, ...). When on, the hub POSTs once at startup and then once a day:
 *
 *   {"id": "<random 32 hex, kept in ~/.crosstalk/telemetry-id>", "v": "<version>", "kind": "hub"}
 *
 * Nothing else is sent: no hostnames, paths, channel or agent names, and no
 * message content. The receiving endpoint derives a country from the request
 * and does not store IPs. Failures are silent and never affect the hub.
 */

/** Default endpoint (the project site); override with CROSSTALK_TELEMETRY_URL. */
export const TELEMETRY_URL = 'https://cross-talk-roan.vercel.app/api/ping';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TelemetryOptions {
  /** The --telemetry / --no-telemetry flag; undefined means the default (on). */
  enabled?: boolean;
  url?: string;
  /** Where the anonymous id is kept. */
  idFile?: string;
  intervalMs?: number;
  log?: (line: string) => void;
}

export function telemetryEnabled(flag?: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  const setting = (env.CROSSTALK_TELEMETRY ?? '').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(setting)) return false;
  if (flag === false) return false;
  if (flag === true || ['1', 'true', 'on', 'yes'].includes(setting)) return true;
  // General opt-outs: the DO_NOT_TRACK convention, and CI runs, which aren't real hubs.
  const dnt = (env.DO_NOT_TRACK ?? '').trim().toLowerCase();
  if (dnt && dnt !== '0' && dnt !== 'false') return false;
  if (onCiService(env)) return false;
  // Test runs (node --test sets this for every test process and what it starts) aren't real hubs or agents either.
  if (env.NODE_TEST_CONTEXT) return false;
  // Claude Code cloud containers: throwaway machines an agent works in, not real hubs.
  if (env.CCR_AGENT_PROXY_ENABLED) return false;
  return true;
}

/**
 * Variables set by CI services. A bare `CI` isn't enough: some app hosts set
 * it at runtime too, and hubs there are real.
 */
const CI_SERVICE_VARS = [
  'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'TRAVIS', 'BUILDKITE', 'JENKINS_URL', 'TF_BUILD',
  'BITBUCKET_BUILD_NUMBER', 'DRONE', 'APPVEYOR', 'TEAMCITY_VERSION', 'CODEBUILD_BUILD_ID', 'SEMAPHORE', 'WOODPECKER'
];

function onCiService(env: NodeJS.ProcessEnv): boolean {
  return CI_SERVICE_VARS.some(name => {
    const value = (env[name] ?? '').trim().toLowerCase();
    return value !== '' && value !== 'false' && value !== '0';
  });
}

/**
 * A stable id for hubs whose disk is replaced on every deploy, so a redeploy
 * isn't counted as a new hub: CROSSTALK_TELEMETRY_ID, or the platform's own
 * service id. Hashed, so the raw value is never sent.
 */
function platformId(env: NodeJS.ProcessEnv): string | undefined {
  const source =
    env.CROSSTALK_TELEMETRY_ID?.trim() ||
    (env.RAILWAY_SERVICE_ID && `railway:${env.RAILWAY_SERVICE_ID}:${env.RAILWAY_ENVIRONMENT_ID ?? ''}`) ||
    (env.RENDER_SERVICE_ID && `render:${env.RENDER_SERVICE_ID}`) ||
    (env.FLY_APP_NAME && `fly:${env.FLY_APP_NAME}`) ||
    (env.HEROKU_APP_ID && `heroku:${env.HEROKU_APP_ID}`);
  return source ? crypto.createHash('sha256').update(`crosstalk-telemetry:${source}`).digest('hex').slice(0, 32) : undefined;
}

/**
 * The anonymous id: a stable platform-derived one when available, otherwise a
 * random one stored in `file`, created on first use.
 */
export function telemetryId(file = path.join(os.homedir(), '.crosstalk', 'telemetry-id'), env: NodeJS.ProcessEnv = process.env): string {
  const fromPlatform = platformId(env);
  if (fromPlatform) return fromPlatform;
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
export async function checkIn(url: string, id: string, kind: 'hub' | 'agent' = 'hub'): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': `crosstalk-${kind}/${VERSION}` },
      body: JSON.stringify({ id, v: VERSION, kind }),
      redirect: 'error',
      signal: AbortSignal.timeout(3000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Starts the daily check-in unless the operator opted out. Returns a stop function
 * (a no-op when telemetry is off). Never blocks and never throws.
 */
export function startTelemetry(options: TelemetryOptions = {}): () => void {
  const log = options.log ?? (() => {});
  if (!telemetryEnabled(options.enabled)) return () => {};

  const url = (options.url ?? process.env.CROSSTALK_TELEMETRY_URL ?? TELEMETRY_URL).trim();
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    log('telemetry is on but no valid endpoint is configured (set CROSSTALK_TELEMETRY_URL); nothing will be sent');
    return () => {};
  }

  const id = telemetryId(options.idFile);
  log(`telemetry on: once a day sends {id: ${id.slice(0, 6)}… (anonymous), version: ${VERSION}} to ${url}. Turn off with --no-telemetry or CROSSTALK_TELEMETRY=0`);

  void checkIn(url, id);
  const timer = setInterval(() => void checkIn(url, id), options.intervalMs ?? DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * The agent side of the check-in: a CLI or MCP agent that connects to any hub
 * sends {id, v, kind: "agent"} from its own machine at most once a day, so the
 * usage map shows where agents run, not only where hubs run (a friend's agent
 * in another country joining your hub shows there). Same id file and the same
 * opt-outs as hubs (CROSSTALK_TELEMETRY=0, DO_NOT_TRACK=1, CI, cloud
 * containers). The last check-in day is kept in ~/.crosstalk/agent-checkin.
 * Never throws and never delays the caller.
 */
export function agentCheckIn(options: { home?: string; now?: number; env?: NodeJS.ProcessEnv; url?: string } = {}): Promise<boolean> {
  const env = options.env ?? process.env;
  if (!telemetryEnabled(undefined, env)) return Promise.resolve(false);
  const url = (options.url ?? env.CROSSTALK_TELEMETRY_URL ?? TELEMETRY_URL).trim();
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) return Promise.resolve(false);
  const dir = path.join(options.home ?? os.homedir(), '.crosstalk');
  const stamp = path.join(dir, 'agent-checkin');
  const today = new Date(options.now ?? Date.now()).toISOString().slice(0, 10);
  try {
    if (fs.readFileSync(stamp, 'utf8').trim() === today) return Promise.resolve(false);
  } catch {
    // Never checked in from this machine.
  }
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(stamp, today + '\n', { mode: 0o600 });
  } catch {
    // Unwritable home: still check in, it just may happen again today.
  }
  return checkIn(url, telemetryId(path.join(dir, 'telemetry-id'), env), 'agent');
}

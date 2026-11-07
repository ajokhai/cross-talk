import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Injected by scripts/bundle.mjs so the standalone bundle needs no package.json beside it. */
declare const __CROSSTALK_VERSION__: string | undefined;

/**
 * The package version. package.json is the single source of truth; bump it with
 * `npm version <major|minor|patch>` (see RELEASING.md).
 */
export const VERSION: string =
  typeof __CROSSTALK_VERSION__ === 'string'
    ? __CROSSTALK_VERSION__
    : createRequire(import.meta.url)('../package.json').version;

/** Where every release is installed from, and where its notes live. */
export const INSTALL_URL = 'https://github.com/ajokhai/cross-talk/releases/latest/download/cross-talk.tgz';
/**
 * The tarball for one version. Prefer this over INSTALL_URL when the version is
 * known: npm caches tarballs by URL, so the "latest" URL can quietly reinstall
 * the version you already have.
 */
export function installUrl(version?: string): string {
  return version && /^\d+\.\d+\.\d+$/.test(version) ? `https://github.com/ajokhai/cross-talk/releases/download/v${version}/cross-talk.tgz` : INSTALL_URL;
}
export const CHANGELOG_URL = 'https://github.com/ajokhai/cross-talk/blob/main/CHANGELOG.md';

/** -1, 0 or 1, comparing dotted numeric versions (anything after `-` is ignored). */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split('-')[0].split('.').map(n => Number.parseInt(n, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The note a client shows when the hub runs a newer CrossTalk than it does, or undefined when it is current. */
export function updateNotice(serverVersion: string | undefined, mine = VERSION): string | undefined {
  if (!serverVersion || compareVersions(serverVersion, mine) <= 0) return undefined;
  return `CrossTalk ${serverVersion} is available (you have ${mine}). Update with \`crosstalk update\` (or: npm install -g ${installUrl(serverVersion)}), then restart your listener and MCP server. What's new: ${CHANGELOG_URL}`;
}

// ---------------------------------------------------------------------------
// Checking GitHub (weekly) for a newer release, so agents hear about updates even on a
// hub that doesn't run the latest version (their own, a company's, a local one).

export const RELEASES_URL = 'https://github.com/ajokhai/cross-talk/releases/latest';
/**
 * How often to ask GitHub, at most: once a week. The check runs when CrossTalk
 * starts and the last one is older than this, so a machine that has been off
 * for a while checks as soon as it's back.
 */
export const UPDATE_CHECK_MS = 7 * 24 * 3600_000;

const CI_VARS = ['GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'TRAVIS', 'BUILDKITE', 'JENKINS_URL', 'TF_BUILD', 'BITBUCKET_BUILD_NUMBER', 'DRONE', 'APPVEYOR', 'TEAMCITY_VERSION', 'CODEBUILD_BUILD_ID', 'SEMAPHORE', 'WOODPECKER'];

/**
 * Off with CROSSTALK_UPDATE_CHECK=0, on CI, and inside a `node --test` run
 * (NODE_TEST_CONTEXT, which reaches the processes tests start): a release
 * coming out mid-run must not change what a test sees. CROSSTALK_UPDATE_CHECK=1
 * turns it back on there.
 */
export function updateCheckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const setting = (env.CROSSTALK_UPDATE_CHECK ?? '').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(setting)) return false;
  if (['1', 'true', 'on', 'yes'].includes(setting)) return true;
  if (env.NODE_TEST_CONTEXT) return false;
  return !CI_VARS.some(v => { const x = (env[v] ?? '').trim().toLowerCase(); return x !== '' && x !== '0' && x !== 'false'; });
}

const cacheFile = (home = os.homedir()) => path.join(home, '.crosstalk', 'update-check.json');

/** The latest release version last seen on GitHub (from the cache), or undefined. Never touches the network. */
export function cachedLatest(home?: string): string | undefined {
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile(home), 'utf8'));
    return typeof c.latest === 'string' ? c.latest : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Asks GitHub which release is latest, at most once a week (UPDATE_CHECK_MS) per
 * machine (cached in ~/.crosstalk/update-check.json), and returns it. Reads the
 * redirect of the public releases/latest page: no API token, nothing sent but
 * the request itself. Never throws; undefined when off, offline or unknown.
 */
export async function latestRelease(options: { home?: string; now?: number; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; force?: boolean } = {}): Promise<string | undefined> {
  const env = options.env ?? process.env;
  if (!updateCheckEnabled(env)) return undefined;
  const now = options.now ?? Date.now();
  const file = cacheFile(options.home);
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!options.force && typeof c.checkedAt === 'number' && now - c.checkedAt < UPDATE_CHECK_MS) return c.latest ?? undefined;
  } catch {
    // Never checked on this machine.
  }
  let latest: string | undefined;
  try {
    const res = await (options.fetchImpl ?? fetch)(RELEASES_URL, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': `crosstalk/${VERSION}` }, signal: AbortSignal.timeout(4000) });
    const where = res.headers.get('location') ?? '';
    latest = /\/tag\/v?(\d+\.\d+\.\d+[^/?#]*)/.exec(where)?.[1];
  } catch {
    latest = undefined;
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify({ checkedAt: now, latest: latest ?? cachedLatest(options.home) ?? null }) + '\n', { mode: 0o600 });
  } catch {
    // Unwritable home: we'll just ask again next time.
  }
  return latest ?? cachedLatest(options.home);
}

/** The newer of the hub's version and the latest release, for updateNotice(). */
export const newest = (...versions: (string | undefined)[]): string | undefined =>
  versions.filter((v): v is string => !!v).sort((a, b) => compareVersions(b, a))[0];

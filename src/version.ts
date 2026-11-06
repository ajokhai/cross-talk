import { createRequire } from 'node:module';

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
  return `CrossTalk ${serverVersion} is available (you have ${mine}). Update with \`crosstalk update\` (or: npm install -g ${INSTALL_URL}), then restart your listener and MCP server. What's new: ${CHANGELOG_URL}`;
}

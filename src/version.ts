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

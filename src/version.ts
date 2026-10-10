import { createRequire } from 'node:module';

/**
 * The package version, read from package.json so there is one source of truth.
 * Bump it with `npm version <major|minor|patch>`; see RELEASING.md.
 */
export const VERSION: string = createRequire(import.meta.url)('../package.json').version;

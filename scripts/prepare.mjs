// Builds dist/ when the package is installed from git. With
// `npm install -g github:ajokhai/cross-talk`, npm passes its --global setting
// to the install it runs in the clone, so the dev dependencies (typescript,
// @types/node) land in the global prefix instead of here and tsc fails.
// Install them locally first, with the global settings removed.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^npm_config_(global|location|prefix)$/i.test(key)) delete env[key];
}
if (!existsSync('node_modules/typescript') || !existsSync('node_modules/@types/node')) {
  execSync('npm install --no-save --no-audit --no-fund --include=dev --ignore-scripts', { stdio: 'inherit', env });
}
execSync('node node_modules/typescript/bin/tsc', { stdio: 'inherit', env });

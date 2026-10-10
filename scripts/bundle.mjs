// Builds dist/crosstalk.standalone.mjs: the whole CLI in one file, used by the
// air-gap installer. The version is baked in because the bundle is copied to
// places like /usr/local/bin where no package.json sits next to it.
import { build } from 'esbuild';
import { chmodSync, readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const outfile = 'dist/crosstalk.standalone.mjs';

await build({
  entryPoints: ['src/client/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile,
  define: { __CROSSTALK_VERSION__: JSON.stringify(version) },
  // Some dependencies call require(); give the ESM bundle one under a name that can't clash.
  banner: { js: 'import { createRequire as __crosstalkCreateRequire } from "node:module"; const require = __crosstalkCreateRequire(import.meta.url);' }
});
chmodSync(outfile, 0o755);
console.log(`bundled ${outfile} (v${version})`);

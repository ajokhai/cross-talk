// Shrinks dist/**/*.js in place after tsc: whitespace, comments and syntax,
// but not names, so stack traces still read. The .d.ts files keep their
// comments: they are the API docs editors show.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { transform } from 'esbuild';

const files = readdirSync('dist', { recursive: true }).map(String).filter(f => f.endsWith('.js'));
let before = 0;
let after = 0;
for (const file of files) {
  const full = path.join('dist', file);
  const source = readFileSync(full, 'utf8');
  const { code } = await transform(source, { format: 'esm', target: 'node18', minifyWhitespace: true, minifySyntax: true, legalComments: 'none' });
  writeFileSync(full, code);
  before += source.length;
  after += code.length;
}
console.log(`minified ${files.length} files: ${Math.round(before / 1024)} kB -> ${Math.round(after / 1024)} kB`);

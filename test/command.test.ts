import test from 'node:test';
import assert from 'node:assert/strict';
import { Command } from '../src/client/command.js';

/** Runs `argv` through a fresh program and returns what the action received. */
async function parse(build: (program: Command, seen: unknown[][]) => void, argv: string[]): Promise<unknown[]> {
  const seen: unknown[][] = [];
  const program = new Command().name('t');
  build(program, seen);
  await program.parseAsync(argv);
  return seen[0];
}

test('arguments: required, optional and variadic', async () => {
  const build = (p: Command, seen: unknown[][]) =>
    p.command('send <address> [label] [rest...]').action((...a) => void seen.push(a.slice(0, -2)));
  assert.deepEqual(await parse(build, ['send', 'xt_a']), ['xt_a', undefined, []]);
  assert.deepEqual(await parse(build, ['send', 'xt_a', 'l', 'x', 'y']), ['xt_a', 'l', ['x', 'y']]);
  assert.deepEqual(await parse(build, ['send', '--', '-dash']), ['-dash', undefined, []]);
});

test('options: values, defaults, camelCase keys, =, short flags and lists', async () => {
  const build = (p: Command, seen: unknown[][]) =>
    p.command('run')
      .option('-n, --name <name>', 'name', 'anon')
      .option('--max-tokens <n>', 'limit')
      .option('-s, --subnet <rules...>', 'rules')
      .option('--json', 'raw')
      .action(opts => void seen.push([opts]));
  assert.deepEqual(await parse(build, ['run']), [{ name: 'anon' }]);
  assert.deepEqual(await parse(build, ['run', '-n', 'bo', '--max-tokens=64', '--json']), [{ name: 'bo', maxTokens: '64', json: true }]);
  assert.deepEqual(await parse(build, ['run', '-s', 'lan', '10.0.0.0/8', '--json']), [{ name: 'anon', subnet: ['lan', '10.0.0.0/8'], json: true }]);
  assert.deepEqual(await parse(build, ['run', '-s', 'lan', '-s', 'local']), [{ name: 'anon', subnet: ['lan', 'local'] }]);
});

test('negatable flags: --no-x alone defaults x to true; paired with --x it stays unset', async () => {
  const build = (p: Command, seen: unknown[][]) =>
    p.command('serve')
      .option('--no-start', 'do not start')
      .option('--telemetry', 'on')
      .option('--no-telemetry', 'off')
      .action(opts => void seen.push([opts]));
  assert.deepEqual(await parse(build, ['serve']), [{ start: true }]);
  assert.deepEqual(await parse(build, ['serve', '--no-start', '--no-telemetry']), [{ start: false, telemetry: false }]);
  assert.deepEqual(await parse(build, ['serve', '--telemetry']), [{ start: true, telemetry: true }]);
});

test('nested commands route to the right action', async () => {
  const build = (p: Command, seen: unknown[][]) => {
    const channel = p.command('channel');
    channel.command('status <address>').option('--json', 'raw').action((address, opts) => void seen.push(['status', address, opts]));
    p.command('status').action(() => void seen.push(['top']));
  };
  assert.deepEqual(await parse(build, ['channel', 'status', 'xt_a', '--json']), ['status', 'xt_a', { json: true }]);
  assert.deepEqual(await parse(build, ['status']), ['top']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';
import { addSecret } from '../src/client/secrets.js';

const cli = path.resolve('src/client/cli.ts');
const tsx = import.meta.resolve('tsx');

/** Runs the CLI to completion; resolves with its exit code and everything it printed. */
function crosstalk(args: string[], env: Record<string, string>): Promise<{ code: number; out: string }> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-clirun-'));
  const child = spawn(process.execPath, ['--import', tsx, cli, ...args], { env: { ...process.env, NO_COLOR: '1', HOME: home, ...env } });
  let out = '';
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));
  return new Promise(resolve => child.on('exit', code => resolve({ code: code ?? -1, out })));
}

const SECRET = 'sk-test-0123456789abcdef';
const printEnv = [process.execPath, '-e', "console.log('token=' + process.env.DEMO_TOKEN); process.exit(7)"];

test('crosstalk run reaches both jobs: --slot, --secret, and both together', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const owner = await CrossTalk.connect({ name: 'owner', url: server.url, reconnect: false });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-secrets-'));
  addSecret('DEMO_TOKEN', SECRET, { dir });
  const env = { CROSSTALK_SECRETS_DIR: dir };
  try {
    const ch = await owner.createChannel('builds');
    const slotArgs = ['--slot', 'heavy', '--max', '1', '-c', ch.address, '-u', server.url];

    // Slot only: the command runs and its exit code comes back (this path was unreachable when two `run` commands existed).
    const slot = await crosstalk(['run', ...slotArgs, '-n', 'builder', '--', process.execPath, '-e', 'process.exit(3)'], env);
    assert.equal(slot.code, 3, slot.out);

    // Secret only: the value is in the environment and blanked out of the output.
    const secret = await crosstalk(['run', '--secret', 'DEMO_TOKEN', '-n', 'builder', '--', ...printEnv], env);
    assert.equal(secret.code, 7, secret.out);
    assert.match(secret.out, /token=\[secret DEMO_TOKEN\]/);
    assert.doesNotMatch(secret.out, new RegExp(SECRET));

    // Both: the keyed command runs inside the slot, still redacted, with its own exit code.
    const both = await crosstalk(['run', '--secret', 'DEMO_TOKEN', ...slotArgs, '-n', 'builder', '--', ...printEnv], env);
    assert.equal(both.code, 7, both.out);
    assert.match(both.out, /token=\[secret DEMO_TOKEN\]/);
    assert.doesNotMatch(both.out, new RegExp(SECRET));

    // Neither: a clear error.
    const neither = await crosstalk(['run', '--', process.execPath, '-e', '0'], env);
    assert.notEqual(neither.code, 0);
    assert.match(neither.out, /--secret NAME .*--slot NAME/);
  } finally {
    await owner.close();
    await server.close();
  }
});

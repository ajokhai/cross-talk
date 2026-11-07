import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CrossTalk, formatAddress, startServer } from 'cross-talk';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'bridge-cli.ts');
const tsx = import.meta.resolve('tsx');
const envWithoutHub = () => {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.CROSSTALK_URL;
  return env;
};

test('crosstalk-bridge goes to the hub a one-line address names, with no --url', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const watcher = await CrossTalk.connect({ name: 'watcher', url: server.url, reconnect: false });
  const ch = await watcher.createChannel('bridge-address');
  const address = formatAddress(ch.address, server.url); // xt_…@127.0.0.1:<port>
  assert.match(address, /^xt_[A-Za-z0-9_-]{22}@127\.0\.0\.1:\d+$/);
  const child = spawn(process.execPath, ['--import', tsx, cli, '--channel', address, '--stdio', '--name', 'sensor-1'], { env: envWithoutHub(), stdio: ['pipe', 'pipe', 'pipe'] });
  let log = '';
  child.stderr.on('data', d => (log += d));
  try {
    const deadline = Date.now() + 20_000;
    for (;;) {
      await ch.refresh();
      if ([...ch.members.values()].some(m => m.name === 'sensor-1')) break;
      if (Date.now() > deadline) assert.fail(`the bridge never joined; its log:\n${log}`);
      await new Promise(r => setTimeout(r, 200));
    }
  } finally {
    child.kill();
    await watcher.close();
    await server.close();
  }
});

test('crosstalk-bridge refuses something that is not an address', async () => {
  const result = await new Promise<{ code: number | null; err: string }>(resolve =>
    execFile(process.execPath, ['--import', tsx, cli, '--channel', 'not-an-address', '--stdio'], { env: envWithoutHub() }, (error, _out, err) =>
      resolve({ code: error ? (error as any).code ?? 1 : 0, err })));
  assert.equal(result.code, 2);
  assert.match(result.err, /is not a channel address/);
});

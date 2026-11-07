import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { startServer } from '../src/server/index.js';
import { parseTunnelUrl } from '../src/server/tunnel.js';

const cli = path.resolve('src/client/cli.ts');
const tsx = import.meta.resolve('tsx');
const keys = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xt-keys-')), 'owner-keys.json');

function run(args: string[], env: Record<string, string>): Promise<{ code: number; out: string; err: string }> {
  return new Promise(resolve => {
    execFile(process.execPath, ['--import', tsx, cli, ...args], { env: { ...process.env, NO_COLOR: '1', CROSSTALK_KEYS_FILE: keys, ...env } },
      (error, out, err) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out, err }));
  });
}

test('crosstalk invite --remote / list / revoke', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false, public: { tunnel: false, url: 'https://door.example.test' } });
  const env = { CROSSTALK_URL: server.url, CROSSTALK_AGENT_NAME: 'owner' };
  try {
    const made = await run(['new', 'remote-cli', '--no-listen'], env);
    assert.equal(made.code, 0, made.err);
    const address = /xt_[A-Za-z0-9_-]{22}/.exec(made.out)![0];

    const inv = await run(['invite', address, '--remote', '--label', 'vps', '--expires', '2h', '--max-agents', '2'], env);
    assert.equal(inv.code, 0, inv.err);
    assert.match(inv.out, /Join my CrossTalk channel xt_[A-Za-z0-9_-]{22}@door\.example\.test with invite key xi_/);
    const key = /xi_[A-Za-z0-9_-]+/.exec(inv.out)![0];

    const door = `http://127.0.0.1:${server.publicDoor!.port}`;
    const join = await fetch(`${door}/v1/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CrossTalk-Invite': key }, body: '{"agent":{"name":"vps-agent"}}' });
    assert.equal(join.status, 201);

    const list = await run(['invite', 'list', address], env);
    assert.match(list.out, /vps .* active .*1 admitted/);

    const revoke = await run(['invite', 'revoke', address, 'vps'], env);
    assert.equal(revoke.code, 0, revoke.err);
    assert.match(revoke.out, /revoked vps/);
    const again = await fetch(`${door}/v1/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CrossTalk-Invite': key }, body: '{"agent":{"name":"x"}}' });
    assert.equal(again.status, 401);

    // Without the owner key, no invites.
    const stranger = await run(['invite', address, '--remote'], { ...env, CROSSTALK_KEYS_FILE: keys + '.none' });
    assert.equal(stranger.code, 1);
    assert.match(stranger.err, /No owner key/);
  } finally {
    await server.close();
  }
});

test('the quick-tunnel URL is read from cloudflared output', () => {
  assert.equal(parseTunnelUrl('INF |  https://quiet-lake-1234.trycloudflare.com  |'), 'https://quiet-lake-1234.trycloudflare.com');
  assert.equal(parseTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...'), undefined);
});

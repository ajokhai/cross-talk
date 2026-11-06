import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../src/server/index.js';

const cli = path.resolve('src/client/cli.ts');
const tsx = import.meta.resolve('tsx');
const exec = promisify(execFile);

/** Runs the CLI once in a fresh home (no saved sessions, no welcome marker) and returns what it printed. */
async function run(args: string[], env: Record<string, string> = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-history-'));
  const base = { ...process.env, NO_COLOR: '1', HOME: home, CROSSTALK_HOME: home, CROSSTALK_NO_REVIEW_PROMPT: '1' };
  delete base.CROSSTALK_AGENT_NAME;
  try {
    const { stdout, stderr } = await exec(process.execPath, ['--import', tsx, cli, ...args], { env: { ...base, ...env }, maxBuffer: 1 << 24 });
    return { code: 0, stdout, stderr };
  } catch (err: any) {
    return { code: err.code ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
}

/** A hub with one channel that allows long messages, posted to over HTTP. */
async function rig() {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const http = server.url.replace('ws://', 'http://');
  const post = async (route: string, body: unknown, session?: string) =>
    (await fetch(http + route, { method: 'POST', headers: { 'content-type': 'application/json', ...(session ? { 'x-crosstalk-session': session } : {}) }, body: JSON.stringify(body) })).json() as Promise<any>;
  const session = (await post('/v1/sessions', { name: 'poster' })).session;
  const channel = (await post('/v1/rpc', { type: 'channel.create', name: 'x', limits: { maxMessageChars: 16000 } }, session)).data.channel.id as string;
  const say = async (content: string) => (await post('/v1/rpc', { type: 'message.send', channel, content }, session)).data as { id: string };
  return { server, channel, say };
}

test('history stubs a long message: first line, size and hash; --full, --id and --json print it whole', async () => {
  const { server, channel, say } = await rig();
  try {
    const patch = 'patch for src/a.ts follows\n' + 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=\n'.repeat(120);
    assert.ok(patch.length > 2000);
    const sha = crypto.createHash('sha256').update(patch).digest('hex').slice(0, 12);
    const big = await say(patch);
    await say('short reply');
    const common = [channel, '-u', server.url, '--name', 'reader'];

    const stubbed = await run(['history', ...common]);
    assert.equal(stubbed.code, 0, stubbed.stderr);
    assert.match(stubbed.stdout, /poster: patch for src\/a\.ts follows… \[/);
    assert.ok(stubbed.stdout.includes(`[${patch.length} chars, sha256 ${sha}; crosstalk history ${channel} --full --id ${big.id} to print it]`), stubbed.stdout);
    assert.ok(!stubbed.stdout.includes('QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=\nQUJD'), 'the body was not printed');
    assert.match(stubbed.stdout, /poster: short reply\n/);

    const full = await run(['history', ...common, '--full']);
    assert.ok(full.stdout.includes(patch), 'with --full the whole message is printed');

    const one = await run(['history', ...common, '--id', big.id]);
    assert.ok(one.stdout.includes(patch), 'with --id the message is printed whole');
    assert.ok(!one.stdout.includes('short reply'), 'and only that message');

    const json = await run(['history', ...common, '--json']);
    const rows = json.stdout.trim().split('\n').map(l => JSON.parse(l));
    assert.equal(rows.find(r => r.id === big.id)?.content, patch, '--json is always complete');

    const missing = await run(['history', ...common, '--id', 'msg_nope']);
    assert.notEqual(missing.code, 0);
    assert.match(missing.stderr, /No message msg_nope/);
  } finally {
    await server.close();
  }
});

test('join and new warn when the agent name is the machine-wide default; --name or CROSSTALK_AGENT_NAME silences it', async () => {
  const { server, channel } = await rig();
  try {
    const warning = 'the default for every agent on this machine';
    const unnamed = await run(['join', channel, '--no-listen', '-u', server.url]);
    assert.equal(unnamed.code, 0, unnamed.stderr);
    assert.ok(unnamed.stderr.includes(warning), unnamed.stderr);
    assert.ok(unnamed.stderr.includes('--name <agent>'), 'says what to do');

    const named = await run(['join', channel, '--no-listen', '-u', server.url, '--name', 'claude-code']);
    assert.ok(!named.stderr.includes(warning), named.stderr);

    const viaEnv = await run(['join', channel, '--no-listen', '-u', server.url], { CROSSTALK_AGENT_NAME: 'gemini' });
    assert.ok(!viaEnv.stderr.includes(warning), viaEnv.stderr);

    const created = await run(['new', 'y', '--no-listen', '-u', server.url]);
    assert.equal(created.code, 0, created.stderr);
    assert.ok(created.stderr.includes(warning), created.stderr);
  } finally {
    await server.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';

const cli = path.resolve('src/client/cli.ts');
// Absolute, so the CLI also runs from a scratch repo outside this checkout.
const tsx = import.meta.resolve('tsx');
const holders = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-holders-'));

function run(args: string[], env: Record<string, string>, cwd = process.cwd()): Promise<{ code: number; out: string; err: string }> {
  return new Promise(resolve => {
    execFile(process.execPath, ['--import', tsx, cli, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: '1', CROSSTALK_HOLDERS_DIR: holders, CROSSTALK_HOLDER_TICK_MS: '300', CROSSTALK_HOLDER_IDLE_MS: '1500', CROSSTALK_HOLDER_GONE_MS: '1000', ...env }
    }, (error, out, err) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out, err }));
  });
}

const until = async (check: () => boolean, ms = 25_000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 100));
  }
};

test('crosstalk lock / unlock / locks / check hold locks across CLI calls', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const watcher = await CrossTalk.connect({ name: 'watcher', url: server.url, reconnect: false });
  try {
    const ch = await watcher.createChannel('cli-locks');
    const env = { CROSSTALK_URL: server.url, CROSSTALK_CHANNEL: ch.address };
    const alice = { ...env, CROSSTALK_AGENT_NAME: 'alice' };
    const bob = { ...env, CROSSTALK_AGENT_NAME: 'bob' };

    const locked = await run(['lock', 'app/[handle]/route.ts', 'src/a.ts', '-r', 'routing', '-m', '90'], alice);
    assert.equal(locked.code, 0, locked.err);
    // The CLI exited, but the lock outlives it: the holder keeps it.
    await new Promise(r => setTimeout(r, 400));
    await ch.refresh();
    assert.equal(ch.locks.get('app/[handle]/route.ts')?.holder.name, 'alice');
    assert.equal(ch.locks.get('src/a.ts')?.reason, 'routing');

    // A lock set is all or nothing.
    const clash = await run(['lock', 'src/b.ts', 'src/a.ts'], bob);
    assert.equal(clash.code, 1);
    assert.match(clash.err, /HELD src\/a\.ts by alice/);
    await ch.refresh();
    assert.equal(ch.locks.has('src/b.ts'), false, 'the free file was given back');

    assert.equal((await run(['check', 'app/[handle]/route.ts'], bob)).code, 1);
    assert.equal((await run(['check', 'app/[handle]/route.ts'], alice)).code, 0);
    assert.equal((await run(['check', 'src/free.ts'], bob)).code, 0);

    const listed = await run(['locks'], alice);
    assert.match(listed.out, /src\/a\.ts — alice \(you\)/);

    // Releasing what you don't hold fails loudly.
    const wrong = await run(['unlock', 'src/a.ts'], bob);
    assert.equal(wrong.code, 3);
    assert.match(wrong.err, /NOT RELEASED src\/a\.ts/);
    const partly = await run(['unlock', 'src/a.ts', 'src/never.ts'], alice);
    assert.equal(partly.code, 3);
    assert.match(partly.out, /released src\/a\.ts/);
    assert.match(partly.err, /NOT RELEASED src\/never\.ts/);

    assert.equal((await run(['unlock', '--all'], alice)).code, 0);
    await ch.refresh();
    assert.equal(ch.locks.size, 0);
    // With nothing left to hold, the holder exits and its socket goes away.
    await until(() => fs.readdirSync(holders).every(f => !f.endsWith('.sock')));
  } finally {
    await watcher.close();
    await server.close();
  }
});

test('crosstalk lock --until-commit lets go once the file is committed', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-repo-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(repo, 'a.ts'), 'one\n');
  git('add', '.');
  git('commit', '-qm', 'init');

  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const watcher = await CrossTalk.connect({ name: 'watcher', url: server.url, reconnect: false });
  try {
    const ch = await watcher.createChannel('until-commit');
    const env = { CROSSTALK_URL: server.url, CROSSTALK_CHANNEL: ch.address, CROSSTALK_AGENT_NAME: 'alice' };
    assert.equal((await run(['lock', 'a.ts', '--until-commit'], env, repo)).code, 0);
    fs.writeFileSync(path.join(repo, 'a.ts'), 'two\n');
    await new Promise(r => setTimeout(r, 800));
    await ch.refresh();
    assert.ok(ch.locks.has('a.ts'), 'held while the edit is uncommitted');
    git('commit', '-qam', 'edit');
    // The holder notices on its next tick (300 ms here); give a loaded machine room.
    await until(() => !ch.locks.has('a.ts'));
  } finally {
    await watcher.close();
    await server.close();
  }
});

test('crosstalk lock --until-commit lets go even when the edit and its commit land between two ticks', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-repo-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(repo, 'b.ts'), 'one\n');
  git('add', '.');
  git('commit', '-qm', 'init');

  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const watcher = await CrossTalk.connect({ name: 'watcher', url: server.url, reconnect: false });
  try {
    const ch = await watcher.createChannel('until-commit-fast');
    // Ticks 2 s apart: the holder never sees the file dirty, only the new commit.
    const env = { CROSSTALK_URL: server.url, CROSSTALK_CHANNEL: ch.address, CROSSTALK_AGENT_NAME: 'bob', CROSSTALK_HOLDER_TICK_MS: '2000' };
    assert.equal((await run(['lock', 'b.ts', '--until-commit'], env, repo)).code, 0);
    await ch.refresh();
    assert.ok(ch.locks.has('b.ts'), 'locked');
    fs.writeFileSync(path.join(repo, 'b.ts'), 'two\n');
    git('commit', '-qam', 'edit');
    await until(() => !ch.locks.has('b.ts'));
  } finally {
    await watcher.close();
    await server.close();
  }
});

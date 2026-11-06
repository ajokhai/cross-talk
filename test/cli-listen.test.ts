import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';

const cli = path.resolve('src/client/cli.ts');
const tsx = import.meta.resolve('tsx');

/** Starts the CLI and collects its output; `done` resolves with the exit code. */
function start(args: string[], env: Record<string, string>) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-listen-'));
  const child = spawn(process.execPath, ['--import', tsx, cli, ...args], { env: { ...process.env, NO_COLOR: '1', HOME: home, ...env } });
  let out = '';
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));
  const done = new Promise<number>(resolve => child.on('exit', code => resolve(code ?? -1)));
  return { child, done, out: () => out };
}

const until = async (check: () => boolean, ms = 25_000) => {
  const t = Date.now();
  while (!check()) {
    if (Date.now() - t > ms) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 100));
  }
};

test('crosstalk new starts the channel and its listener; it exits when the creator is @mentioned', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const other = await CrossTalk.connect({ name: 'other', url: server.url, reconnect: false });
  const run = start(['new', 'listen-test', '--name', 'creator', '--url', server.url], {});
  try {
    await until(() => /Listening as creator/.test(run.out()));
    const address = run.out().match(/xt_[A-Za-z0-9_-]{22}/)![0];
    const ch = await other.joinChannel(address);
    await ch.send('chatter that should not wake anyone');
    await new Promise(r => setTimeout(r, 300));
    assert.equal(run.child.exitCode, null, 'still listening through chatter');
    await ch.send('@creator over to you');
    assert.equal(await run.done, 0);
    assert.match(run.out(), /over to you/);
    assert.doesNotMatch(run.out().split('Listening as creator')[1], /chatter that should not/);
  } finally {
    run.child.kill();
    await other.close();
    await server.close();
  }
});

test('crosstalk join starts the listener and exits on a DM; --no-listen just joins', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const owner = await CrossTalk.connect({ name: 'owner', url: server.url, reconnect: false });
  try {
    const ch = await owner.createChannel('join-test');
    const quick = start(['join', ch.address, '--no-listen', '--name', 'quick', '--url', server.url], {});
    assert.equal(await quick.done, 0);
    assert.match(quick.out(), /quick joined #join-test/);
    assert.doesNotMatch(quick.out(), /Listening/);

    const run = start(['join', ch.address, '--name', 'joiner', '--url', server.url], {});
    await until(() => /Listening as joiner/.test(run.out()));
    await owner.dm('joiner', 'private ping');
    assert.equal(await run.done, 0);
    assert.match(run.out(), /private ping/);
  } finally {
    await owner.close();
    await server.close();
  }
});

test('crosstalk new fails (non-zero) when it cannot start the listener', async () => {
  const run = start(['new', 'nohub', '--name', 'x', '--url', 'ws://127.0.0.1:9'], {});
  const code = await run.done;
  assert.notEqual(code, 0);
  assert.doesNotMatch(run.out(), /Listening as/);
});

test('the listener survives its session ending: it re-registers, rejoins, and still wakes on @mention', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const owner = await CrossTalk.connect({ name: 'owner', url: server.url, reconnect: false });
  try {
    const ch = await owner.createChannel('survive');
    const run = start(['join', ch.address, '--name', 'phoenix', '--url', server.url], {});
    await until(() => /Listening as phoenix/.test(run.out()));
    const hub: any = server.hub;
    const first = [...hub.agents.values()].find((c: any) => c.agent?.name === 'phoenix');
    const firstId = first.agent.id;
    hub.endRemote(first, 'test: session ended'); // like an expiry: the next poll gets 401
    await until(() => [...hub.agents.values()].some((c: any) => c.agent?.name === 'phoenix' && c.agent.id !== firstId && c.channels.has(ch.address)), 30_000);
    await ch.send('@phoenix still there?');
    assert.equal(await run.done, 0);
    assert.match(run.out(), /still there\?/);
  } finally {
    await owner.close();
    await server.close();
  }
});

test('a listener whose agent is kicked stops with exit code 3', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const owner = await CrossTalk.connect({ name: 'owner', url: server.url, reconnect: false });
  try {
    const ch = await owner.createChannel('kickme');
    const run = start(['join', ch.address, '--name', 'unwanted', '--url', server.url], {});
    await until(() => /Listening as unwanted/.test(run.out()));
    await ch.kick('unwanted', { reason: 'off topic' });
    assert.equal(await run.done, 3);
    assert.match(run.out(), /owner removed you from this channel: off topic/);
  } finally {
    await owner.close();
    await server.close();
  }
});

test('a listener alone in its channel turns itself off after --listen-timeout and says so (exit 4)', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  try {
    const run = start(['new', 'lonely', '--name', 'solo', '--url', server.url, '--listen-timeout', '3s'], {});
    assert.equal(await run.done, 4);
    assert.match(run.out(), /Nobody else joined this channel within 3 seconds, so your listener is now OFF\. Tell your user/);
    assert.match(run.out(), /crosstalk join xt_\S+ --name solo --url ws:/);
  } finally {
    await server.close();
  }
});

test('with company, or --listen-timeout 0, the listener keeps going past the timeout', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const owner = await CrossTalk.connect({ name: 'owner', url: server.url, reconnect: false });
  try {
    const ch = await owner.createChannel('busy');
    const run = start(['join', ch.address, '--name', 'stays', '--url', server.url, '--listen-timeout', '0.05'], {});
    await until(() => /Listening as stays/.test(run.out()));
    await new Promise(r => setTimeout(r, 4500));
    assert.equal(run.child.exitCode, null, 'the owner is here, so no timeout');
    await ch.send('@stays ping');
    assert.equal(await run.done, 0);
  } finally {
    await owner.close();
    await server.close();
  }
});

test('a listener stopped by hand tells the agent it is no longer listening (exit 5)', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  try {
    const run = start(['new', 'stopme', '--name', 'oops', '--url', server.url], {});
    await until(() => /Listening as oops/.test(run.out()));
    run.child.kill('SIGTERM');
    assert.equal(await run.done, 5);
    assert.match(run.out(), /listener was stopped \(SIGTERM\)\. You are no longer listening.*tell your user/);
  } finally {
    await server.close();
  }
});

test('--listen-timeout rejects what it cannot read, before creating anything', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  try {
    const run = start(['new', 'typo', '--name', 'solo', '--url', server.url, '--listen-timeout', 'soon'], {});
    assert.equal(await run.done, 1);
    assert.match(run.out(), /--listen-timeout must be minutes \(like 5\), or a number with s, m or h/);
    assert.doesNotMatch(run.out(), /Started #typo/);
  } finally {
    await server.close();
  }
});

test('crosstalk wait is not woken by your own message', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const other = await CrossTalk.connect({ name: 'other', url: server.url, reconnect: false });
  try {
    const ch = await other.createChannel('self-wake');
    const join = start(['join', ch.address, '--no-listen', '--name', 'me', '--url', server.url], {});
    assert.equal(await join.done, 0);
    const send = start(['send', ch.address, 'my own note', '--name', 'me', '--url', server.url], {});
    assert.equal(await send.done, 0);
    const wait = start(['wait', ch.address, '--name', 'me', '--url', server.url, '--timeout', '30'], {});
    await new Promise(r => setTimeout(r, 1500));
    assert.equal(wait.child.exitCode, null, 'still waiting after its own message');
    await ch.send('a reply from someone else');
    assert.equal(await wait.done, 0);
    assert.match(wait.out(), /a reply from someone else/);
    assert.doesNotMatch(wait.out(), /my own note/);
  } finally {
    await other.close();
    await server.close();
  }
});

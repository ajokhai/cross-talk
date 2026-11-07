import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from '../src/server/index.js';
import { HubFailure } from '../src/server/hub.js';
import { CrossTalk } from '../src/client/sdk.js';
import { Bridge } from '../src/mcp/server.js';
import type { ChannelSnapshot } from '../src/protocol.js';

const cli = path.resolve('src/client/cli.ts');
const tsx = import.meta.resolve('tsx');

/** Starts `crosstalk <args>`; resolves with its exit code and output once it exits. */
function crosstalk(args: string[], env: Record<string, string>) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-attach-home-'));
  const child = spawn(process.execPath, ['--import', tsx, cli, ...args], { env: { ...process.env, NO_COLOR: '1', HOME: home, ...env } });
  let out = '';
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));
  const done = new Promise<{ code: number; out: string }>(resolve => child.on('exit', code => resolve({ code: code ?? -1, out })));
  return { child, done };
}

const until = async (check: () => Promise<boolean>, what: string, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
};

test("an MCP agent's crosstalk wait attaches to it: one member, shown listening, woken by a mention", async () => {
  // A short grace, so 'no longer listening' shows within the test (normally a restarted listener bridges it).
  const server = await startServer({ port: 0, quiet: true, stateFile: false, hub: { listenerGraceMs: 300 } });
  const listenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-listen-'));
  const previous = process.env.CROSSTALK_LISTEN_DIR;
  process.env.CROSSTALK_LISTEN_DIR = listenDir;
  const josh = await CrossTalk.connect({ name: 'josh', url: server.url, reconnect: false });
  const bridge = new Bridge({ name: 'gemini', url: server.url });
  try {
    const ch = await josh.createChannel('team');
    const client = await bridge.get();
    await client.joinChannel(ch.address);

    const state = async () => (await josh.request('channel.state', { channel: ch.address })) as ChannelSnapshot;
    const listener = crosstalk(['wait', ch.address, '--mentions', '--timeout', '30', '--name', 'gemini', '--url', server.url], { CROSSTALK_LISTEN_DIR: listenDir });

    // The hub sees gemini listening, through its MCP connection.
    await until(async () => !!(await state()).attention.find(a => a.agent.name === 'gemini')?.listening, 'gemini to show as listening');
    const members = (await state()).members.filter(m => m.name === 'gemini');
    assert.equal(members.length, 1, 'one gemini, not an MCP member plus a listener member');
    assert.equal(members[0].id, client.agent.id);

    await ch.send('nothing for gemini here');
    await ch.send('@gemini can you take the docs?');
    const { code, out } = await listener.done;
    assert.equal(code, 0, out);
    assert.match(out, /can you take the docs\?/);
    assert.doesNotMatch(out, /nothing for gemini here/, 'a --mentions listener ignores other chatter');

    // The listener left: no longer counted as listening.
    await until(async () => (await state()).attention.find(a => a.agent.name === 'gemini')?.listening !== true, 'listening to end');
    assert.equal((await state()).members.filter(m => m.name === 'gemini').length, 1);
  } finally {
    await bridge.close();
    await josh.close();
    await server.close();
    if (previous === undefined) delete process.env.CROSSTALK_LISTEN_DIR;
    else process.env.CROSSTALK_LISTEN_DIR = previous;
  }
});

test('with no MCP server for that name, crosstalk wait joins on its own as before', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const listenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-listen-'));
  const josh = await CrossTalk.connect({ name: 'josh', url: server.url, reconnect: false });
  try {
    const ch = await josh.createChannel('team');
    const listener = crosstalk(['wait', ch.address, '--mentions', '--timeout', '30', '--name', 'solo', '--url', server.url], { CROSSTALK_LISTEN_DIR: listenDir });
    await until(async () => ((await josh.request('channel.state', { channel: ch.address })) as ChannelSnapshot).members.some(m => m.name === 'solo'), 'solo to join');
    await ch.send('@solo ping');
    const { code, out } = await listener.done;
    assert.equal(code, 0, out);
    assert.match(out, /ping/);
  } finally {
    await josh.close();
    await server.close();
  }
});

test("on a hub that doesn't know listener.report, the MCP server doesn't offer attaching", async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  // Behave like a 2.20 hub: listener.report is an unknown request.
  const hub = server.hub as unknown as { dispatch(conn: unknown, frame: { type: string }): Promise<unknown> };
  const dispatch = hub.dispatch.bind(hub);
  hub.dispatch = async (conn, frame) => {
    if (frame.type === 'listener.report') throw new HubFailure('bad_request', 'Unknown request type "listener.report"');
    return dispatch(conn, frame);
  };
  const listenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-listen-'));
  const previous = process.env.CROSSTALK_LISTEN_DIR;
  process.env.CROSSTALK_LISTEN_DIR = listenDir;
  const bridge = new Bridge({ name: 'gemini', url: server.url });
  try {
    await bridge.get();
    assert.deepEqual(fs.readdirSync(listenDir), [], 'no endpoint recorded, so crosstalk wait joins on its own');
  } finally {
    await bridge.close();
    await server.close();
    if (previous === undefined) delete process.env.CROSSTALK_LISTEN_DIR;
    else process.env.CROSSTALK_LISTEN_DIR = previous;
  }
});

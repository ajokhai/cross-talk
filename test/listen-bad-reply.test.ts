import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';
import { HttpAgent } from '../src/client/http.js';
import { CrossTalkError } from '../src/client/sdk.js';

const cli = path.resolve('src/client/cli.ts');
const tsx = import.meta.resolve('tsx');

/**
 * A proxy in front of a hub that, while `broken` is true, answers
 * GET /v1/events with a 200 HTML page, like an edge proxy does while the
 * hub behind it is redeploying.
 */
async function flakyProxy(hubHttp: string) {
  const state = { broken: false, badReplies: 0 };
  const server = http.createServer(async (req, res) => {
    if (state.broken && req.method === 'GET' && req.url?.startsWith('/v1/events')) {
      state.badReplies++;
      await new Promise(r => setTimeout(r, 50));
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>Application is starting</body></html>');
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && k !== 'host' && k !== 'content-length') headers[k] = v;
    const upstream = await fetch(hubHttp + req.url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, state, close: () => new Promise<void>(r => server.close(() => r())) };
}

test('HttpAgent.events turns a non-JSON 200 into a CrossTalkError (retryable), not a TypeError', async () => {
  const hub = await startServer({ port: 0, quiet: true, stateFile: false });
  const proxy = await flakyProxy(hub.url.replace('ws://', 'http://'));
  try {
    const agent = new HttpAgent({ name: 'probe', url: proxy.url, sessionFile: false });
    await agent.open();
    proxy.state.broken = true;
    await assert.rejects(agent.events(0), (err: unknown) => err instanceof CrossTalkError);
  } finally {
    await proxy.close();
    await hub.close();
  }
});

test('crosstalk wait survives bad /v1/events replies from a restarting hub and still wakes on an @mention', async () => {
  const hub = await startServer({ port: 0, quiet: true, stateFile: false });
  const proxy = await flakyProxy(hub.url.replace('ws://', 'http://'));
  const other = await CrossTalk.connect({ name: 'other', url: hub.url, reconnect: false });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-badreply-'));
  try {
    const ch = await other.createChannel('bad-reply');
    const child = spawn(process.execPath, ['--import', tsx, cli, 'wait', ch.address, '--mentions', '--timeout', '0', '--name', 'listener', '--url', proxy.url],
      { env: { ...process.env, NO_COLOR: '1', HOME: home } });
    let out = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (out += d));
    const done = new Promise<number>(resolve => child.on('exit', code => resolve(code ?? -1)));

    // Wait until the listener has joined, then break the events endpoint for a few polls.
    const t0 = Date.now();
    for (;;) {
      await ch.refresh();
      if ([...ch.members.values()].some(m => m.name === 'listener')) break;
      if (Date.now() - t0 > 20_000) throw new Error(`listener never joined; output:\n${out}`);
      await new Promise(r => setTimeout(r, 100));
    }
    proxy.state.broken = true;
    // End the long-poll already in flight (chatter doesn't wake a --mentions
    // listener), so its next polls hit the broken endpoint.
    await new Promise(r => setTimeout(r, 300));
    await ch.send('chatter, not for the listener');
    const t1 = Date.now();
    while (proxy.state.badReplies < 2) {
      if (child.exitCode !== null) throw new Error(`listener exited during bad replies; output:\n${out}`);
      if (Date.now() - t1 > 20_000) throw new Error(`listener stopped polling; output:\n${out}`);
      await new Promise(r => setTimeout(r, 50));
    }
    proxy.state.broken = false;

    await ch.send('@listener ping after the hub came back');
    const code = await Promise.race([done, new Promise<number>((_, rej) => setTimeout(() => rej(new Error(`no wake; output:\n${out}`)), 30_000))]);
    assert.equal(code, 0, out);
    assert.match(out, /ping after the hub came back/);
    assert.doesNotMatch(out, /Cannot read properties of undefined/);
  } finally {
    await other.close();
    await proxy.close();
    await hub.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';
import { Bridge, createMcpServer } from '../src/mcp/server.js';
import { listSecrets, openSealed, receiveSealedDm, sealIdentity, sealSecret } from '../src/client/secrets.js';

process.env.CROSSTALK_LISTENER_CHECK = '0';

/**
 * "Share a key" in the web app: website/cockpit.js seals a key in the browser
 * (WebCrypto) to an agent's public sealing key, and the agent's machine opens
 * it with openSealed(). The browser code sits between seal:start / seal:end.
 */
const source = fs.readFileSync(new URL('../website/cockpit.js', import.meta.url), 'utf8');
const block = /\/\/ seal:start[^\n]*\n([\s\S]*?)\n\s*\/\/ seal:end/.exec(source)?.[1];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xt-share-'));

test("the web app's seal opens with openSealed(): same X25519 + HKDF + AES-GCM format as sealSecret()", async () => {
  assert.ok(block, 'seal:start / seal:end markers are in website/cockpit.js');
  // Node's WebCrypto is the same API the browser has.
  const seal = new Function('globalThis', `${block}\nreturn sealForAgent;`)({ crypto: webcrypto, atob, btoa, TextEncoder }) as (to: string, name: string, value: string) => Promise<string>;
  const mine = tmp();
  const other = tmp();
  const me = sealIdentity(mine).publicKey;
  const value = 'ghp_example_ünïcødé_' + 'x'.repeat(300);
  const sealed = await seal(me, 'GITHUB_TOKEN', value);
  assert.match(sealed, /^xsb1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]+$/);
  assert.equal(openSealed(sealed, 'GITHUB_TOKEN', mine), value);
  assert.throws(() => openSealed(sealed, 'OTHER_NAME', mine), 'the name is bound in');
  assert.throws(() => openSealed(sealed, 'GITHUB_TOKEN', other), 'another machine cannot open it');
  // And the other way round: the Node sealer's output has the same shape.
  assert.equal(sealSecret(me, 'GITHUB_TOKEN', value).split('.').length, 3);
});

test('a sealed DM goes into the key store; the notice never carries the blob or the key', () => {
  const dir = tmp();
  const key = sealIdentity(dir).publicKey;
  const sealed = sealSecret(key, 'OPENAI_API_KEY', 'sk-secret-value');
  const got = receiveSealedDm(`xsecret OPENAI_API_KEY ${sealed}`, 'josh', dir)!;
  assert.equal(got.ok, true);
  assert.equal(got.notice, 'KEY RECEIVED: OPENAI_API_KEY from josh. Use it with crosstalk run --secret OPENAI_API_KEY -- <command>');
  assert.deepEqual(listSecrets(dir).map(s => [s.name, s.from]), [['OPENAI_API_KEY', 'shared by josh']]);

  const elsewhere = sealSecret(sealIdentity(tmp()).publicKey, 'OPENAI_API_KEY', 'sk-secret-value');
  const bad = receiveSealedDm(`xsecret OPENAI_API_KEY ${elsewhere}`, 'josh', dir)!;
  assert.equal(bad.ok, false);
  assert.ok(!bad.notice.includes('xsb1') && !bad.notice.includes('sk-secret'), bad.notice);
  assert.equal(receiveSealedDm('hello there', 'josh', dir), undefined);
});

test('MCP: a shared key never reaches crosstalk_read_inbox; the agent gets KEY RECEIVED and can use it by name', async () => {
  const dir = tmp();
  process.env.CROSSTALK_SECRETS_DIR = dir;
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const josh = await CrossTalk.connect({ name: 'josh', url: server.url, reconnect: false });
  const bridge = new Bridge({ name: 'gemini', url: server.url });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(bridge).connect(a);
  const client = new Client({ name: 'test-host', version: '0' });
  await client.connect(b);
  const call = async (tool: string, args: Record<string, unknown> = {}) => ((await client.callTool({ name: tool, arguments: args })) as any).content[0].text as string;
  try {
    const ch = await josh.createChannel('keys');
    await call('crosstalk_join_channel', { channel: ch.address });
    await ch.refresh();
    const gemini = [...ch.members.values()].find(m => m.name === 'gemini')!;
    assert.equal(gemini.sealKey, sealIdentity(dir).publicKey, 'the MCP agent published its sealing key');

    const sealed = sealSecret(gemini.sealKey!, 'GITHUB_TOKEN', 'ghp_never_shown');
    await josh.dm(gemini.id, `xsecret GITHUB_TOKEN ${sealed}`);
    await josh.dm(gemini.id, 'plain hello');
    await new Promise(r => setTimeout(r, 100));

    const inbox = await call('crosstalk_read_inbox');
    assert.match(inbox, /KEY RECEIVED: GITHUB_TOKEN from josh\. Use it with crosstalk run --secret GITHUB_TOKEN -- <command>/);
    assert.match(inbox, /plain hello/);
    assert.ok(!inbox.includes('xsb1') && !inbox.includes('ghp_never_shown') && !inbox.includes('xsecret'), inbox);
    assert.equal(openSealed(sealed, 'GITHUB_TOKEN', dir), 'ghp_never_shown');
    assert.deepEqual(listSecrets(dir).map(s => s.name), ['GITHUB_TOKEN']);
  } finally {
    await bridge.close();
    await josh.close();
    await server.close();
    delete process.env.CROSSTALK_SECRETS_DIR;
  }
});

test('CLI: crosstalk wait opens a shared key into the store and prints only KEY RECEIVED', async () => {
  const { execFile } = await import('node:child_process');
  const dir = tmp();
  const home = tmp();
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const josh = await CrossTalk.connect({ name: 'josh', url: server.url, reconnect: false });
  try {
    const ch = await josh.createChannel('keys-cli');
    const env = { ...process.env, NO_COLOR: '1', HOME: home, CROSSTALK_HOME: home, CROSSTALK_SECRETS_DIR: dir, CROSSTALK_NO_REVIEW_PROMPT: '1', CROSSTALK_UPDATE_CHECK: '0', CROSSTALK_TELEMETRY: '0', CROSSTALK_URL: server.url };
    const out = new Promise<string>((resolve, reject) =>
      execFile(process.execPath, ['--import', import.meta.resolve('tsx'), path.resolve('src/client/cli.ts'), 'wait', ch.address, '--timeout', '20', '--name', 'bob'], { env }, (err, stdout, stderr) => (err ? reject(new Error(stderr || String(err))) : resolve(stdout + stderr))));
    let bob;
    for (let i = 0; i < 100 && !bob; i++) {
      await new Promise(r => setTimeout(r, 100));
      await ch.refresh();
      bob = [...ch.members.values()].find(m => m.name === 'bob');
    }
    assert.ok(bob?.sealKey, 'the CLI agent published its sealing key');
    await new Promise(r => setTimeout(r, 300)); // its long-poll is open
    await josh.dm(bob!.id, `xsecret NPM_TOKEN ${sealSecret(bob!.sealKey!, 'NPM_TOKEN', 'npm_hidden_value')}`);
    const text = await out;
    assert.match(text, /KEY RECEIVED: NPM_TOKEN from josh\. Use it with crosstalk run --secret NPM_TOKEN -- <command>/);
    assert.ok(!text.includes('xsb1') && !text.includes('npm_hidden_value') && !text.includes('xsecret'), text);
    assert.deepEqual(listSecrets(dir).map(s => [s.name, s.from]), [['NPM_TOKEN', 'shared by josh']]);
  } finally {
    await josh.close();
    await server.close();
  }
});

/**
 * The same seal in a real Chromium. Runs when Playwright can be loaded: from
 * this repo, or CROSSTALK_PLAYWRIGHT=<path to playwright-core> with
 * CROSSTALK_CHROMIUM=<browser executable>. Skipped otherwise.
 */
test('Chromium: the web app seals a key that openSealed() opens', async t => {
  let chromium: any;
  try {
    const where = process.env.CROSSTALK_PLAYWRIGHT || 'playwright-core';
    const mod: any = await import(where.startsWith('/') ? path.join(where, 'index.js') : where);
    chromium = mod.chromium ?? mod.default?.chromium;
    if (!chromium) throw new Error('no chromium export');
  } catch {
    t.skip('Playwright is not installed (set CROSSTALK_PLAYWRIGHT to a playwright-core folder to run this)');
    return;
  }
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CROSSTALK_CHROMIUM || undefined });
  // WebCrypto exists only in secure contexts: the web app is served over https; localhost counts too.
  const http = await import('node:http');
  const site = http.createServer((_req, res) => res.end('<!doctype html><title>seal</title>'));
  await new Promise<void>(r => site.listen(0, '127.0.0.1', r));
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${(site.address() as { port: number }).port}/`);
    const dir = tmp();
    const me = sealIdentity(dir).publicKey;
    const sealed: string = await page.evaluate(([code, key]: [string, string]) => new Function(`${code}\nreturn sealForAgent;`)()(key, 'STRIPE_KEY', 'sk_live_from_chromium'), [block!, me]);
    assert.equal(openSealed(sealed, 'STRIPE_KEY', dir), 'sk_live_from_chromium');
  } finally {
    await browser.close();
    site.close();
  }
});

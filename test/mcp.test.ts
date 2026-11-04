import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';
import { Bridge, createMcpServer } from '../src/mcp/server.js';

/** An MCP client wired to a Bridge, as a host like Gemini CLI would see it. */
async function mcpAgent(name: string, url: string) {
  const bridge = new Bridge({ name, url });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(bridge).connect(a);
  const client = new Client({ name: 'test-host', version: '0' });
  await client.connect(b);
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const res: any = await client.callTool({ name: tool, arguments: args });
    return res.content[0].text as string;
  };
  return { bridge, call, close: () => bridge.close() };
}

test('MCP: unread messages ride on every tool result, reads reach the hub, and idle @mentions warn the sender', async () => {
  const server = await startServer({ port: 0, quiet: true, hub: { idleAfterMs: 200 } });
  const keys = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xt-')), 'keys.json');
  process.env.CROSSTALK_KEYS_FILE = keys;
  const human = await CrossTalk.connect({ name: 'alice', url: server.url, reconnect: false });
  const gemini = await mcpAgent('gemini', server.url);
  try {
    const ch = await human.createChannel('auth');
    await gemini.call('crosstalk_join_channel', { channel: ch.address });

    await ch.send('@gemini please add tests');
    await new Promise(r => setTimeout(r, 50));
    // An unrelated tool call still shows the waiting message, at the top.
    const status = await gemini.call('crosstalk_set_status', { status: 'working', task: 'tests' });
    assert.match(status, /^New since your last call:[\s\S]*please add tests[\s\S]*Status set to working/);
    await new Promise(r => setTimeout(r, 50));
    await ch.refresh();
    assert.equal(ch.attention.find(a => a.agent.name === 'gemini')!.unread, 0, 'the bridge reported the read');

    // Gemini "ends its turn" and stops calling tools.
    await new Promise(r => setTimeout(r, 300));
    const sent = await ch.send('@gemini status?');
    assert.equal(sent.idleMentions?.[0].agent.name, 'gemini');
    assert.equal(sent.idleMentions?.[0].unread, 1);

    const self = await gemini.call('crosstalk_status');
    assert.match(self, /Unread: 1/);
    assert.match(self, /call crosstalk_wait/);
  } finally {
    await gemini.close();
    await human.close();
    await server.close();
    delete process.env.CROSSTALK_KEYS_FILE;
  }
});

test('MCP: a channel created on this machine can be closed with its saved owner key', async () => {
  const server = await startServer({ port: 0, quiet: true });
  process.env.CROSSTALK_KEYS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xt-')), 'keys.json');
  const owner = await mcpAgent('owner', server.url);
  const peer = await CrossTalk.connect({ name: 'peer', url: server.url, reconnect: false });
  try {
    const created = await owner.call('crosstalk_create_channel', { name: 'temp' });
    const address = created.match(/xt_[A-Za-z0-9_-]{22}/)![0];
    const ch = await peer.joinChannel(address);
    const closed = new Promise(r => ch.once('closed', r));
    assert.match(await owner.call('crosstalk_close_channel', {}), /Closed #temp/);
    await closed;
    assert.equal(peer.channels.size, 0);
    assert.equal(fs.readFileSync(process.env.CROSSTALK_KEYS_FILE, 'utf8').includes(address), false, 'the key is forgotten');
  } finally {
    await owner.close();
    await peer.close();
    await server.close();
    delete process.env.CROSSTALK_KEYS_FILE;
  }
});

test('MCP: an unclaimed "on it" is flagged, and a stalled claim nudges its agent on the next call', async () => {
  let skew = 0;
  const server = await startServer({ port: 0, quiet: true, hub: { now: () => Date.now() + skew } });
  const human = await CrossTalk.connect({ name: 'alice', url: server.url, reconnect: false });
  const gemini = await mcpAgent('gemini', server.url);
  try {
    const ch = await human.createChannel('auth');
    await gemini.call('crosstalk_join_channel', { channel: ch.address });
    assert.match(await gemini.call('crosstalk_send', { message: 'on it' }), /hold no claim/);
    assert.match(await gemini.call('crosstalk_claim', { task: 'add tests', everyMinutes: 1 }), /Claimed in #auth/);
    assert.doesNotMatch(await gemini.call('crosstalk_send', { message: "I'm on it" }), /hold no claim/);

    const stalled = new Promise(r => ch.on('claim.updated', c => c.status === 'stalled' && r(c)));
    // Run the hub's sweep as if the promised minute had passed.
    const claim = [...ch.claims.values()][0];
    skew = 2 * 60_000;
    server.hub.sweep();
    assert.equal(((await stalled) as any).id, claim.id);
    await new Promise(r => setTimeout(r, 50));
    assert.match(await gemini.call('crosstalk_list_channels'), /^New since your last call:[\s\S]*Your claim cl_\w+ \("add tests"\) is stalled/);
  } finally {
    await gemini.close();
    await human.close();
    await server.close();
  }
});

test('MCP: unlocking says NOT RELEASED when nothing was released, and list_locks shows what you still hold', async () => {
  const server = await startServer({ port: 0, quiet: true });
  const human = await CrossTalk.connect({ name: 'alice', url: server.url, reconnect: false });
  const gemini = await mcpAgent('gemini', server.url);
  try {
    const ch = await human.createChannel('auth');
    await gemini.call('crosstalk_join_channel', { channel: ch.address });
    await ch.lock('src/auth.ts', 'alice editing');
    await gemini.call('crosstalk_lock_file', { filePath: 'app/products/[handle]/route.ts', reason: 'routes' });
    await gemini.call('crosstalk_lock_file', { filePath: 'src/db.ts', reason: 'schema' });

    // A path nobody locked, e.g. a shell loop that passed a literal "$f".
    assert.match(await gemini.call('crosstalk_unlock_file', { filePath: '$f' }),
      /^NOT RELEASED: you held no lock on \$f[\s\S]*You still hold: app\/products\/\[handle\]\/route.ts, src\/db.ts/);
    // Someone else's lock.
    assert.match(await gemini.call('crosstalk_unlock_file', { filePath: 'src/auth.ts' }), /^NOT RELEASED: src\/auth.ts — alice/);
    assert.ok(ch.locks.has('src/auth.ts'));

    assert.match(await gemini.call('crosstalk_list_locks'), /^Your locks in #auth: app\/products\/\[handle\]\/route.ts — gemini: routes[\s\S]*src\/db.ts/);
    assert.doesNotMatch(await gemini.call('crosstalk_list_locks'), /alice/);
    assert.match(await gemini.call('crosstalk_list_locks', { all: true }), /src\/auth.ts — alice/);

    assert.match(await gemini.call('crosstalk_unlock_file', { filePath: './src/db.ts' }), /^Unlocked src\/db.ts in #auth\. You still hold: app\/products/);
    assert.match(await gemini.call('crosstalk_unlock_file', { filePath: 'app/products/[handle]/route.ts' }), /You hold no other locks here/);
    assert.match(await gemini.call('crosstalk_list_locks'), /Your locks in #auth: none/);

    // A lock held by this agent's `crosstalk lock` holder (same name, role "locks").
    const holder = await CrossTalk.connect({ name: 'gemini', role: 'locks', url: server.url, reconnect: false });
    try {
      await (await holder.joinChannel(ch.address)).lock('src/held.ts', 'cli');
      assert.match(await gemini.call('crosstalk_unlock_file', { filePath: 'src/held.ts' }), /^NOT RELEASED:[\s\S]*release it from a shell with `crosstalk unlock src\/held.ts`/);
    } finally {
      await holder.close();
    }
  } finally {
    await gemini.close();
    await human.close();
    await server.close();
  }
});

test('MCP: locks and channels lost to a hub restart show up on the next tool call', async () => {
  const server = await startServer({ port: 0, quiet: true });
  const human = await CrossTalk.connect({ name: 'alice', url: server.url, reconnect: false });
  const gemini = await mcpAgent('gemini', server.url);
  try {
    const ch = await human.createChannel('auth');
    await gemini.call('crosstalk_join_channel', { channel: ch.address });
    await gemini.call('crosstalk_lock_file', { filePath: 'src/db.ts', reason: 'schema' });
    const client = await gemini.bridge.get();
    const lock = [...client.channels.get(ch.address)!.locks.values()][0];
    // What the SDK emits after a reconnect it couldn't resume.
    client.emit('locks.lost', { locks: [lock], reason: 'not_resumed' });
    client.emit('channel.lost', { channel: ch.address, name: 'auth', reason: 'hub_restarted' });
    const out = await gemini.call('crosstalk_list_channels');
    assert.match(out, /^New since your last call:[\s\S]*LOCKS LOST:[^\n]*src\/db.ts/);
    assert.match(out, /CHANNEL LOST: the hub no longer has #auth/);
  } finally {
    await gemini.close();
    await human.close();
    await server.close();
  }
});

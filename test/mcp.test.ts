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

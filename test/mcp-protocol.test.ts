import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startServer } from '../src/server/index.js';
import { Bridge, McpServer } from '../src/mcp/server.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('MCP over stdio: the official client initializes, lists tools and calls them', async () => {
  const hub = await startServer({ port: 0, quiet: true });
  const keys = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xt-')), 'keys.json');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', path.join(root, 'src/mcp/server.ts')],
    cwd: root,
    env: { ...process.env as Record<string, string>, CROSSTALK_URL: hub.url, CROSSTALK_AGENT_NAME: 'stdio-agent', CROSSTALK_AUTOSTART: '0', CROSSTALK_KEYS_FILE: keys },
    stderr: 'ignore'
  });
  const client = new Client({ name: 'test-host', version: '0' });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, 'crosstalk');
    assert.match(client.getInstructions() ?? '', /You are NOT notified of new messages/);
    const { tools } = await client.listTools();
    assert.ok(tools.some(t => t.name === 'crosstalk_wait'));
    assert.equal(tools.find(t => t.name === 'crosstalk_send')!.inputSchema.type, 'object');

    const created: any = await client.callTool({ name: 'crosstalk_create_channel', arguments: { name: 'stdio' } });
    assert.match(created.content[0].text, /Started #stdio/);
    const bad: any = await client.callTool({ name: 'crosstalk_nope', arguments: {} });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /Unknown tool/);
  } finally {
    await client.close();
    await hub.close();
  }
});

test('MCP JSON-RPC: version negotiation, ping, errors, notifications and cancellation', async () => {
  const hub = await startServer({ port: 0, quiet: true });
  const bridge = new Bridge({ name: 'raw', url: hub.url });
  const server = new McpServer(bridge);
  try {
    const init: any = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    assert.equal(init.result.protocolVersion, '2025-03-26', 'a supported version is echoed');
    assert.deepEqual(init.result.capabilities, { tools: {} });
    const future: any = await server.handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } });
    assert.equal(future.result.protocolVersion, '2025-11-25', 'an unknown version gets the newest');

    assert.deepEqual(await server.handle({ jsonrpc: '2.0', id: 'p', method: 'ping' }), { jsonrpc: '2.0', id: 'p', result: {} });
    assert.equal(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined, 'notifications get no reply');
    assert.equal(await server.handle({ jsonrpc: '2.0', id: 9, result: {} }), undefined, 'client responses get no reply');
    assert.equal(((await server.handle({ jsonrpc: '2.0', id: 3, method: 'resources/list' })) as any).error.code, -32601);
    assert.equal(((await server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: {} })) as any).error.code, -32602);
    assert.equal(((await server.handle({ id: 5, method: 'ping' })) as any).error.code, -32600);

    // A blocking wait ends as soon as the client cancels it.
    const started = Date.now();
    const waiting = server.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'crosstalk_wait', arguments: { timeoutSeconds: 30 } } });
    await new Promise(r => setTimeout(r, 100));
    await server.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 6 } });
    const done: any = await waiting;
    assert.ok(Date.now() - started < 5000, 'returned promptly');
    assert.ok(done.result.content[0].text);
  } finally {
    await bridge.close();
    await hub.close();
  }
});

test('remote MCP: plain JSON replies, 202 for notifications, 405 for GET, DELETE ends the session', async () => {
  const hub = await startServer({ port: 0, quiet: true });
  const base = hub.url.replace(/^ws/, 'http');
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/mcp?name=raw-web`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body)
  });
  try {
    assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).status, 400, 'sessions start with initialize');
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    assert.equal(init.status, 200);
    assert.match(init.headers.get('content-type') ?? '', /application\/json/);
    const sid = init.headers.get('mcp-session-id')!;
    assert.ok(sid);
    assert.equal(((await init.json()) as any).result.serverInfo.name, 'crosstalk');

    const session = { 'Mcp-Session-Id': sid };
    assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, session)).status, 202);
    const listed: any = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, session)).json();
    assert.ok(listed.result.tools.length > 5);
    const batch: any = await (await post([{ jsonrpc: '2.0', id: 3, method: 'ping' }, { jsonrpc: '2.0', id: 4, method: 'ping' }], session)).json();
    assert.deepEqual(batch.map((r: any) => r.id), [3, 4]);

    assert.equal((await fetch(`${base}/mcp`, { headers: session })).status, 405);
    assert.equal((await fetch(`${base}/mcp`, { method: 'DELETE', headers: session })).status, 200);
    assert.equal((await post({ jsonrpc: '2.0', id: 5, method: 'ping' }, session)).status, 404, 'the session is gone');
  } finally {
    await hub.close();
  }
});

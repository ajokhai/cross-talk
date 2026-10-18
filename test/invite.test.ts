import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteText, isLocalHub } from '../src/client/invite.js';

const address = 'xt_G0f-mX9b0ntbMNUA5az41g';

// Pins the exact wording: website/cockpit.js copies this text for its Copy button.
test('invite for a public hub covers both "already set up" and every first-time path', () => {
  assert.equal(inviteText({ address, hub: 'wss://hub.example.com' }), [
    "You're invited to a CrossTalk conversation: a shared channel where AI agents message each other and lock files before editing.",
    `Channel: ${address}`,
    'Hub: wss://hub.example.com',
    '',
    `If you already have CrossTalk (crosstalk_* tools or the crosstalk command): join ${address} on wss://hub.example.com, say hello, and keep listening with crosstalk_wait.`,
    '',
    'First time? Pick whichever you can do:',
    `- Run shell commands: npm install -g https://github.com/ajokhai/cross-talk/releases/latest/download/cross-talk.tgz, then: crosstalk up ${address} --url wss://hub.example.com --name <your-name>`,
    `- Make HTTP requests only: follow https://cross-talk-sandy.vercel.app/llms.txt using hub https://hub.example.com (POST /v1/sessions, then channel.join ${address} via /v1/rpc, then long-poll /v1/events).`,
    `- MCP client (claude.ai and similar): add the connector https://hub.example.com/mcp?name=<your-name>&channel=${address}`
  ].join('\n'));
});

test('invite for a localhost hub says it is only reachable from that machine', () => {
  const text = inviteText({ address, hub: 'ws://localhost:4488' });
  assert.match(text, /--url ws:\/\/localhost:4488 /);
  assert.match(text, /\n- This hub runs on someone's machine \(localhost\), so you must be on that machine to reach it\.$/);
  assert.doesNotMatch(text, /\/v1\/sessions|\/mcp\?/);
});

test('isLocalHub', () => {
  for (const hub of ['ws://localhost:4488', 'ws://127.0.0.1:4488', 'ws://[::1]:4488']) assert.equal(isLocalHub(hub), true, hub);
  for (const hub of ['wss://hub-production-a114.up.railway.app', 'ws://192.168.1.5:4488', 'not a url']) assert.equal(isLocalHub(hub), false, hub);
});

test('remote MCP invites name the hub as the client reached it, not its loopback address', async () => {
  const { startServer } = await import('../src/server/index.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const server = await startServer({ port: 0, quiet: true });
  const client = new Client({ name: 'test', version: '1' });
  try {
    // As behind Railway: TLS ends at the proxy, which forwards the public host.
    const headers = { 'X-Forwarded-Host': 'hub.example.com', 'X-Forwarded-Proto': 'https' };
    const base = server.url.replace('ws://', 'http://');
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp?name=claude-web`), { requestInit: { headers } }));
    const created: any = await client.callTool({ name: 'crosstalk_create_channel', arguments: { name: 'remote' } });
    const text: string = created.content[0].text;
    assert.match(text, /\nHub: wss:\/\/hub\.example\.com\n/);
    assert.match(text, /add the connector https:\/\/hub\.example\.com\/mcp\?name=<your-name>&channel=xt_/);
    assert.doesNotMatch(text, /127\.0\.0\.1/);
  } finally {
    await client.close();
    await server.close();
  }
});

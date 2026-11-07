import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteText, isLocalHub } from '../src/client/invite.js';

const address = 'xt_G0f-mX9b0ntbMNUA5az41g';

// Pins the exact wording: website/cockpit.js copies this text for its Copy button.
test('the invite is one line: an address that says where the channel lives, and the setup guide', () => {
  const guide = 'New to CrossTalk? Set up and join (any agent): https://cross-talk-roan.vercel.app/llms.txt';
  assert.equal(inviteText({ address, hub: 'wss://hub-production-a114.up.railway.app' }), `Join my CrossTalk channel ${address}. ${guide}`);
  assert.equal(inviteText({ address, hub: 'wss://hub.example.com' }), `Join my CrossTalk channel ${address}@hub.example.com. ${guide}`);
  assert.equal(inviteText({ address, hub: 'ws://192.168.1.5:4488' }), `Join my CrossTalk channel ${address}@192.168.1.5:4488. ${guide}`);
  for (const hub of ['wss://hub.example.com', 'ws://localhost:4488']) assert.ok(!inviteText({ address, hub }).includes('\n'), hub);
});

test('an invite to a hub on this computer uses xtl_ and says only agents on it can join', () => {
  const text = inviteText({ address, hub: 'ws://localhost:4488' });
  assert.match(text, /^Join my CrossTalk channel xtl_G0f-mX9b0ntbMNUA5az41g \(on a hub on my computer: only agents on this computer can join; elsewhere, ask me for a remote invite\)\. /);
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
    assert.match(text, /Join my CrossTalk channel xt_[A-Za-z0-9_-]{22}@hub\.example\.com\. /);
    assert.match(text, /^SHOW YOUR USER THIS INVITE NOW/);
    assert.doesNotMatch(text, /127\.0\.0\.1/);
  } finally {
    await client.close();
    await server.close();
  }
});

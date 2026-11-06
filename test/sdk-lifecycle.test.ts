import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server/index.js';
import { CrossTalk, CrossTalkError } from '../src/client/sdk.js';

const until = async (check: () => boolean, ms = 10_000) => {
  const t = Date.now();
  while (!check()) {
    if (Date.now() - t > ms) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 20));
  }
};
const present = (server: any, name: string) =>
  [...server.hub.agents.values()].filter((c: any) => c.agent?.name === name && c.phase !== 'closed').length;

test('close() while a reconnect is saying hello leaves nothing connected', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const ct = await CrossTalk.connect({ name: 'alice', url: server.url });
  try {
    const c: any = ct;
    let dropped = false;
    ct.on('disconnected', () => (dropped = true));
    c.ws.terminate(); // a network drop: the client goes to reconnecting
    await until(() => dropped);
    clearTimeout(c.reconnectTimer);
    c.reconnectTimer = undefined;
    const attempt = c.reconnect(); // hello in flight
    await ct.close(); // ...and the user closes now
    await attempt;
    await new Promise(r => setTimeout(r, 300));
    assert.equal(c.state, 'closed');
    assert.equal(c.ws, undefined);
    assert.equal(present(server, 'alice'), 0, 'no agent left behind on the hub');
  } finally {
    await server.close();
  }
});

test('a failed rejoin that is not "channel gone" keeps the channel for the next attempt', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const ct = await CrossTalk.connect({ name: 'bob', url: server.url, reconnect: false });
  try {
    const ch = await ct.createChannel('keep');
    const c: any = ct;
    c.state = 'reconnecting';
    c.open = async () => { c.state = 'open'; };
    const real = c.request.bind(c);
    c.request = (type: string, body: any) => type === 'channel.join' ? Promise.reject(new CrossTalkError('timeout', 'slow')) : real(type, body);
    await c.reconnect();
    assert.ok(ct.channels.has(ch.address), 'still known locally');
    c.request = (type: string) => type === 'channel.join' ? Promise.reject(new CrossTalkError('not_found', 'gone')) : Promise.resolve();
    let lost = false;
    ct.on('channel.lost', () => (lost = true));
    c.state = 'reconnecting';
    await c.reconnect();
    assert.ok(!ct.channels.has(ch.address), 'forgotten once the hub says it is gone');
    assert.ok(lost);
  } finally {
    await ct.close();
    await server.close();
  }
});

test('a throwing "reconnected" listener does not start a second connection', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const ct = await CrossTalk.connect({ name: 'carol', url: server.url });
  try {
    let reconnects = 0;
    const errors: unknown[] = [];
    ct.on('error', e => errors.push(e));
    ct.on('reconnected', () => { reconnects++; throw new Error('listener bug'); });
    (ct as any).ws.terminate();
    await until(() => reconnects === 1);
    await new Promise(r => setTimeout(r, 1500));
    assert.equal(reconnects, 1, 'one reconnect only');
    assert.equal((ct as any).state, 'open');
    assert.equal(errors.length, 1, 'the listener error is reported');
    assert.equal(present(server, 'carol'), 1);
  } finally {
    await ct.close();
    await server.close();
  }
});

test('MCP bridge closed while it is still connecting leaves no agent behind', async () => {
  const { Bridge } = await import('../src/mcp/server.js');
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  try {
    const bridge = new Bridge({ name: 'remote-agent', url: server.url });
    const connecting = bridge.get();
    await bridge.close(); // e.g. the remote MCP session is ended at once
    await connecting.catch(() => {});
    await new Promise(r => setTimeout(r, 300));
    assert.equal(present(server, 'remote-agent'), 0);
    await assert.rejects(bridge.get(), /ended/);
  } finally {
    await server.close();
  }
});

test('MCP agents are warned until something listens under their name, and the warning stops once it does', async () => {
  const { Bridge } = await import('../src/mcp/server.js');
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const base = server.url.replace('ws://', 'http://');
  try {
    const bridge = new Bridge({ name: 'claude-code', url: server.url });
    const client = await bridge.get();
    const ch = await client.createChannel('listen-check');
    const warning = await bridge.listenerWarning(client);
    assert.match(warning!, /NO LISTENER/);
    assert.match(warning!, new RegExp(`crosstalk wait ${ch.address} --mentions --timeout 0 --name claude-code --url ${server.url.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));

    // A background `crosstalk wait` is an HTTP session under the same name, long-polling.
    const s = await (await fetch(`${base}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"claude-code"}' })).json() as any;
    await fetch(`${base}/v1/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-crosstalk-session': s.session }, body: JSON.stringify({ type: 'channel.join', channel: ch.address }) });
    const polling = fetch(`${base}/v1/events?wait=3&only=mentions`, { headers: { 'x-crosstalk-session': s.session } });
    await new Promise(r => setTimeout(r, 200));
    (bridge as any).listenerChecks.clear(); // skip the once-a-minute throttle
    assert.equal(await bridge.listenerWarning(client), undefined, 'listening now');
    await polling;

    const remote = new Bridge({ name: 'web-agent', url: server.url, remote: true });
    const rc = await remote.get();
    await rc.joinChannel(ch.address);
    assert.equal(await remote.listenerWarning(rc), undefined, 'remote MCP clients cannot run background commands, so no nag');
    await remote.close();
    await bridge.close();
  } finally {
    await server.close();
  }
});

test('MCP join with the invite\'s hub moves the agent to that hub', async () => {
  const { Bridge } = await import('../src/mcp/server.js');
  const hubA = await startServer({ port: 0, quiet: true, stateFile: false });
  const hubB = await startServer({ port: 0, quiet: true, stateFile: false });
  const owner = await CrossTalk.connect({ name: 'owner', url: hubB.url, reconnect: false });
  try {
    const ch = await owner.createChannel('elsewhere');
    const bridge = new Bridge({ name: 'traveller', url: hubA.url });
    await bridge.get();
    await bridge.switchHub(hubB.url);
    const client = await bridge.get();
    assert.equal(client.url, hubB.url);
    await client.joinChannel(ch.address);
    assert.equal(present(hubB, 'traveller'), 1);
    await new Promise(r => setTimeout(r, 200));
    assert.equal(present(hubA, 'traveller'), 0, 'left the old hub');
    await assert.rejects(bridge.switchHub('not a url'), /not a hub URL/);
    await bridge.close();
  } finally {
    await owner.close();
    await hubA.close();
    await hubB.close();
  }
});

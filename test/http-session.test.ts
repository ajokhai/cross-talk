import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server/index.js';

async function rig() {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  const base = server.url.replace('ws://', 'http://');
  const post = async (path: string, body: unknown, session?: string) =>
    (await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(session ? { 'x-crosstalk-session': session } : {}) }, body: JSON.stringify(body) })).json() as Promise<any>;
  const poll = (session: string, query: string) =>
    fetch(`${base}/v1/events?${query}`, { headers: { 'x-crosstalk-session': session } }).then(async r => ({ status: r.status, body: await r.json() as any }));
  return { server, base, post, poll };
}

test('two filtered long-polls on one session do not freeze the hub; the newer one wins', async () => {
  const { server, base, post, poll } = await rig();
  try {
    const a = (await post('/v1/sessions', { name: 'alice' })).session;
    const b = (await post('/v1/sessions', { name: 'bob' })).session;
    const channel = (await post('/v1/rpc', { type: 'channel.create', name: 'x' }, a)).data.channel.id;
    await post('/v1/rpc', { type: 'channel.join', channel }, b);
    await poll(b, 'wait=0'); // drain join noise

    const first = poll(b, 'wait=5&only=mentions');
    await new Promise(r => setTimeout(r, 100));
    const second = poll(b, 'wait=5&only=mentions');
    // The superseded poll returns promptly and empty.
    const t0 = Date.now();
    const old = await first;
    assert.deepEqual(old.body.events, []);
    assert.ok(Date.now() - t0 < 1000, 'superseded poll returned at once');
    // The hub still answers other clients while the newer poll waits.
    const h0 = Date.now();
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.ok(Date.now() - h0 < 500, `health answered in ${Date.now() - h0}ms`);
    await post('/v1/rpc', { type: 'message.send', channel, content: '@bob for you' }, a);
    const fresh = await second;
    assert.equal(fresh.body.events.length, 1);
    assert.equal(fresh.body.events[0].message.content, '@bob for you');
  } finally {
    await server.close();
  }
});

test('a session the hub closes is gone: its poll returns, later calls get 401 not_registered', async () => {
  const { server, post, poll } = await rig();
  try {
    const s = (await post('/v1/sessions', { name: 'carol' })).session;
    const waiting = poll(s, 'wait=5');
    await new Promise(r => setTimeout(r, 100));
    const hub: any = server.hub;
    const conn = [...hub.agents.values()].find((c: any) => c.agent?.name === 'carol');
    hub.endRemote(conn, 'test: closed by the hub');
    const t0 = Date.now();
    await waiting;
    assert.ok(Date.now() - t0 < 1000, 'the open poll returned at once');
    const after = await poll(s, 'wait=0');
    assert.equal(after.status, 401);
    assert.equal(after.body.error.code, 'not_registered');
  } finally {
    await server.close();
  }
});

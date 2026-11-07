import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_HUB, ONLINE_HUB, channelId, findAddress, formatAddress, isAddress, parseAddress, resolveAddress, sameHub } from '../src/address.js';
import { DEFAULT_URL, LOCAL_URL } from '../src/client/sdk.js';
import { MeshHub } from '../src/server/hub.js';
import { PROTOCOL_VERSION, type ChannelSnapshot } from '../src/protocol.js';

const id = 'G0f-mX9b0ntbMNUA5az41g';
const xt = `xt_${id}`;

test('the hubs addresses name are the SDK defaults', () => {
  assert.equal(ONLINE_HUB, DEFAULT_URL);
  assert.equal(LOCAL_HUB, LOCAL_URL);
});

test('three forms: xt_ (online, or the hub you are set up for), xtl_ (this computer), xt_@hub (any other)', () => {
  assert.deepEqual(parseAddress(xt), { channel: xt, kind: 'online' });
  assert.deepEqual(parseAddress(`xtl_${id}`), { channel: xt, hub: 'ws://localhost:4488', kind: 'local' });
  assert.deepEqual(parseAddress(`${xt}@hub.example.com`), { channel: xt, hub: 'wss://hub.example.com', kind: 'custom' });
  assert.deepEqual(parseAddress(`${xt}@hub.example.com:8443/ct`), { channel: xt, hub: 'wss://hub.example.com:8443/ct', kind: 'custom' });
  assert.deepEqual(parseAddress(`${xt}@10.0.0.5:4488`), { channel: xt, hub: 'ws://10.0.0.5:4488', kind: 'custom' });
  assert.deepEqual(parseAddress(`${xt}@box.lan:9000`), { channel: xt, hub: 'ws://box.lan:9000', kind: 'custom' });
  assert.deepEqual(parseAddress(`${xt}@ws://hub.example.com`), { channel: xt, hub: 'ws://hub.example.com', kind: 'custom' });
  assert.deepEqual(parseAddress(`${xt}@https://hub.example.com/`), { channel: xt, hub: 'wss://hub.example.com', kind: 'custom' });
  // Naming a well-known hub explicitly reads as that hub.
  assert.deepEqual(parseAddress(`${xt}@hub-production-a114.up.railway.app`), { channel: xt, hub: ONLINE_HUB, kind: 'online' });
  assert.deepEqual(parseAddress(`${xt}@localhost:4488`), { channel: xt, hub: LOCAL_HUB, kind: 'local' });
  assert.deepEqual(parseAddress(`${xt}@127.0.0.1:4488`), { channel: xt, hub: LOCAL_HUB, kind: 'local' });
});

test('not addresses', () => {
  for (const bad of ['', 'xt_short', `xtl_${id}@hub.example.com`, `${xt}@`, `${xt}@ftp://x`, `${xt}@user:pw@host`, `yt_${id}`, `${xt}x`, 42, undefined]) {
    assert.equal(isAddress(bad), false, String(bad));
  }
});

test('formatAddress writes the shortest form that reads back as the same hub', () => {
  const cases: [string, string][] = [
    [ONLINE_HUB, xt], [`${ONLINE_HUB}/`, xt], ['ws://localhost:4488', `xtl_${id}`], ['ws://127.0.0.1:4488', `xtl_${id}`],
    ['wss://hub.example.com', `${xt}@hub.example.com`], ['ws://192.168.1.5:4488', `${xt}@192.168.1.5:4488`],
    ['ws://127.0.0.1:65474', `${xt}@127.0.0.1:65474`], ['ws://hub.example.com', `${xt}@ws://hub.example.com`],
    ['wss://box.lan', `${xt}@wss://box.lan`], ['https://door.example.test', `${xt}@door.example.test`]
  ];
  for (const [hub, want] of cases) {
    const got = formatAddress(xt, hub);
    assert.equal(got, want, hub);
    const back = resolveAddress(got, ONLINE_HUB)!;
    assert.equal(back.channel, xt);
    assert.ok(sameHub(back.hub, hub), `${got} reads back as ${hub}`);
  }
  assert.equal(formatAddress(`xtl_${id}`, ONLINE_HUB), xt, 'any form in');
});

test('findAddress picks the address out of pasted text, trailing punctuation and all', () => {
  assert.deepEqual(findAddress(`Join my CrossTalk channel ${xt}@hub.example.com. New to CrossTalk?`), { channel: xt, hub: 'wss://hub.example.com', kind: 'custom' });
  assert.deepEqual(findAddress(`https://cross-talk-roan.vercel.app/cockpit#${xt}`), { channel: xt, kind: 'online' });
  assert.deepEqual(findAddress(`(xtl_${id})`), { channel: xt, hub: LOCAL_HUB, kind: 'local' });
  assert.equal(findAddress('no address here'), undefined);
  assert.equal(channelId(`xtl_${id}`), xt);
});

test('a hub accepts every form and finds the channel by its id', async () => {
  const hub = new MeshHub();
  let seq = 0;
  const agent = (name: string) => {
    const conn = hub.connect({ send: () => {}, close: () => {} }, '10.0.0.1');
    hub.hello(conn, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name } });
    return async (frame: Record<string, unknown>) => {
      const res: any = await hub.request(conn, { id: String(++seq), ...frame });
      assert.ok(res.ok, JSON.stringify(res));
      return res.data;
    };
  };
  const alice = agent('alice');
  const channel = (await alice({ type: 'channel.create', name: 'x' }) as ChannelSnapshot).channel.id;
  const short = channel.slice(3);
  for (const [i, form] of [`xtl_${short}`, `${channel}@hub.example.com`, channel].entries()) {
    const snap = await agent(`b${i}`)({ type: 'channel.join', channel: form }) as ChannelSnapshot;
    assert.equal(snap.channel.id, channel, form);
  }
  await alice({ type: 'message.send', channel: `xtl_${short}`, content: 'hi' });
  assert.equal(hub.receiptsByAddress(`${channel}@hub.example.com`)?.length, 1);
});

test('the CLI goes to the hub the address names, with no --url or CROSSTALK_URL', async () => {
  const { startServer } = await import('../src/server/index.js');
  const { execFile } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  try {
    const base = server.url.replace('ws://', 'http://');
    const post = async (route: string, body: unknown, session?: string) =>
      (await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...(session ? { 'x-crosstalk-session': session } : {}) }, body: JSON.stringify(body) })).json() as Promise<any>;
    const s = (await post('/v1/sessions', { name: 'poster' })).session;
    const channel = (await post('/v1/rpc', { type: 'channel.create', name: 'x' }, s)).data.channel.id;
    await post('/v1/rpc', { type: 'message.send', channel, content: 'found me' }, s);

    const address = formatAddress(channel, server.url);
    assert.match(address, /^xt_[A-Za-z0-9_-]{22}@127\.0\.0\.1:\d+$/);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-address-'));
    const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1', HOME: home, CROSSTALK_HOME: home, CROSSTALK_NO_REVIEW_PROMPT: '1', CROSSTALK_UPDATE_CHECK: '0', CROSSTALK_TELEMETRY: '0' };
    delete env.CROSSTALK_URL;
    const out = await new Promise<string>((resolve, reject) =>
      execFile(process.execPath, ['--import', import.meta.resolve('tsx'), path.resolve('src/client/cli.ts'), 'history', address, '--name', 'reader'], { env }, (err, stdout, stderr) => (err ? reject(new Error(stderr)) : resolve(stdout))));
    assert.match(out, /poster: found me/);
  } finally {
    await server.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareVersions, updateNotice, VERSION } from '../src/version.js';
import { MeshHub, SERVER_VERSION } from '../src/server/hub.js';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';
import { PROTOCOL_VERSION } from '../src/protocol.js';

test('compareVersions and updateNotice', () => {
  assert.equal(compareVersions('2.10.0', '2.9.0'), 1);
  assert.equal(compareVersions('2.9.0', '2.10.0'), -1);
  assert.equal(compareVersions('2.13.0', '2.13.0'), 0);
  assert.equal(compareVersions('3.0.0-beta', '2.99.1'), 1);
  assert.equal(updateNotice(undefined), undefined);
  assert.equal(updateNotice(VERSION), undefined, 'no notice when current');
  assert.equal(updateNotice('1.0.0'), undefined, 'no notice when the hub is older');
  const note = updateNotice('99.0.0', '2.13.0')!;
  assert.match(note, /^CrossTalk 99\.0\.0 is available \(you have 2\.13\.0\)/);
  assert.match(note, /crosstalk update/);
});

/** Boots a hub from state saved by a hub reporting `hubVersion` (undefined: one too old to report it); returns the notices in its channel. */
async function bootFrom(hubVersion: string | undefined): Promise<string[]> {
  const hub = new MeshHub();
  const conn = hub.connect({ send: () => {}, close: () => {} }, '10.0.0.1');
  hub.hello(conn, { type: 'hello', protocol: PROTOCOL_VERSION, agent: { name: 'alice' } });
  const created: any = await hub.request(conn, { id: '1', type: 'channel.create', name: 'upd' });
  const state: any = hub.exportState();
  if (hubVersion === undefined) delete state.hubVersion;
  else state.hubVersion = hubVersion;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xt-upd-')), 'hub.json');
  fs.writeFileSync(file, JSON.stringify(state));
  const server = await startServer({ port: 0, quiet: true, stateFile: file });
  try {
    const res = await (await fetch(`${server.url.replace('ws://', 'http://')}/api/channels/${created.data.channel.id}`)).json() as any;
    return res.messages.filter((m: any) => m.kind === 'notice').map((m: any) => m.content);
  } finally {
    await server.close();
  }
}

test('a hub restarting onto a newer version announces it in every channel', async () => {
  const notices = await bootFrom('1.0.0');
  assert.equal(notices.length, 1);
  assert.match(notices[0], new RegExp(`^CrossTalk hub updated from 1\\.0\\.0 to ${SERVER_VERSION.replace(/\./g, '\\.')}\\.`));
  assert.match(notices[0], /crosstalk update/);
  assert.equal((await bootFrom(undefined)).length, 1, 'state from a hub that predates hubVersion counts as older');
  assert.equal((await bootFrom(SERVER_VERSION)).length, 0, 'a plain restart says nothing');
});

test('clients learn the hub version: HTTP sessions and the SDK', async () => {
  const server = await startServer({ port: 0, quiet: true, stateFile: false });
  try {
    const res = await (await fetch(`${server.url.replace('ws://', 'http://')}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"h"}' })).json() as any;
    assert.equal(res.serverVersion, SERVER_VERSION);
    const ct = await CrossTalk.connect({ name: 'sdk', url: server.url, reconnect: false });
    assert.equal(ct.serverVersion, SERVER_VERSION);
    await ct.close();
  } finally {
    await server.close();
  }
});

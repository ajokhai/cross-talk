import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server/index.js';
import { HttpAgent } from '../src/client/http.js';
import type { ChannelSnapshot } from '../src/protocol.js';

test('a CLI (HTTP) agent carries on as itself after the hub restarts: no duplicate, claims and locks kept', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-resume-'));
  const stateFile = path.join(dir, 'hub-state.json');
  let hub = await startServer({ port: 0, quiet: true, stateFile });
  const port = Number(new URL(hub.url).port);
  try {
    const owner = new HttpAgent({ name: 'josh', url: hub.url, sessionFile: path.join(dir, 'josh.json') });
    await owner.open();
    const channel = (await owner.request('channel.create', { name: 'restart' })).channel.id;

    const agent = new HttpAgent({ name: 'worker', url: hub.url, sessionFile: path.join(dir, 'worker.json') });
    assert.equal(await agent.open(), true);
    const id = agent.agent!.id;
    await agent.request('channel.join', { channel });
    await agent.request('claim.create', { channel, task: 'ship it' });
    await agent.request('lock.acquire', { channel, file: 'src/a.ts', reason: 'editing' });

    // The hub restarts (a redeploy): every session token is forgotten.
    await hub.close();
    hub = await startServer({ port, quiet: true, stateFile });

    // A later CLI call (same session file, as a new process would read it).
    const again = new HttpAgent({ name: 'worker', url: hub.url, sessionFile: path.join(dir, 'worker.json') });
    // The first request can hit a pooled socket to the old process; listeners retry, so does this.
    const resumedNew = await again.open().catch(() => again.open());
    assert.equal(resumedNew, false, 'resumed, not a new agent');
    assert.equal(again.agent!.id, id);

    const snap: ChannelSnapshot = await again.request('channel.state', { channel });
    const workers = snap.members.filter(m => m.name === 'worker');
    assert.equal(workers.length, 1, `one worker, not a ghost and a new one: ${JSON.stringify(workers.map(w => w.id))}`);
    assert.equal(snap.claims.length, 1, 'claim kept');
    assert.equal(snap.locks.length, 1, 'lock kept');
    assert.ok(!snap.messages.some(m => /left|disconnected/i.test(m.content)), 'nobody was shown leaving');
  } finally {
    await hub.close();
  }
});

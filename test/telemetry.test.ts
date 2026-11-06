import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkIn, startTelemetry, telemetryEnabled, telemetryId } from '../src/server/telemetry.js';
import { VERSION } from '../src/version.js';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xt-tel-')), 'id');

async function collector() {
  const bodies: any[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      bodies.push({ body: JSON.parse(raw), ua: req.headers['user-agent'] });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  return { url: `http://127.0.0.1:${port}/api/ping`, bodies, close: () => new Promise(r => server.close(r)) };
}

test('telemetry is on by default; the flag, CROSSTALK_TELEMETRY, DO_NOT_TRACK and CI services turn it off', () => {
  assert.equal(telemetryEnabled(undefined, {}), true);
  assert.equal(telemetryEnabled(false, {}), false);
  assert.equal(telemetryEnabled(undefined, { CCR_AGENT_PROXY_ENABLED: '1' }), false, 'Claude Code cloud containers do not check in');
  assert.equal(telemetryEnabled(undefined, { CROSSTALK_TELEMETRY: '0' }), false);
  assert.equal(telemetryEnabled(true, { CROSSTALK_TELEMETRY: 'off' }), false, 'the env var vetoes the flag');
  assert.equal(telemetryEnabled(undefined, { DO_NOT_TRACK: '1' }), false);
  assert.equal(telemetryEnabled(undefined, { GITHUB_ACTIONS: 'true', CI: 'true' }), false);
  assert.equal(telemetryEnabled(undefined, { GITLAB_CI: 'true' }), false);
  assert.equal(telemetryEnabled(undefined, { CI: 'true' }), true, 'a bare CI (set by some app hosts) is not a CI service');
  assert.equal(telemetryEnabled(undefined, { GITHUB_ACTIONS: 'true', CROSSTALK_TELEMETRY: '1' }), true, 'an explicit opt-in beats CI');
  assert.equal(telemetryEnabled(undefined, { DO_NOT_TRACK: '0' }), true);
});

test('disabled telemetry sends nothing', async () => {
  const c = await collector();
  try {
    const stop = startTelemetry({ enabled: false, url: c.url, idFile: tmpFile() });
    await new Promise(r => setTimeout(r, 200));
    stop();
    assert.equal(c.bodies.length, 0);
  } finally {
    await c.close();
  }
});

test('enabled telemetry sends only a random id, the version and the kind', async () => {
  const c = await collector();
  const lines: string[] = [];
  try {
    const stop = startTelemetry({ enabled: true, url: c.url, idFile: tmpFile(), log: l => lines.push(l) });
    for (let i = 0; i < 40 && !c.bodies.length; i++) await new Promise(r => setTimeout(r, 25));
    stop();
    assert.equal(c.bodies.length, 1);
    const { body, ua } = c.bodies[0];
    assert.deepEqual(Object.keys(body).sort(), ['id', 'kind', 'v']);
    assert.match(body.id, /^[0-9a-f]{32}$/);
    assert.equal(body.v, VERSION);
    assert.equal(body.kind, 'hub');
    assert.equal(ua, `crosstalk-hub/${VERSION}`);
    assert.match(lines[0], /telemetry on/);
  } finally {
    await c.close();
  }
});

test('cloud hubs get a stable, hashed id that survives redeploys', () => {
  const railway = { RAILWAY_SERVICE_ID: 'svc-123', RAILWAY_ENVIRONMENT_ID: 'env-1' };
  const a = telemetryId(tmpFile(), railway);
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(telemetryId(tmpFile(), railway), a, 'a fresh disk gives the same id');
  assert.notEqual(telemetryId(tmpFile(), { ...railway, RAILWAY_ENVIRONMENT_ID: 'env-2' }), a);
  assert.equal(telemetryId(tmpFile(), { CROSSTALK_TELEMETRY_ID: 'my-hub' }), telemetryId(tmpFile(), { CROSSTALK_TELEMETRY_ID: 'my-hub' }));
  assert.notEqual(telemetryId(tmpFile(), {}), telemetryId(tmpFile(), {}), 'otherwise each install is random');
});

test('the id is stable across runs and failures never throw', async () => {
  const file = tmpFile();
  assert.equal(telemetryId(file, {}), telemetryId(file, {}));
  assert.equal(await checkIn('http://127.0.0.1:9/nothing-listens-here', telemetryId(file)), false);
  // Without a configured endpoint, nothing is sent and the log says so.
  const lines: string[] = [];
  startTelemetry({ enabled: true, url: '', idFile: file, log: l => lines.push(l) })();
  assert.match(lines[0], /no valid endpoint/);
});

test('agents check in once a day from their own machine, and respect the opt-outs', async () => {
  const http = await import('node:http');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { agentCheckIn } = await import('../src/server/telemetry.js');
  const got: any[] = [];
  const server = http.createServer((req, res) => { let b = ''; req.on('data', d => (b += d)); req.on('end', () => { got.push(JSON.parse(b)); res.statusCode = 204; res.end(); }); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/ping`;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-agent-ci-'));
  try {
    const day = Date.UTC(2026, 10, 6, 12);
    assert.equal(await agentCheckIn({ home, now: day, env: {}, url }), true);
    assert.equal(await agentCheckIn({ home, now: day + 3600_000, env: {}, url }), false, 'once a day');
    assert.equal(await agentCheckIn({ home, now: day + 86400_000, env: {}, url }), true, 'again the next day');
    assert.equal(await agentCheckIn({ home: fs.mkdtempSync(path.join(os.tmpdir(), 'xt-agent-ci-')), now: day, env: { CROSSTALK_TELEMETRY: '0' }, url }), false);
    assert.equal(await agentCheckIn({ home: fs.mkdtempSync(path.join(os.tmpdir(), 'xt-agent-ci-')), now: day, env: { GITHUB_ACTIONS: 'true' }, url }), false);
    assert.equal(got.length, 2);
    assert.equal(got[0].kind, 'agent');
    assert.match(got[0].id, /^[0-9a-f]{32}$/);
    assert.equal(got[0].id, got[1].id, 'same machine, same id');
  } finally {
    server.close();
  }
});

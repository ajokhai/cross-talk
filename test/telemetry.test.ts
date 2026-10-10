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

test('telemetry is off unless explicitly enabled, and the env can veto the flag', () => {
  const saved = process.env.CROSSTALK_TELEMETRY;
  try {
    delete process.env.CROSSTALK_TELEMETRY;
    assert.equal(telemetryEnabled(), false);
    assert.equal(telemetryEnabled(true), true);
    process.env.CROSSTALK_TELEMETRY = '1';
    assert.equal(telemetryEnabled(), true);
    process.env.CROSSTALK_TELEMETRY = '0';
    assert.equal(telemetryEnabled(true), false);
  } finally {
    if (saved === undefined) delete process.env.CROSSTALK_TELEMETRY;
    else process.env.CROSSTALK_TELEMETRY = saved;
  }
});

test('disabled telemetry sends nothing', async () => {
  const c = await collector();
  const saved = process.env.CROSSTALK_TELEMETRY;
  delete process.env.CROSSTALK_TELEMETRY;
  try {
    const stop = startTelemetry({ url: c.url, idFile: tmpFile() });
    await new Promise(r => setTimeout(r, 200));
    stop();
    assert.equal(c.bodies.length, 0);
  } finally {
    if (saved !== undefined) process.env.CROSSTALK_TELEMETRY = saved;
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

test('the id is stable across runs and failures never throw', async () => {
  const file = tmpFile();
  assert.equal(telemetryId(file), telemetryId(file));
  assert.equal(await checkIn('http://127.0.0.1:9/nothing-listens-here', telemetryId(file)), false);
  // Without a configured endpoint, opting in sends nothing and says so.
  const lines: string[] = [];
  startTelemetry({ enabled: true, url: '', idFile: file, log: l => lines.push(l) })();
  assert.match(lines[0], /no valid endpoint/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { WELCOME_TEXT, welcomeOnce, describeHub } from '../src/client/welcome.js';
import { DEFAULT_URL, LOCAL_URL } from '../src/client/sdk.js';

test('the welcome explains online, on-device and business hubs, and shows once per machine', () => {
  for (const s of ['Online (default)', 'On this device', '--local', 'For teams and', 'contact@ajokhai.com', DEFAULT_URL]) assert.ok(WELCOME_TEXT.includes(s), s);
  const saved = { home: process.env.CROSSTALK_HOME, off: process.env.CROSSTALK_NO_WELCOME };
  process.env.CROSSTALK_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-welcome-'));
  delete process.env.CROSSTALK_NO_WELCOME;
  try {
    const shown: string[] = [];
    assert.equal(welcomeOnce(t => shown.push(t)), true);
    assert.equal(welcomeOnce(t => shown.push(t)), false, 'only the first time');
    assert.equal(shown.length, 1);
  } finally {
    for (const [k, v] of [['CROSSTALK_HOME', saved.home], ['CROSSTALK_NO_WELCOME', saved.off]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('every new/join says where the channel lives', () => {
  assert.match(describeHub(DEFAULT_URL), /CrossTalk internet hub.*add --local/);
  assert.match(describeHub(LOCAL_URL), /on this device.*only agents on this machine/);
  assert.match(describeHub('wss://hub.example.com'), /on the hub at wss:\/\/hub\.example\.com/);
});

test('--local and --url together are refused', async () => {
  const tsx = import.meta.resolve('tsx');
  const out = await new Promise<{ code: number; err: string }>(resolve =>
    execFile(process.execPath, ['--import', tsx, path.resolve('src/client/cli.ts'), 'new', 'x', '--local', '--url', 'ws://example.com'], { env: { ...process.env, CROSSTALK_NO_WELCOME: '1', NO_COLOR: '1' } },
      (e, _o, err) => resolve({ code: e ? (e.code as number) : 0, err })));
  assert.equal(out.code, 1);
  assert.match(out.err, /either --local or --url/);
});

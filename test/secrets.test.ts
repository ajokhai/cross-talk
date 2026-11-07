import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { Redactor, addSecret, listSecrets, openSealed, removeSecret, runWithSecrets, sealIdentity, sealSecret } from '../src/client/secrets.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xt-secrets-'));
const collect = () => {
  const s = new PassThrough();
  let out = '';
  s.on('data', d => { out += d; });
  return { s, text: () => out };
};

test('secrets are stored encrypted, listed by name only, and removable', () => {
  const dir = tmp();
  addSecret('github_token', 'ghp_supersecretvalue123\n', { dir, from: 'typed' });
  const raw = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  assert.ok(!raw.includes('ghp_supersecretvalue123'), 'never stored in the clear');
  assert.equal((fs.statSync(path.join(dir, 'secrets.json')).mode & 0o777), 0o600);
  assert.deepEqual(listSecrets(dir).map(s => s.name), ['GITHUB_TOKEN']);
  assert.ok(!JSON.stringify(listSecrets(dir)).includes('ghp_'), 'listing shows no values');
  assert.throws(() => addSecret('bad name!', 'x', { dir }));
  assert.equal(removeSecret('GITHUB_TOKEN', dir), true);
  assert.equal(listSecrets(dir).length, 0);
});

test('run puts the secret in the environment and blanks it out of the output', async () => {
  const dir = tmp();
  addSecret('API_KEY', 'sk-live-abcdef0123456789', { dir });
  const out = collect();
  const err = collect();
  const code = await runWithSecrets(['API_KEY'], process.execPath, ['-e', 'console.log("key is " + process.env.API_KEY); console.error(process.env.API_KEY.length)'], { dir, stdout: out.s, stderr: err.s });
  assert.equal(code, 0);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(out.text().trim(), 'key is [secret API_KEY]');
  assert.equal(err.text().trim(), '24', 'the command really had the value');
});

test('a secret limited to some agents refuses others', async () => {
  const dir = tmp();
  addSecret('DEPLOY_TOKEN', 'tok_0123456789', { dir, agents: ['deployer'] });
  await assert.rejects(runWithSecrets(['DEPLOY_TOKEN'], process.execPath, ['-e', ''], { dir, agent: 'random' }), /only for deployer/);
  assert.equal(await runWithSecrets(['DEPLOY_TOKEN'], process.execPath, ['-e', ''], { dir, agent: 'Deployer' }), 0);
});

test('the redactor catches a value split across chunks', async () => {
  const r = new Redactor(new Map([['K', 'abcdefghij']]));
  const out = collect();
  r.pipe(out.s);
  for (const part of ['xx abc', 'defg', 'hij yy abcdefghij']) r.write(part);
  r.end();
  await new Promise(res => r.on('end', res));
  assert.equal(out.text(), 'xx [secret K] yy [secret K]');
});

test('a sealed secret opens only on the machine it was sealed to', () => {
  const alice = tmp();
  const bob = tmp();
  const bobKey = sealIdentity(bob).publicKey;
  assert.match(bobKey, /^xs_/);
  assert.equal(sealIdentity(bob).publicKey, bobKey, 'stable across runs');
  const sealed = sealSecret(bobKey, 'OPENAI_API_KEY', 'sk-proj-123');
  assert.ok(!sealed.includes('sk-proj'));
  assert.equal(openSealed(sealed, 'OPENAI_API_KEY', bob), 'sk-proj-123');
  assert.throws(() => openSealed(sealed, 'OPENAI_API_KEY', alice), 'someone else cannot open it');
  assert.throws(() => openSealed(sealed, 'OTHER_NAME', bob), 'renaming it breaks the seal');
});

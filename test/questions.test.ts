import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server/index.js';
import { CrossTalk, CrossTalkError } from '../src/client/sdk.js';
import { loadOwnedChannels, saveOwnedChannel, forgetOwnedChannels, sameHub } from '../src/client/keys.js';
import type { UserQuestion } from '../src/protocol.js';

async function trio(fn: (owner: CrossTalk, asker: CrossTalk, other: CrossTalk) => Promise<void>) {
  const server = await startServer({ port: 0, quiet: true });
  const connect = (name: string) => CrossTalk.connect({ name, url: server.url, reconnect: false });
  const [owner, asker, other] = await Promise.all([connect('owner'), connect('asker'), connect('other')]);
  try {
    await fn(owner, asker, other);
  } finally {
    await Promise.all([owner.close(), asker.close(), other.close()]);
    await server.close();
  }
}

const isCode = (code: string) => (err: CrossTalkError) => {
  assert.equal(err.code, code);
  return true;
};

test('an agent asks, the owner answers with the key, and the asker gets the answer', async () => {
  await trio(async (owner, asker, other) => {
    const ch = await owner.createChannel('work');
    assert.match(ch.ownerKey ?? '', /^xk_/);
    const askerCh = await asker.joinChannel(ch.address);
    await other.joinChannel(ch.address);

    const seen = new Promise<UserQuestion>(resolve => ch.once('question.asked', resolve));
    const pending = askerCh.ask('Drop the legacy table?', { options: ['yes', 'no'], timeoutMs: 5000 });
    const q = await seen;
    assert.deepEqual(q.options, ['yes', 'no']);
    assert.equal(ch.questions.size, 1);

    const answered = await ch.answer(q.id, 'no, keep it');
    assert.equal(answered.status, 'answered');
    const outcome = await pending;
    assert.equal(outcome.status, 'answered');
    assert.equal(outcome.answer, 'no, keep it');
    assert.equal(ch.questions.size, 0);
  });
});

test('only the owner key answers or changes settings; other members cannot', async () => {
  await trio(async (owner, asker, other) => {
    const ch = await owner.createChannel('work');
    const askerCh = await asker.joinChannel(ch.address);
    const otherCh = await other.joinChannel(ch.address);
    const q = await asker.request('question.ask', { channel: ch.address, question: 'Push to prod?' });

    await assert.rejects(otherCh.answer(q.id, 'yes', 'xk_guess'), isCode('forbidden'));
    await assert.rejects(otherCh.answer(q.id, 'yes'), isCode('forbidden'));
    await assert.rejects(askerCh.setQuestions('off', 'xk_guess'), isCode('forbidden'));
    // Holding the key from outside the channel isn't enough either: you must be a member.
    await ch.leave();
    await assert.rejects(owner.request('question.answer', { channel: ch.address, question: q.id, answer: 'yes', ownerKey: ch.ownerKey! }), isCode('not_member'));
    assert.equal(askerCh.questions.size, 1, 'still open');
  });
});

test('with questions off, asking comes straight back unattended, and waiting agents are released', async () => {
  await trio(async (owner, asker) => {
    const ch = await owner.createChannel('work');
    const askerCh = await asker.joinChannel(ch.address);

    const waiting = askerCh.ask('Rename the package?', { timeoutMs: 5000 });
    await new Promise(r => setTimeout(r, 50));
    const updated = new Promise(resolve => askerCh.once('updated', resolve));
    await ch.setQuestions('off');
    assert.equal((await waiting).status, 'unattended');
    await updated;
    assert.equal(askerCh.info.questions, 'off');

    const now = await askerCh.ask('And this?', { timeoutMs: 5000 });
    assert.equal(now.status, 'unattended');
    assert.equal(ch.questions.size, 0, 'nothing is queued while off');

    await ch.setQuestions('on');
    const later = await askerCh.ask('Back on?', { timeoutMs: 50 });
    assert.equal(later.status, 'open', 'times out still open, to be answered later');
  });
});

test('questions close when the asker leaves, and each agent has a cap on open questions', async () => {
  await trio(async (owner, asker) => {
    const ch = await owner.createChannel('work');
    const askerCh = await asker.joinChannel(ch.address);
    for (let i = 0; i < 5; i++) await asker.request('question.ask', { channel: ch.address, question: `q${i}` });
    await assert.rejects(asker.request('question.ask', { channel: ch.address, question: 'one too many' }), isCode('quota_exceeded'));

    const cancelled = new Promise<UserQuestion>(resolve => ch.once('question.closed', resolve));
    await askerCh.leave();
    assert.equal((await cancelled).status, 'cancelled');
    await new Promise(r => setTimeout(r, 50));
    assert.equal(ch.questions.size, 0);
  });
});

test('a waiting ask stops as soon as its signal aborts (the user pressed Esc)', async () => {
  await trio(async (owner, asker) => {
    const ch = await owner.createChannel('work');
    const askerCh = await asker.joinChannel(ch.address);
    const abort = new AbortController();
    const started = Date.now();
    const pending = askerCh.ask('Long one?', { timeoutMs: 10_000, signal: abort.signal });
    setTimeout(() => abort.abort(), 50);
    const q = await pending;
    assert.equal(q.status, 'open');
    assert.ok(Date.now() - started < 2000);
  });
});

test('owner keys are stored privately and matched to their hub', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xt-keys-')), 'owner-keys.json');
  saveOwnedChannel({ address: 'xt_AAAAAAAAAAAAAAAAAAAAAA', name: 'a', url: 'ws://localhost:4488', key: 'xk_1' }, file);
  saveOwnedChannel({ address: 'xt_BBBBBBBBBBBBBBBBBBBBBB', name: 'b', url: 'wss://hub.example.com', key: 'xk_2' }, file);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(loadOwnedChannels(file).length, 2);
  assert.ok(sameHub('ws://localhost:4488', 'http://127.0.0.1:4488/'));
  assert.ok(sameHub('wss://hub.example.com', 'https://hub.example.com:443'));
  assert.ok(!sameHub('wss://hub.example.com', 'ws://127.0.0.1:4488'));
  forgetOwnedChannels(['xt_AAAAAAAAAAAAAAAAAAAAAA'], file);
  assert.deepEqual(loadOwnedChannels(file).map(c => c.name), ['b']);
});

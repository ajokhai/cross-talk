import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';
import { startModelAgent, openAIGenerator, execGenerator, cleanReply, type ChatTurn } from '../src/client/llm.js';
import type { ChannelMessage, DirectMessage } from '../src/protocol.js';

/** A stand-in for llama-server / Ollama: records requests, answers with a fixed reply. */
async function fakeModel(reply: (turns: ChatTurn[]) => string) {
  const requests: any[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push({ url: req.url, auth: req.headers.authorization, body: parsed });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply(parsed.messages) } }] }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests, close: () => new Promise(r => server.close(r)) };
}

const nextMessage = (ch: { once: (e: string, f: (m: any) => void) => void }) => new Promise<ChannelMessage>(r => ch.once('message', r));

test('a model behind an OpenAI-compatible endpoint answers @mentions and DMs, not other chatter', async () => {
  const hub = await startServer({ port: 0, quiet: true });
  const model = await fakeModel(turns => `<think>hmm</think>echo: ${turns.at(-1)!.content}`);
  const human = await CrossTalk.connect({ name: 'josh', url: hub.url, reconnect: false });
  try {
    const ch = await human.createChannel('phone-test');
    const agent = await startModelAgent({
      channel: ch.address, name: 'phone', url: hub.url, reconnect: false,
      generate: openAIGenerator({ baseUrl: model.url, model: 'qwen2.5-0.5b', apiKey: 'k' })
    });
    await new Promise(r => setTimeout(r, 50));

    await ch.send('just chatting, nobody asked the model');
    const reply = nextMessage(ch);
    await ch.send('@phone what is 2+2?');
    const m = await reply;
    assert.equal(m.from.name, 'phone');
    assert.equal(m.content, 'echo: josh: @phone what is 2+2?', 'reasoning block stripped');
    assert.equal(model.requests.length, 1, 'only the mention reached the model');
    assert.equal(model.requests[0].url, '/v1/chat/completions');
    assert.equal(model.requests[0].auth, 'Bearer k');
    assert.equal(model.requests[0].body.model, 'qwen2.5-0.5b');
    const turns: ChatTurn[] = model.requests[0].body.messages;
    assert.equal(turns[0].role, 'system');
    assert.ok(turns.some(t => t.content === 'josh: just chatting, nobody asked the model'), 'recent chatter is context');

    const dm = new Promise<DirectMessage>(r => human.once('dm', r));
    await human.dm('phone', 'are you offline?');
    assert.equal((await dm).content, 'echo: josh: are you offline?');
    assert.equal(agent.channel.members.get(agent.client.agent.id)?.role, 'model');
    await agent.stop();
  } finally {
    await human.close();
    await model.close();
    await hub.close();
  }
});

test('any command can be the model: prompt on stdin, reply on stdout', async () => {
  const hub = await startServer({ port: 0, quiet: true });
  const human = await CrossTalk.connect({ name: 'josh', url: hub.url, reconnect: false });
  try {
    const ch = await human.createChannel('exec-test');
    // A "model" that answers with how many lines of prompt it was given.
    const cmd = `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('lines='+s.trim().split(/\\\\n/).length))"`;
    const agent = await startModelAgent({ channel: ch.address, name: 'pi', url: hub.url, reconnect: false, generate: execGenerator(cmd) });
    const reply = nextMessage(ch);
    await ch.send('hey @pi, count');
    assert.match((await reply).content, /^lines=\d+$/);
    await agent.stop();
  } finally {
    await human.close();
    await hub.close();
  }
});

test('two models in "all" mode do not talk each other into a loop', async () => {
  const hub = await startServer({ port: 0, quiet: true });
  const human = await CrossTalk.connect({ name: 'josh', url: hub.url, reconnect: false });
  let calls = 0;
  const generate = async () => { calls++; return 'ok'; };
  try {
    const ch = await human.createChannel('loop-test');
    const a = await startModelAgent({ channel: ch.address, name: 'a', url: hub.url, reconnect: false, generate, reply: 'all' });
    const b = await startModelAgent({ channel: ch.address, name: 'b', url: hub.url, reconnect: false, generate, reply: 'all' });
    await new Promise(r => setTimeout(r, 50));
    await ch.send('hello models');
    await new Promise(r => setTimeout(r, 400));
    assert.equal(calls, 2, 'each model answered the person once and ignored the other model');
    await a.stop();
    await b.stop();
  } finally {
    await human.close();
    await hub.close();
  }
});

test('replies are cleaned and capped', () => {
  assert.equal(cleanReply('<think>long\nreasoning</think>\n Assistant: Hi there ', 100), 'Hi there');
  assert.equal(cleanReply('x'.repeat(50), 10).length, 10);
});

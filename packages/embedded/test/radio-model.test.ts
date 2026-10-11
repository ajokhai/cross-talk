import test from 'node:test';
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { startServer, CrossTalk, startModelAgent, type ChannelMessage, type DirectMessage } from 'cross-talk';
import { DeviceBridge } from '../src/bridge.js';
import { ReliableLink } from '../src/transport/reliable.js';
import { deviceModelLink } from '../src/device-link.js';

/** A noisy radio between the bridge's module and the model's module. */
function radio(drop: number, corrupt: number) {
  let seed = 99;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const ends: Duplex[] = [];
  const make = (i: number) => new Duplex({
    read() {},
    write(chunk: Buffer, _e, cb) {
      cb();
      if (rand() < drop) return;
      const bytes = Buffer.from(chunk);
      if (rand() < corrupt) bytes[Math.floor(rand() * bytes.length)] ^= 0x10;
      setTimeout(() => ends[1 - i].push(bytes), 2);
    }
  });
  ends.push(make(0), make(1));
  return ends;
}

test('a model on the far side of a lossy radio link answers in the channel and by DM', async () => {
  const hub = await startServer({ port: 0, quiet: true });
  const person = await CrossTalk.connect({ name: 'josh', url: hub.url, reconnect: false });
  const [hubSide, modelSide] = radio(0.2, 0.1);
  const settings = { mtu: 32, ackTimeoutMs: 40, retries: 40 };
  try {
    const ch = await person.createChannel('field');

    // Model end (e.g. an old laptop with a LoRa module): starts first and registers its name.
    const modelLink = new ReliableLink(modelSide, settings);
    const agent = await startModelAgent({
      channel: '', name: 'radio-model', generate: async turns => `heard you: ${turns.at(-1)!.content}`,
      link: deviceModelLink(modelLink, { name: 'radio-model' })
    });

    // Hub end: the bridge holding the other module.
    const bridge = new DeviceBridge({
      transport: new ReliableLink(hubSide, settings), channel: ch.address, name: 'fallback-name',
      hub: { url: hub.url }, role: 'model', maxPayloadBytes: 2000, registerWindowMs: 3000
    });
    await bridge.start();
    await new Promise(r => setTimeout(r, 100));
    const member = [...ch.members.values()].find(m => m.name === 'radio-model');
    assert.ok(member, 'joined under the name it registered over the radio');
    assert.equal(member!.role, 'model');

    const reply = new Promise<ChannelMessage>(r => ch.on('message', m => m.from.name === 'radio-model' && r(m)));
    const long = '@radio-model ' + 'please summarise the deployment plan for the greenhouse sensors. '.repeat(3);
    await ch.send(long);
    const m = await reply;
    assert.equal(m.content, `heard you: josh: ${long.trim()}`, 'long message crossed the radio whole, both ways');

    const dm = new Promise<DirectMessage>(r => person.on('dm', d => d.from.name === 'radio-model' && r(d)));
    await person.dm('radio-model', 'battery level?');
    assert.equal((await dm).content, 'heard you: josh: battery level?');

    await agent.stop();
    await bridge.stop();
  } finally {
    await person.close();
    await hub.close();
  }
});

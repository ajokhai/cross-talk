# @cross-talk/gibberlink

Gibberlink 16-FSK signal packets carried over ordinary CrossTalk channel messages. The hub doesn't know about Gibberlink. A signal is a normal message: the readable text goes in `content` and the packet goes in `metadata.gibberlink`.

```ts
import { CrossTalk } from 'cross-talk';
import { sendSignal, decodeSignal } from '@cross-talk/gibberlink';

const ct = await CrossTalk.connect({ name: 'Claude' });
const ch = await ct.joinChannel('build');
await sendSignal(ch, { op: 'LCK', file: 'src/auth.ts' }, 'ultrasonic');

ch.on('message', (msg) => {
  const signal = decodeSignal(msg); // null for ordinary messages
  if (signal?.valid) console.log(signal.data ?? signal.text);
});
```

`GibberlinkEngine` is exported too, for encoding, decoding and synthesizing raw PCM (`synthesizePcm`) without a channel. Modes: `audible_fast` (default), `audible_standard`, `ultrasonic`.

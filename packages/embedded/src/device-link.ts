import type { ModelLink, IncomingText } from 'cross-talk';
import { BinaryCodec, BinaryOpcode } from './binary.js';
import { fitUtf8, splitAttributed } from './bridge.js';
import type { ICrossTalkTransport } from './transport/interface.js';

/**
 * The device side of the bridge, for a model: lets `startModelAgent` (and
 * `crosstalk llm --serial`) take part in a channel over any byte link that a
 * `crosstalk-bridge` sits on the other end of: a radio module, a USB or
 * Bluetooth serial port, a TCP socket.
 *
 * Use a `ReliableLink` as the transport on lossy links (radios), and the same
 * `--reliable` settings on the bridge.
 */
export function deviceModelLink(transport: ICrossTalkTransport, options: { name: string; channelName?: string }): ModelLink {
  const onMessage: Array<(m: IncomingText) => void> = [];
  const onDirect: Array<(m: IncomingText & { replyExpected: boolean }) => void> = [];

  const send = (opcode: BinaryOpcode, payload: Buffer) =>
    transport.send(BinaryCodec.encode({ opcode, flags: {}, timestamp: Date.now(), payload }));

  transport.on('message', data => {
    const frame = BinaryCodec.decode(Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'));
    if (!frame || frame.flags.isResponse || !frame.raw) return;
    if (frame.opcode !== BinaryOpcode.BROADCAST && frame.opcode !== BinaryOpcode.DIRECT_MSG) return;
    const split = splitAttributed(frame.raw);
    if (!split || !split.text) return;
    // The bridge attributes by name; names are how this side addresses people too.
    const m = { from: split.name, fromId: split.name, text: split.text, fromModel: false };
    if (frame.opcode === BinaryOpcode.BROADCAST) for (const cb of onMessage) cb(m);
    else for (const cb of onDirect) cb({ ...m, replyExpected: true });
  });

  // Ask the bridge to join under our name (it accepts a REGISTER within its start-up window).
  send(BinaryOpcode.REGISTER, fitUtf8(options.name, 32));

  return {
    channelName: options.channelName ?? 'channel',
    history: [],
    onMessage: cb => void onMessage.push(cb),
    onDirect: cb => void onDirect.push(cb),
    send: async text => send(BinaryOpcode.BROADCAST, Buffer.from(text, 'utf8')),
    dm: async (to, text) => {
      const who = fitUtf8(to, 255);
      send(BinaryOpcode.DIRECT_MSG, Buffer.concat([Buffer.from([who.length]), who, Buffer.from(text, 'utf8')]));
    },
    // The bridge shows a heartbeat's text as the member's current task.
    status: async (_state, task) => send(BinaryOpcode.HEARTBEAT, fitUtf8(task, 100)),
    close: async () => transport.close()
  };
}

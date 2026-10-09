/**
 * A microcontroller talking CrossTalk over a raw byte stream (UART, Bluetooth
 * SPP, USB serial). A PassThrough pipe stands in for the serial port.
 *
 * The device packs XDialect shorthand into a few bytes (DialectEngine.packToBits),
 * wraps it in a binary frame (BinaryCodec), and the stream transport length-
 * prefixes it, the same framing firmware/crosstalk_micro.h writes.
 *
 *   npx tsx packages/embedded/examples/micro_stream_demo.ts
 */
import { PassThrough } from 'node:stream';
import { DialectEngine } from 'cross-talk';
import { BinaryCodec, BinaryOpcode, StreamFramer, StreamTransport } from '../src/index.js';

const serial = new PassThrough();
const host = new StreamTransport(serial);

host.on('message', (packet: Buffer | string) => {
  const raw = Buffer.isBuffer(packet) ? packet : Buffer.from(packet);
  const frame = BinaryCodec.decode(raw);
  if (!frame) {
    console.log('host: dropped a malformed frame');
    return;
  }
  console.log(`host: ${raw.length}-byte frame, opcode ${BinaryOpcode[frame.opcode]}`);

  // frame.raw holds the exact payload bytes the device packed.
  const unpacked = DialectEngine.unpackFromBits(frame.raw!);
  console.log(`host: shorthand  ${unpacked.shorthand}`);
  console.log(`host: in English ${unpacked.human}`);
  process.exit(0);
});

// --- the device side --------------------------------------------------------
const shorthand = '!LCK @src/firmware.c #FEAT "sensor calibration" ~60 &WAIT';
const bits = DialectEngine.packToBits(shorthand);
const frame = BinaryCodec.encode({
  opcode: BinaryOpcode.LOCK_ACQUIRE,
  flags: { ackRequested: true },
  timestamp: Date.now(),
  payload: bits
});

console.log(`device: "${shorthand}" (${Buffer.byteLength(shorthand)} bytes as text)`);
console.log(`device: packed to ${bits.length} bytes, ${frame.length + 2} bytes on the wire`);
serial.write(StreamFramer.frame(frame));

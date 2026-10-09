import { PassThrough } from 'node:stream';
import { StreamTransport } from '../src/transport/stream.js';
import { BinaryCodec, BinaryOpcode } from '../src/server/binary.js';
import { DialectEngine } from '../src/dialect/engine.js';
import { green, cyan, yellow, bold } from 'colorette';

async function main() {
  console.log(bold(cyan('========================================================')));
  console.log(bold(cyan('⚡ Microcontroller Serial/Bluetooth Stream Demo (CrossTalk)')));
  console.log(bold(cyan('========================================================\n')));

  // Simulated serial duplex pipe (such as /dev/tty.Bluetooth-ESP32 or UART)
  const deviceToHost = new PassThrough();
  const hostToDevice = new PassThrough();

  // Create stream transport on the host side
  const transport = new StreamTransport(deviceToHost);

  console.log(cyan('📡 Host listening on simulated Serial/Bluetooth stream...'));

  transport.on('message', (packet: Buffer) => {
    console.log(green(`\n✔ [Host] Received raw binary frame from Microcontroller (${packet.length} bytes)!`));
    console.log(`  Raw Hex: ${yellow(packet.toString('hex'))}`);

    // Decode binary header
    const decoded = BinaryCodec.decode(packet);
    if (decoded) {
      console.log(`  Opcode: 0x0${decoded.opcode.toString(16)} (LOCK_ACQUIRE)`);
      if (Buffer.isBuffer(decoded.payload)) {
        const unpacked = DialectEngine.unpackFromBits(decoded.payload);
        console.log(`  XDialect Shorthand: ${bold(cyan(unpacked.shorthand))}`);
        console.log(`  Human Expansion:   "${unpacked.human}"`);
      }
    }
  });

  // Simulated Microcontroller (e.g. ESP32 / Arduino running crosstalk_micro.h)
  console.log(yellow('\n🤖 [ESP32 Microcontroller] Packing lock claim into tiny 34-byte buffer...'));
  
  // The MCU generates a 34-byte packet
  const mcuPayload = DialectEngine.packToBits('!LCK @src/firmware.c #FEAT "sensor calibration" ~60 &WAIT');
  const mcuFrame = BinaryCodec.encode({
    opcode: BinaryOpcode.LOCK_ACQUIRE,
    flags: {},
    timestamp: Date.now(),
    payload: mcuPayload.toString('utf8')
  });

  // Write length-prefixed packet into the serial pipe (exactly like CrossTalkMicro::sendPacket)
  const lenPrefix = Buffer.alloc(2);
  lenPrefix.writeUInt16BE(mcuFrame.length, 0);
  
  console.log(`📦 [ESP32 Microcontroller] Transmitting over Bluetooth Serial (${mcuFrame.length + 2} total bytes)...`);
  deviceToHost.write(Buffer.concat([lenPrefix, mcuFrame]));

  setTimeout(() => {
    console.log(green('\n🏁 Microcontroller stream test complete! Fits easily in any MCU RAM.'));
    process.exit(0);
  }, 1000);
}

main().catch(console.error);

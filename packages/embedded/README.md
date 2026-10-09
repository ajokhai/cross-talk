# @cross-talk/embedded

CrossTalk for microcontrollers and other devices too small to run an agent or a WebSocket client. A device sends compact binary frames over serial, UART or BLE to a host computer:

```
device ──serial / BLE──▶ host (StreamTransport + BinaryCodec) ──▶ hub
```

> **Status:** a device can't join a CrossTalk channel yet. The v2 hub accepts only JSON, so a host has to translate between binary frames and channel messages. That host bridge is being built. Until it ships, this package gives you the frame format, the host-side codec and transports, and firmware for device-to-host links that you wire up yourself.

## Contents

| Path | What it is |
| :-- | :-- |
| `src/binary.ts` | `BinaryCodec` and `BinaryOpcode`: encode and decode frames on the host. |
| `src/transport/` | `StreamFramer` (u16 length-prefix framing), `StreamTransport` for any Node `Duplex` (serial port, UART, Bluetooth SPP, stdio), and `UnixSocketTransport` for local IPC. |
| `firmware/crosstalk_micro.h` | Header-only C/C++ client (`CrossTalkMicro::sendPacket` and friends). Unit tests in `firmware/test_micro.c`. |
| `firmware/crosstalk_micro.py` | MicroPython client. |
| `firmware/arduino_esp32_crosstalk.ino` | Arduino / ESP32 sketch. |
| `firmware/assembly/` | Bare-metal AVR, ARM Thumb-2 and WebAssembly frame-header validators. See its README. |

## Frame format

Every frame has a 10-byte header followed by the payload. Multi-byte fields are big-endian.

| Offset | Size | Field |
| --: | --: | :-- |
| 0 | 1 | Magic `0x58` (`'X'`) |
| 1 | 1 | Version `0x01` |
| 2 | 1 | Opcode |
| 3 | 1 | Flags: bit 0 `ackRequested`, bit 1 `isResponse`, bit 2 `conflictAlert` |
| 4 | 4 | Timestamp, Unix seconds (u32) |
| 8 | 2 | Payload length (u16) |
| 10 | n | Payload |

On a byte stream (serial or BLE), each frame is preceded by its length as a u16 BE. `StreamFramer` on the host and `sendPacket` in the C header handle this for you. The C header caps a whole frame at 128 bytes (`XT_MAX_PACKET_SIZE`).

**Opcodes:** `0x00` heartbeat, `0x01` register, `0x02` broadcast, `0x03` direct message, `0x04` lock acquire, `0x05` lock ack, `0x06` lock denied, `0x07` lock release, `0x08` state query, `0x09` gibberlink carrier.

**Lock payloads** use the packed XDialect layout from `DialectEngine.packToBits`:

```
[action][intent][flow bits][ttl u16][target len][target][reason len][reason]
```

The target and reason are each at most 255 bytes, and the whole frame has to fit the device's packet limit.

## Host usage

```ts
import { StreamTransport, BinaryCodec, BinaryOpcode } from '@cross-talk/embedded';
import { DialectEngine } from 'cross-talk';

const link = new StreamTransport(serialPort);          // any Node Duplex

link.on('message', (packet) => {
  const frame = BinaryCodec.decode(packet as Buffer);  // null if malformed or partial
  if (!frame) return;
  if (frame.opcode === BinaryOpcode.LOCK_ACQUIRE) {
    console.log(DialectEngine.unpackFromBits(frame.raw!));  // raw = the exact payload bytes
  } else {
    console.log(frame.opcode, frame.payload);
  }
});

link.send(BinaryCodec.encode({
  opcode: BinaryOpcode.BROADCAST,
  flags: {},
  timestamp: Date.now(),                               // ms; sent on the wire as u32 seconds
  payload: 'hello'                                     // Buffer as-is, string as UTF-8, object as JSON
}));
```

## What's been verified

| Target | How |
| :-- | :-- |
| C header | Unit tests are clean under ASan and UBSan, compiled as both C and C++. |
| MicroPython | Run under CPython against the Node codec. |
| Arduino sketch | Framing logic compiled against a stub `Serial`. **Not yet run on real hardware.** |
| Thumb-2, WASM | Run in an emulator (Unicorn) and from Node (wabt), each matching the C decoder on 2,050 frames. See `firmware/assembly/README.md`. |
| AVR | Reviewed by hand only; no AVR toolchain was available. |

The C, MicroPython and Node implementations are tested against each other, so a frame encoded by any one of them decodes the same way in the others.

## Testing

```sh
npm test -w packages/embedded                 # 6 cross-language checks (C, MicroPython, Node)
cd packages/embedded
cc -I firmware firmware/test_micro.c -o t && ./t   # C unit tests
```

## Changelog

- **0.1.0:** Fixed frames from MicroPython, whose header was 2 bytes too long. The Arduino sketch now strips the length prefix, so it can decode host frames, and its read buffer can no longer overflow. Fixed a stack overflow in the C header when releasing a lock on a long filename. Fixed the host codec corrupting payload bytes of 0x80 and above.

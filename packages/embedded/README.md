# @cross-talk/embedded

CrossTalk for microcontrollers and other devices too small to run an agent or a WebSocket client. A device sends compact binary frames over serial, UART or BLE to a host computer:

```
device ──serial / BLE / TCP──▶ crosstalk-bridge (host) ──WebSocket──▶ hub ──▶ other agents
```

The bridge puts each device into a conversation as a regular agent. The device can post messages, DM other members, take and release file locks, and receive everything the channel sends back, all over a link as small as a UART.

## Contents

| Path | What it is |
| :-- | :-- |
| `src/bridge.ts` | `DeviceBridge`: puts one device link into a channel as one agent. Also ships as the `crosstalk-bridge` CLI. |
| `src/binary.ts` | `BinaryCodec` and `BinaryOpcode`: encode and decode frames on the host. |
| `src/transport/` | `StreamFramer` (u16 length-prefix framing), `StreamTransport` for any Node `Duplex` (serial port, UART, Bluetooth SPP, stdio), `ResyncingLink` (skips garbage bytes until the stream lines up on a frame again), and `UnixSocketTransport` for local IPC. |
| `firmware/crosstalk_micro.h` | Header-only C/C++ client (`CrossTalkMicro::sendPacket` and friends). Unit tests in `firmware/test_micro.c`. |
| `firmware/crosstalk_micro.py` | MicroPython client. |
| `firmware/arduino_esp32_crosstalk.ino` | Arduino / ESP32 sketch. |
| `firmware/assembly/` | Bare-metal AVR, ARM Thumb-2 and WebAssembly frame-header validators. See its README. |

## Bridge: put a device in a conversation

```sh
export CROSSTALK_AUTH_TOKEN=…            # if the hub requires one

# one device on a serial port
crosstalk-bridge --channel xt_Qm9r3vKx1pZ8aT2cL5nWdA --serial /dev/ttyUSB0 --baud 115200 --name thermostat

# many devices over TCP (e.g. ESP32s on Wi-Fi); each connection becomes thermostat-1, thermostat-2…
crosstalk-bridge --channel xt_… --tcp-listen 7000 --tcp-host 0.0.0.0 --max-devices 16 --name thermostat

# other links
crosstalk-bridge --channel xt_… --unix /tmp/device.sock
crosstalk-bridge --channel xt_… --stdio
```

| Flag | Meaning |
| :-- | :-- |
| `--channel <xt_…>` | The conversation to join (required). |
| `--serial <tty>` `[--baud 115200]` | Serial / UART / Bluetooth SPP device. |
| `--tcp-listen <port>` `[--tcp-host 127.0.0.1]` `[--max-devices 16]` | Accept devices over TCP. Each connection is a separate agent. |
| `--unix <path>` / `--stdio` | Unix socket or stdin/stdout. |
| `--name <name>` | Agent name if the device doesn't register itself (default `device`). |
| `--url <ws://…>` | Hub URL (default `$CROSSTALK_URL` or `ws://localhost:4488`). |
| `--max-frame <bytes>` | Largest frame the device can receive (default 128). |

The token is read from `CROSSTALK_AUTH_TOKEN`. `--token` works, but the bridge warns you because other users can see it in `ps`.

**Naming:** a device can send a `REGISTER` frame (UTF-8 name, up to 32 bytes) within 2 seconds of connecting, and the bridge joins under that name. Otherwise it uses `--name`, or `--name-N` for TCP connections.

### What the bridge relays

| Device → channel | Payload | Becomes |
| :-- | :-- | :-- |
| `0x01` REGISTER | UTF-8 name | The agent's name (optional, first frame only) |
| `0x00` HEARTBEAT | empty, or status text | The agent's status |
| `0x02` BROADCAST | UTF-8 text, or packed XDialect | A chat message, or a shorthand message |
| `0x03` DIRECT_MSG | `[to_len][to][text]` | A DM to a channel-mate (name or id) |
| `0x04` LOCK_ACQUIRE | packed `!LCK @file …` | A channel lock |
| `0x07` LOCK_RELEASE | packed `!REL @file` | A channel unlock |
| `0x08` STATE_QUERY | empty | A reply of `members=N locks=M` |

Replies come back with `isResponse` set: `REGISTER` carries the agent id, `LOCK_ACK` (`0x05`) confirms a lock or release, and `LOCK_DENIED` (`0x06`) carries `!WARN @file "held by <name>"`.

| Channel → device | Payload |
| :-- | :-- |
| `0x02` | `[from_len][from][text]`: a channel message |
| `0x03` | `[from_len][from][text]`: a DM to the device |
| `0x04` / `0x07` | packed `!LCK` / `!REL`: another agent took or released a lock |
| `0x04` + `conflictAlert` | packed `!WARN @file "<requester>"`: someone wants the device's lock |

### From code

```ts
import { DeviceBridge, StreamTransport } from '@cross-talk/embedded';

const bridge = new DeviceBridge({
  transport: new StreamTransport(serialPort),
  channel: 'xt_Qm9r3vKx1pZ8aT2cL5nWdA',
  name: 'thermostat',
  hub: { url: 'ws://localhost:4488' }
});
bridge.on('ready', (channel) => console.log('joined', channel.address));
await bridge.start();
```

Events: `ready` (the joined `Channel`), `frame` (each decoded device frame), `error` and `closed`. The full opcode profile is in the header comment of `src/bridge.ts`.

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

## Low-level host usage

To talk to a device yourself without the bridge:

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

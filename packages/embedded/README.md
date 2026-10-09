# @cross-talk/embedded

CrossTalk for constrained links and devices.

- `src/binary.ts`: `BinaryCodec`, the 10-byte-header binary frame format (`X` magic, opcode, flags, timestamp, length, payload).
- `src/transport/`: `StreamFramer` (uint16 length-prefix framing), `StreamTransport` for any Node `Duplex` (serial, UART, Bluetooth SPP, stdio), and `UnixSocketTransport` for local IPC.
- `firmware/`: device-side clients: a C header (`crosstalk_micro.h`, tested by `test_micro.c`), MicroPython (`crosstalk_micro.py`), an Arduino/ESP32 sketch, and bare-metal AVR, ARM Thumb-2 and WASM implementations in `firmware/assembly/`.

```ts
import { StreamTransport, BinaryCodec, BinaryOpcode } from '@cross-talk/embedded';

const link = new StreamTransport(serialPort);
link.on('message', (packet) => console.log(BinaryCodec.decode(packet as Buffer)));
link.send(BinaryCodec.encode({ opcode: BinaryOpcode.BROADCAST, flags: {}, timestamp: Date.now(), payload: 'hello' }));
```

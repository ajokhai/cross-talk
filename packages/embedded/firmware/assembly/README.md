# CrossTalk Micro: assembly header validators

Small hand-written routines that check a v1 CrossTalk binary frame header on
targets where you would rather not pull in C. They do the same checks as
`xt_decode_packet` in [`../crosstalk_micro.h`](../crosstalk_micro.h).

Frame layout (big-endian):

```
[0] 0x58 'X'  [1] version 0x01  [2] opcode  [3] flags
[4..7] timestamp u32  [8..9] payload_len u16  [10..] payload
```

These devices speak the v1 binary format. The v2 hub only accepts JSON, so
devices reach a conversation through the host bridge in `packages/embedded`.

| File | Targets | Checks | Code size | How it was verified |
| :--- | :--- | :--- | :--- | :--- |
| [`crosstalk_thumb.s`](crosstalk_thumb.s) | Cortex-M0/M0+/M3/M4/M7 (RP2040, STM32, nRF52) | NULL, length, magic, version, partial frame; extracts opcode and payload length | 74 bytes (`.text` of the `.o`) | Assembled for thumbv6m, thumbv7m and thumbv7em; run in the Unicorn emulator against the C decoder on 2,050 frames |
| [`crosstalk_wasm.wat`](crosstalk_wasm.wat) | Any WebAssembly runtime | length, magic, version, partial frame; opcode, payload length, XDialect prefix classifier | 265-byte module | Compiled with `wabt`; run from Node against the C decoder on the same 2,050 frames |
| [`crosstalk_avr.s`](crosstalk_avr.s) | ATmega328P, ATtiny85 (Arduino Uno/Nano) | magic and version only (first 2 bytes) | 26 bytes (counted by hand) | Reviewed by hand only; no AVR toolchain was available |

None of them allocate memory; the Thumb and AVR routines use registers only.
Timing depends on the core and memory, so no speed figures are claimed here
beyond the AVR cycle count in its header comment.

## ARM Cortex-M (`crosstalk_thumb.s`)

Uses only the Thumb-1 subset of ARMv6-M, so the same code runs on Cortex-M0.
Standard AAPCS calling convention.

```c
extern int xt_asm_validate_header(
    const uint8_t *buffer,
    uint32_t len,              /* bytes available in buffer */
    uint8_t *out_opcode,       /* may be NULL */
    uint16_t *out_payload_len  /* may be NULL; 2-byte aligned */
);
```

Returns the same codes as `xt_decode_packet`: `0` valid, `-1` NULL or shorter
than 10 bytes, `-2` bad magic or version, `-3` partial frame (outputs are
still written, so you know how many more bytes to read).

## WebAssembly (`crosstalk_wasm.wat`)

Exports `memory`, `validate_header(offset, len)`, `get_opcode(offset)`,
`get_payload_len(offset)` and `classify_prefix(charCode)`. Write the frame
into `memory` first. `validate_header` returns `0` valid, `-1` bad magic,
`-2` bad version, `-3` shorter than 10 bytes, `-4` partial frame. Keep
`offset + len` inside memory: out-of-range reads trap.

## AVR (`crosstalk_avr.s`)

`int xt_avr_check_magic(const uint8_t *buf)` returns 1 if the first two bytes
are `'X'` and version 1, else 0. It takes no length, so the caller must
guarantee `buf` is non-NULL and has at least 2 bytes in SRAM. Use
`xt_decode_packet` for full validation.

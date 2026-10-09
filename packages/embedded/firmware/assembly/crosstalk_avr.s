; ==============================================================================
; CrossTalk Micro - AVR 8-bit assembly magic/version check (ATmega328P / ATtiny / Arduino)
; ==============================================================================
; Checks only the first two bytes of a v1 CrossTalk binary frame
; ([0x58 'X'][version 0x01]...). It does NOT take a length and does not check
; the 10-byte header or payload length: use xt_decode_packet in
; ../crosstalk_micro.h for full validation.
;
; Caller contract:
;   - buf must be non-NULL and point at least 2 readable bytes in SRAM
;     (`ld` reads data space; a PROGMEM/flash buffer needs `lpm` instead).
;
; Cost, counted by hand from the AVR instruction set manual (not measured,
; no AVR toolchain was available): 13 instructions = 26 bytes of code;
; 15 cycles on the valid path plus the call (~19 cycles, ~1.2 us at 16 MHz).
; No SRAM or stack use beyond the return address.
; Registers used: r18, r24, r25, Z (r31:r30), all call-clobbered in the avr-gcc ABI.
;
; C Signature:
;   int xt_avr_check_magic(const uint8_t *buf);
;   Input:  r25:r24 = buf
;   Output: r25:r24 = 1 if byte 0 is 'X' and byte 1 is version 1, else 0
; ==============================================================================

.section .text
.global xt_avr_check_magic

xt_avr_check_magic:
    movw    r30, r24        ; Move buffer address to Z register pointer (r31:r30)
    ld      r18, Z+         ; Load byte 0 (Magic) and post-increment pointer
    cpi     r18, 0x58       ; Compare with 'X' (0x58)
    brne    .L_avr_fail

    ld      r18, Z          ; Load byte 1 (Version)
    cpi     r18, 0x01       ; Compare with 0x01
    brne    .L_avr_fail

    ldi     r24, 0x01       ; Return 1 (Valid)
    ldi     r25, 0x00
    ret

.L_avr_fail:
    ldi     r24, 0x00       ; Return 0 (Invalid)
    ldi     r25, 0x00
    ret

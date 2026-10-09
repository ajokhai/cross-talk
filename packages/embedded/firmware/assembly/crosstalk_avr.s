; ==============================================================================
; CrossTalk Micro - AVR 8-bit Assembly Routine (ATmega328P / ATTiny / Arduino)
; ==============================================================================
; Ultra-compact packet parser executing in ~20 clock cycles (~1.25 µs at 16MHz).
; Requires ZERO bytes of SRAM / heap. Uses registers r24, r25, r22, r23, r18.
;
; C Signature:
;   int xt_avr_check_magic(const uint8_t *buf);
;   Input:  r25:r24 (Pointer to packet buffer in SRAM)
;   Output: r24 = 1 if valid CrossTalk header ('X' and version 1), 0 if invalid
; ==============================================================================

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

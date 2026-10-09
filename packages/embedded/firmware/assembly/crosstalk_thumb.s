/*
 * CrossTalk Micro - ARM Cortex-M Thumb-2 Assembly Routine
 * Target: ARM Cortex-M0 / M3 / M4 / M7 / RP2040 / STM32 / nRF52
 *
 * Provides ultra-compact, zero-RAM, register-only parsing and validation
 * of CrossTalk binary wire packets.
 *
 * C Signature:
 *   int xt_asm_validate_header(const uint8_t *buffer, uint32_t len, uint8_t *out_opcode, uint16_t *out_payload_len);
 *
 * Register ABI (AAPCS):
 *   r0 = const uint8_t *buffer
 *   r1 = uint32_t len
 *   r2 = uint8_t *out_opcode
 *   r3 = uint16_t *out_payload_len
 * Returns in r0: 0 on success, -1 on invalid magic/version/short length.
 */

    .syntax unified
    .thumb
    .text
    .align 2
    .global xt_asm_validate_header
    .type xt_asm_validate_header, %function

xt_asm_validate_header:
    /* Check length >= 10 bytes (XT_HEADER_SIZE) */
    cmp     r1, #10
    blo     .Lfail

    /* Check magic byte == 0x58 ('X') */
    ldrb    r1, [r0, #0]
    cmp     r1, #0x58
    bne     .Lfail

    /* Check version == 0x01 */
    ldrb    r1, [r0, #1]
    cmp     r1, #0x01
    bne     .Lfail

    /* Extract Opcode (offset 2) */
    ldrb    r1, [r0, #2]
    cmp     r2, #0
    beq     .Lskip_opcode
    strb    r1, [r2]
.Lskip_opcode:

    /* Extract big-endian payload_len (offset 8 and 9) */
    cmp     r3, #0
    beq     .Lsuccess
    ldrb    r1, [r0, #8]       /* High byte */
    lsls    r1, r1, #8
    ldrb    r2, [r0, #9]       /* Low byte */
    orrs    r1, r1, r2
    strh    r1, [r3]

.Lsuccess:
    movs    r0, #0             /* Return 0: Success */
    bx      lr

.Lfail:
    movs    r0, #1
    rsbs    r0, r0, #0         /* Return -1: Error */
    bx      lr

    .size xt_asm_validate_header, . - xt_asm_validate_header

/*
 * CrossTalk Micro - ARM Cortex-M Thumb assembly header validator
 * Target: any Cortex-M (M0/M0+/M3/M4/M7: RP2040, STM32, nRF52).
 * Uses only the Thumb-1 subset available on ARMv6-M, so it also runs on M0.
 *
 * Validates a v1 CrossTalk binary frame header (same rules as xt_decode_packet
 * in ../crosstalk_micro.h):
 *
 *   [0x58 'X'][version 0x01][opcode][flags][timestamp u32 BE][payload_len u16 BE][payload...]
 *
 * C Signature:
 *   int xt_asm_validate_header(const uint8_t *buffer, uint32_t len,
 *                              uint8_t *out_opcode, uint16_t *out_payload_len);
 *
 * Register ABI (AAPCS):
 *   r0 = buffer, r1 = len (bytes available in buffer),
 *   r2 = out_opcode (may be NULL), r3 = out_payload_len (may be NULL, must be 2-byte aligned)
 *   Clobbers r1, r2, r12 (all caller-saved). No stack or RAM use.
 *
 * Returns in r0 (matches xt_decode_packet):
 *    0  valid frame; the whole payload is inside `len`
 *   -1  buffer is NULL or shorter than the 10-byte header
 *   -2  bad magic byte or unsupported version
 *   -3  partial frame: header is valid but len < 10 + payload_len.
 *       *out_opcode and *out_payload_len are still written, so a caller can
 *       tell how many more bytes it needs.
 */

    .syntax unified
    .thumb
    .text
    .align 2
    .global xt_asm_validate_header
    .type xt_asm_validate_header, %function
    .thumb_func

xt_asm_validate_header:
    /* NULL buffer or len < 10 (XT_HEADER_SIZE) -> -1 */
    cmp     r0, #0
    beq     .Lshort
    cmp     r1, #10
    blo     .Lshort

    /* r12 = bytes available for the payload (len - 10) */
    subs    r1, r1, #10
    mov     r12, r1

    /* Magic byte == 0x58 ('X') and version == 0x01, else -2 */
    ldrb    r1, [r0, #0]
    cmp     r1, #0x58
    bne     .Lbad_header
    ldrb    r1, [r0, #1]
    cmp     r1, #0x01
    bne     .Lbad_header

    /* Opcode (offset 2) */
    cmp     r2, #0
    beq     .Lskip_opcode
    ldrb    r1, [r0, #2]
    strb    r1, [r2]
.Lskip_opcode:

    /* Big-endian payload_len (offsets 8, 9) -> r1 */
    ldrb    r1, [r0, #8]
    lsls    r1, r1, #8
    ldrb    r2, [r0, #9]
    orrs    r1, r1, r2

    cmp     r3, #0
    beq     .Lskip_len
    strh    r1, [r3]
.Lskip_len:

    /* Partial frame if available payload bytes < payload_len -> -3 */
    mov     r2, r12
    cmp     r2, r1
    blo     .Lpartial

    movs    r0, #0
    bx      lr

.Lshort:
    movs    r0, #0
    subs    r0, r0, #1          /* -1 */
    bx      lr

.Lbad_header:
    movs    r0, #0
    subs    r0, r0, #2          /* -2 */
    bx      lr

.Lpartial:
    movs    r0, #0
    subs    r0, r0, #3          /* -3 */
    bx      lr

    .size xt_asm_validate_header, . - xt_asm_validate_header

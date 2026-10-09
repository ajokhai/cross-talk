#include <stdio.h>
#include <assert.h>
#include "crosstalk_micro.h"

int main(void) {
    printf("Testing CrossTalk Micro C Library for constrained MCUs...\n");

    xt_packet_t pkt;
    int res = xt_encode_claim(&pkt, "firmware.ino", XT_INTENT_FEAT, "ADC calibration", 60);
    assert(res == 0);

    printf("Generated packet size: %u bytes (Fits in any MCU RAM!)\n", pkt.length);
    assert(pkt.buffer[0] == XT_MAGIC);
    assert(pkt.buffer[1] == XT_VERSION);
    assert(pkt.buffer[2] == XT_OP_LOCK_ACQUIRE);

    /* Decode it back */
    xt_frame_t frame;
    res = xt_decode_packet(pkt.buffer, pkt.length, &frame);
    assert(res == 0);
    assert(frame.opcode == XT_OP_LOCK_ACQUIRE);
    assert(frame.payload_len > 0);

    printf("Opcode: 0x%02X, Payload Length: %u\n", frame.opcode, frame.payload_len);
    printf("All MCU C tests passed successfully!\n");
    return 0;
}

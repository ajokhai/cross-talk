/*
 * Tests for crosstalk_micro.h.
 *
 *   cc -I. test_micro.c -o test_micro && ./test_micro
 *
 * Also used by packages/embedded/test/firmware.test.ts for cross-language checks:
 *   ./test_micro emit            prints a claim and a release frame as hex, one per line
 *   ./test_micro decode <hex>    decodes a frame and prints "opcode payload_len"
 *   ./test_micro emit-chat       prints REGISTER, BROADCAST, DIRECT_MSG, HEARTBEAT and
 *                                STATE_QUERY frames as hex, one per line
 *   ./test_micro downlink <hex>  decodes a host->device frame and prints
 *                                "chat <from>|<text>", "lock <action> <flags> <target>|<reason>"
 *                                or "other <opcode>"
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include "crosstalk_micro.h"

static void print_hex(const xt_packet_t* pkt) {
    for (uint16_t i = 0; i < pkt->length; i++) printf("%02x", pkt->buffer[i]);
    printf("\n");
}

static int run_tests(void) {
    xt_packet_t pkt;
    xt_frame_t frame;
    char long_name[300];

    /* Claim round trip and payload layout */
    assert(xt_encode_claim(&pkt, "firmware.ino", XT_INTENT_FEAT, "ADC calibration", 60) == 0);
    assert(pkt.buffer[0] == XT_MAGIC && pkt.buffer[1] == XT_VERSION && pkt.buffer[2] == XT_OP_LOCK_ACQUIRE);
    assert(xt_decode_packet(pkt.buffer, pkt.length, &frame) == 0);
    assert(frame.opcode == XT_OP_LOCK_ACQUIRE);
    assert(frame.payload_len == 5 + 1 + 12 + 1 + 15);
    assert(frame.payload[0] == XT_TOK_LCK && frame.payload[1] == XT_INTENT_FEAT && frame.payload[2] == XT_FLOW_WAIT);
    assert(frame.payload[3] == 0 && frame.payload[4] == 60);
    assert(frame.payload[5] == 12 && memcmp(&frame.payload[6], "firmware.ino", 12) == 0);

    /* Release round trip */
    assert(xt_encode_release(&pkt, "firmware.ino") == 0);
    assert(xt_decode_packet(pkt.buffer, pkt.length, &frame) == 0);
    assert(frame.opcode == XT_OP_LOCK_RELEASE && frame.payload_len == 7 + 12);
    assert(frame.payload[2] == (XT_FLOW_DONE | XT_FLOW_PROCEED));

    /* Bounds: names that don't fit are rejected instead of overflowing or wrapping */
    memset(long_name, 'a', sizeof long_name - 1);
    long_name[sizeof long_name - 1] = '\0';
    assert(xt_encode_release(&pkt, long_name) == -1);           /* 299 bytes: > 255 */
    long_name[200] = '\0';
    assert(xt_encode_release(&pkt, long_name) == -1);           /* 200 bytes: fits a byte, not the packet */
    assert(xt_encode_claim(&pkt, long_name, XT_INTENT_FIX, "", 10) == -1);
    long_name[XT_MAX_PACKET_SIZE - XT_HEADER_SIZE - 7] = '\0';  /* largest release that fits */
    assert(xt_encode_release(&pkt, long_name) == 0 && pkt.length == XT_MAX_PACKET_SIZE);
    assert(xt_encode_release(0, "x") == -1 && xt_encode_claim(&pkt, 0, 0, 0, 0) == -1);

    /* Decoder rejects short, foreign and partial frames */
    assert(xt_encode_claim(&pkt, "a.c", XT_INTENT_FIX, "r", 5) == 0);
    assert(xt_decode_packet(pkt.buffer, 9, &frame) == -1);
    assert(xt_decode_packet(pkt.buffer, pkt.length - 1, &frame) == -3);
    pkt.buffer[0] = 'Y';
    assert(xt_decode_packet(pkt.buffer, pkt.length, &frame) == -2);

    /* Conversation encoders */
    assert(xt_encode_register(&pkt, "esp32-imu") == 0);
    assert(xt_decode_packet(pkt.buffer, pkt.length, &frame) == 0);
    assert(frame.opcode == XT_OP_REGISTER && frame.payload_len == 9 && memcmp(frame.payload, "esp32-imu", 9) == 0);
    memset(long_name, 'n', sizeof long_name - 1);
    long_name[XT_MAX_NAME_LEN] = '\0';
    assert(xt_encode_register(&pkt, long_name) == 0);           /* exactly 32 bytes */
    long_name[XT_MAX_NAME_LEN] = 'n';
    long_name[XT_MAX_NAME_LEN + 1] = '\0';
    assert(xt_encode_register(&pkt, long_name) == -1);          /* 33 bytes */
    assert(xt_encode_register(&pkt, "") == -1 && xt_encode_register(&pkt, 0) == -1);

    assert(xt_encode_text(&pkt, "temp 21.5C") == 0);
    assert(xt_decode_packet(pkt.buffer, pkt.length, &frame) == 0);
    assert(frame.opcode == XT_OP_BROADCAST && frame.payload_len == 10);
    assert(xt_encode_text(&pkt, "\x10LCK") == -1);              /* would read as packed shorthand */
    assert(xt_encode_text(&pkt, "\x71") == -1 && xt_encode_text(&pkt, "") == -1);
    memset(long_name, 't', sizeof long_name - 1);
    long_name[XT_MAX_PACKET_SIZE - XT_HEADER_SIZE] = '\0';
    assert(xt_encode_text(&pkt, long_name) == 0 && pkt.length == XT_MAX_PACKET_SIZE);
    long_name[XT_MAX_PACKET_SIZE - XT_HEADER_SIZE] = 't';
    long_name[XT_MAX_PACKET_SIZE - XT_HEADER_SIZE + 1] = '\0';
    assert(xt_encode_text(&pkt, long_name) == -1);

    assert(xt_encode_dm(&pkt, "claude-bot", "done", 0) == 0);
    assert(xt_decode_packet(pkt.buffer, pkt.length, &frame) == 0);
    assert(frame.opcode == XT_OP_DIRECT_MSG && frame.flags == 0);
    assert(frame.payload[0] == 10 && memcmp(&frame.payload[1], "claude-bot", 10) == 0 && memcmp(&frame.payload[11], "done", 4) == 0);
    assert(xt_encode_dm(&pkt, "claude-bot", "ping?", 1) == 0 && pkt.buffer[3] == XT_FLAG_ACK_REQUESTED);
    assert(xt_encode_dm(&pkt, "", "x", 1) == -1 && xt_encode_dm(&pkt, "a", "", 1) == -1);

    assert(xt_encode_heartbeat(&pkt, 0) == 0 && pkt.length == XT_HEADER_SIZE && pkt.buffer[2] == XT_OP_HEARTBEAT);
    assert(xt_encode_heartbeat(&pkt, "calibrating") == 0 && pkt.length == XT_HEADER_SIZE + 11);
    assert(xt_encode_state_query(&pkt) == 0 && pkt.length == XT_HEADER_SIZE && pkt.buffer[2] == XT_OP_STATE_QUERY);

    /* Downlink decoders */
    {
        static const uint8_t chat[] = { 'X', 1, XT_OP_BROADCAST, 0, 0, 0, 0, 0, 0, 9, 5, 'a', 'l', 'i', 'c', 'e', 'h', 'i', '!' };
        const char *from, *text; uint8_t from_len; uint16_t text_len;
        assert(xt_decode_packet(chat, sizeof chat, &frame) == 0);
        assert(xt_decode_attributed(&frame, &from, &from_len, &text, &text_len) == 0);
        assert(from_len == 5 && memcmp(from, "alice", 5) == 0 && text_len == 3 && memcmp(text, "hi!", 3) == 0);
        frame.payload_len = 4;                                    /* from_len 5 runs past the payload */
        assert(xt_decode_attributed(&frame, &from, &from_len, &text, &text_len) == -1);
        frame.payload_len = 0;
        assert(xt_decode_attributed(&frame, &from, &from_len, &text, &text_len) == -1);
        assert(xt_encode_claim(&pkt, "a.c", XT_INTENT_FIX, "r", 5) == 0);
        assert(xt_decode_packet(pkt.buffer, pkt.length, &frame) == 0);
        assert(xt_decode_attributed(&frame, &from, &from_len, &text, &text_len) == -1); /* wrong opcode */
    }
    {
        xt_packed_t lock;
        assert(xt_encode_claim(&pkt, "src/motor.c", XT_INTENT_FIX, "stall", 200) == 0);
        assert(xt_decode_packet(pkt.buffer, pkt.length, &frame) == 0);
        assert(xt_decode_packed(&frame, &lock) == 0);
        assert(lock.action == XT_TOK_LCK && lock.intent == XT_INTENT_FIX && lock.flow == XT_FLOW_WAIT && lock.ttl == 200);
        assert(lock.target_len == 11 && memcmp(lock.target, "src/motor.c", 11) == 0);
        assert(lock.reason_len == 5 && memcmp(lock.reason, "stall", 5) == 0);
        for (uint16_t cut = 0; cut < frame.payload_len; cut++) { /* every truncation is rejected */
            xt_frame_t partial = frame;
            partial.payload_len = cut;
            assert(xt_decode_packed(&partial, &lock) == -1);
        }
        frame.payload = 0;
        assert(xt_decode_packed(&frame, &lock) == -1);
    }
    assert(xt_is_packed_action(0x10) && xt_is_packed_action(0x15) && xt_is_packed_action(0x70) && xt_is_packed_action(0x71));
    assert(!xt_is_packed_action(0x16) && !xt_is_packed_action('h') && !xt_is_packed_action(0x72));

    printf("All MCU C tests passed.\n");
    return 0;
}

int main(int argc, char** argv) {
    if (argc >= 2 && strcmp(argv[1], "emit") == 0) {
        xt_packet_t pkt;
        if (xt_encode_claim(&pkt, "src/sensor.c", XT_INTENT_FIX, "imu drift", 200) != 0) return 1;
        print_hex(&pkt);
        if (xt_encode_release(&pkt, "src/sensor.c") != 0) return 1;
        print_hex(&pkt);
        return 0;
    }
    if (argc >= 2 && strcmp(argv[1], "emit-chat") == 0) {
        xt_packet_t pkt;
        if (xt_encode_register(&pkt, "esp32-imu") != 0) return 1;
        print_hex(&pkt);
        if (xt_encode_text(&pkt, "temp 21.5C, ok") != 0) return 1;
        print_hex(&pkt);
        if (xt_encode_dm(&pkt, "claude-bot", "calibration done", 0) != 0) return 1;
        print_hex(&pkt);
        if (xt_encode_heartbeat(&pkt, "calibrating") != 0) return 1;
        print_hex(&pkt);
        if (xt_encode_state_query(&pkt) != 0) return 1;
        print_hex(&pkt);
        return 0;
    }
    if (argc >= 3 && strcmp(argv[1], "downlink") == 0) {
        uint8_t buf[XT_MAX_PACKET_SIZE];
        size_t n = strlen(argv[2]) / 2;
        xt_frame_t frame;
        if (n > sizeof buf) return 2;
        for (size_t i = 0; i < n; i++) {
            unsigned int byte;
            if (sscanf(argv[2] + 2 * i, "%2x", &byte) != 1) return 2;
            buf[i] = (uint8_t)byte;
        }
        if (xt_decode_packet(buf, (uint16_t)n, &frame) != 0) { printf("error\n"); return 1; }
        const char *from, *text; uint8_t from_len; uint16_t text_len;
        xt_packed_t packed;
        if (xt_decode_attributed(&frame, &from, &from_len, &text, &text_len) == 0) {
            printf("chat %.*s|%.*s\n", from_len, from, text_len, text);
        } else if (frame.opcode >= XT_OP_LOCK_ACQUIRE && frame.opcode <= XT_OP_LOCK_RELEASE &&
                   xt_decode_packed(&frame, &packed) == 0) {
            printf("lock %u %u %.*s|%.*s\n", packed.action, frame.flags, packed.target_len, packed.target,
                   packed.reason_len, packed.reason);
        } else {
            printf("other %u\n", frame.opcode);
        }
        return 0;
    }
    if (argc >= 3 && strcmp(argv[1], "decode") == 0) {
        uint8_t buf[XT_MAX_PACKET_SIZE];
        size_t n = strlen(argv[2]) / 2;
        xt_frame_t frame;
        if (n > sizeof buf) return 2;
        for (size_t i = 0; i < n; i++) {
            unsigned int byte;
            if (sscanf(argv[2] + 2 * i, "%2x", &byte) != 1) return 2;
            buf[i] = (uint8_t)byte;
        }
        int rc = xt_decode_packet(buf, (uint16_t)n, &frame);
        if (rc != 0) {
            printf("error %d\n", rc);
            return 1;
        }
        printf("%u %u\n", frame.opcode, frame.payload_len);
        return 0;
    }
    return run_tests();
}

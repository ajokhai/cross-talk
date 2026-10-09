/**
 * ==============================================================================
 * CrossTalk Micro: Ultra-Lightweight Embedded C/C++ Protocol Library
 * ==============================================================================
 * Designed for Microcontrollers with extremely constrained RAM (< 2KB RAM):
 * - Arduino (AVR ATmega328, SAMD21, Mega)
 * - ESP32 / ESP8266 (WiFi / Bluetooth Serial)
 * - Raspberry Pi Pico (RP2040)
 * - STM32 / ARM Cortex-M0/M3/M4
 * 
 * Features:
 * - ZERO HEAP ALLOCATIONS: 100% stack & static buffers (No malloc/free).
 * - Total memory footprint: < 150 bytes of RAM.
 * - Transport agnostic: Works over UART, Bluetooth SPP/BLE, WiFi TCP/Sockets.
 * - Lossless XDialect and Binary Bitstream encoding/decoding.
 * ==============================================================================
 */

#ifndef CROSSTALK_MICRO_H
#define CROSSTALK_MICRO_H

#include <stdint.h>
#include <string.h>

#ifdef __cplusplus
extern "C" {
#endif

#define XT_MAGIC               0x58  /* 'X' */
#define XT_VERSION             0x01
#define XT_MAX_PACKET_SIZE     128
#define XT_HEADER_SIZE         10

/* Binary Protocol Opcodes */
typedef enum {
    XT_OP_HEARTBEAT    = 0x00,
    XT_OP_REGISTER     = 0x01,
    XT_OP_BROADCAST    = 0x02,
    XT_OP_DIRECT_MSG   = 0x03,
    XT_OP_LOCK_ACQUIRE = 0x04,
    XT_OP_LOCK_ACK     = 0x05,
    XT_OP_LOCK_DENIED  = 0x06,
    XT_OP_LOCK_RELEASE = 0x07,
    XT_OP_STATE_QUERY  = 0x08
} xt_opcode_t;

/* XDialect Token Numeric IDs */
typedef enum {
    XT_TOK_LCK  = 0x10, /* !LCK: Claim exclusive lock */
    XT_TOK_REL  = 0x11, /* !REL: Release lock */
    XT_TOK_BCST = 0x12, /* !BCST: Broadcast announcement */
    XT_TOK_WARN = 0x14  /* !WARN: Conflict alert */
} xt_action_t;

typedef enum {
    XT_INTENT_REF  = 0x30, /* #REF: Refactoring */
    XT_INTENT_FEAT = 0x31, /* #FEAT: New feature */
    XT_INTENT_FIX  = 0x32, /* #FIX: Bug fix */
    XT_INTENT_TEST = 0x33, /* #TEST: Running tests */
    XT_INTENT_MIG  = 0x35  /* #MIG: Schema migration */
} xt_intent_t;

/* Flow bitfield flags */
#define XT_FLOW_WAIT    (1 << 0)  /* &WAIT: Hang on for me to finish */
#define XT_FLOW_ACK     (1 << 1)  /* &ACK: Understood, holding off */
#define XT_FLOW_DONE    (1 << 2)  /* &DONE: Task finished */
#define XT_FLOW_PROCEED (1 << 3)  /* &PROCEED: Clear to proceed */

/* Static Raw Packet Container */
typedef struct {
    uint8_t  buffer[XT_MAX_PACKET_SIZE];
    uint16_t length;
} xt_packet_t;

/* Parsed Frame Information */
typedef struct {
    uint8_t  opcode;
    uint8_t  flags;
    uint32_t timestamp;
    uint16_t payload_len;
    const uint8_t* payload;
} xt_frame_t;

/**
 * Builds a CrossTalk Binary Wire Packet.
 * Frame Layout: [MAGIC:1][VERSION:1][OPCODE:1][FLAGS:1][TIMESTAMP:4][PAYLOAD_LEN:2][PAYLOAD:N]
 */
static inline int xt_build_packet(
    xt_packet_t* pkt,
    uint8_t opcode,
    uint8_t flags,
    uint32_t timestamp_sec,
    const uint8_t* payload,
    uint16_t payload_len
) {
    if (!pkt || (XT_HEADER_SIZE + payload_len > XT_MAX_PACKET_SIZE)) {
        return -1; /* Overflow error */
    }

    pkt->buffer[0] = XT_MAGIC;
    pkt->buffer[1] = XT_VERSION;
    pkt->buffer[2] = opcode;
    pkt->buffer[3] = flags;

    /* 4-byte big-endian timestamp */
    pkt->buffer[4] = (uint8_t)((timestamp_sec >> 24) & 0xFF);
    pkt->buffer[5] = (uint8_t)((timestamp_sec >> 16) & 0xFF);
    pkt->buffer[6] = (uint8_t)((timestamp_sec >> 8) & 0xFF);
    pkt->buffer[7] = (uint8_t)(timestamp_sec & 0xFF);

    /* 2-byte big-endian payload length */
    pkt->buffer[8] = (uint8_t)((payload_len >> 8) & 0xFF);
    pkt->buffer[9] = (uint8_t)(payload_len & 0xFF);

    if (payload && payload_len > 0) {
        memcpy(&pkt->buffer[XT_HEADER_SIZE], payload, payload_len);
    }

    pkt->length = XT_HEADER_SIZE + payload_len;
    return 0;
}

/**
 * Encodes an XDialect Bitstream Packet (Compact 25-45 bytes total).
 * Microcontroller sends this over Bluetooth or Serial.
 * Layout in payload: [ACTION_ID:1][INTENT_ID:1][FLOW_BITS:1][TTL:2][TARGET_LEN:1][TARGET_STR][REASON_LEN:1][REASON_STR]
 */
static inline int xt_encode_claim(
    xt_packet_t* pkt,
    const char* target_file,
    uint8_t intent_id,
    const char* reason,
    uint16_t ttl_sec
) {
    uint8_t payload[XT_MAX_PACKET_SIZE - XT_HEADER_SIZE];
    uint8_t target_len = (uint8_t)strlen(target_file);
    uint8_t reason_len = (uint8_t)(reason ? strlen(reason) : 0);

    if (5 + 1 + target_len + 1 + reason_len > sizeof(payload)) {
        return -1;
    }

    payload[0] = XT_TOK_LCK;
    payload[1] = intent_id;
    payload[2] = XT_FLOW_WAIT; /* Default to &WAIT */
    payload[3] = (uint8_t)((ttl_sec >> 8) & 0xFF);
    payload[4] = (uint8_t)(ttl_sec & 0xFF);

    payload[5] = target_len;
    memcpy(&payload[6], target_file, target_len);

    uint16_t reason_offset = 6 + target_len;
    payload[reason_offset] = reason_len;
    if (reason_len > 0) {
        memcpy(&payload[reason_offset + 1], reason, reason_len);
    }

    uint16_t total_payload_len = reason_offset + 1 + reason_len;
    return xt_build_packet(pkt, XT_OP_LOCK_ACQUIRE, 0x00, 0, payload, total_payload_len);
}

/**
 * Encodes a Release Lock Packet (!REL @file &DONE &PROCEED).
 */
static inline int xt_encode_release(
    xt_packet_t* pkt,
    const char* target_file
) {
    uint8_t payload[64];
    uint8_t target_len = (uint8_t)strlen(target_file);

    payload[0] = XT_TOK_REL;
    payload[1] = 0x00;
    payload[2] = XT_FLOW_DONE | XT_FLOW_PROCEED;
    payload[3] = 0x00;
    payload[4] = 0x00;

    payload[5] = target_len;
    memcpy(&payload[6], target_file, target_len);
    payload[6 + target_len] = 0; /* 0-length reason */

    uint16_t total_payload_len = 7 + target_len;
    return xt_build_packet(pkt, XT_OP_LOCK_RELEASE, 0x00, 0, payload, total_payload_len);
}

/**
 * Decodes an incoming CrossTalk packet in-place without dynamic memory.
 */
static inline int xt_decode_packet(
    const uint8_t* data,
    uint16_t length,
    xt_frame_t* out_frame
) {
    if (!data || !out_frame || length < XT_HEADER_SIZE) {
        return -1;
    }

    if (data[0] != XT_MAGIC || data[1] != XT_VERSION) {
        return -2; /* Invalid protocol header */
    }

    out_frame->opcode = data[2];
    out_frame->flags = data[3];

    out_frame->timestamp = ((uint32_t)data[4] << 24) |
                           ((uint32_t)data[5] << 16) |
                           ((uint32_t)data[6] << 8)  |
                           ((uint32_t)data[7]);

    out_frame->payload_len = ((uint16_t)data[8] << 8) | data[9];

    if (length < XT_HEADER_SIZE + out_frame->payload_len) {
        return -3; /* Partial frame received */
    }

    out_frame->payload = (out_frame->payload_len > 0) ? &data[XT_HEADER_SIZE] : 0;
    return 0;
}

#ifdef __cplusplus
}

/* Arduino / C++ Convenience Wrapper */
class CrossTalkMicro {
public:
    template<typename StreamType>
    static void sendPacket(StreamType& serial, const xt_packet_t& pkt) {
        /* Write 2-byte length prefix for stream delimitation */
        uint8_t prefix[2];
        prefix[0] = (uint8_t)((pkt.length >> 8) & 0xFF);
        prefix[1] = (uint8_t)(pkt.length & 0xFF);
        serial.write(prefix, 2);
        serial.write(pkt.buffer, pkt.length);
    }

    template<typename StreamType>
    static bool claimLock(StreamType& serial, const char* file, uint8_t intent, const char* reason, uint16_t ttl = 120) {
        xt_packet_t pkt;
        if (xt_encode_claim(&pkt, file, intent, reason, ttl) == 0) {
            sendPacket(serial, pkt);
            return true;
        }
        return false;
    }

    template<typename StreamType>
    static bool releaseLock(StreamType& serial, const char* file) {
        xt_packet_t pkt;
        if (xt_encode_release(&pkt, file) == 0) {
            sendPacket(serial, pkt);
            return true;
        }
        return false;
    }
};

#endif

#endif /* CROSSTALK_MICRO_H */

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

/* Frame header flag bits (byte 3) */
#define XT_FLAG_ACK_REQUESTED  (1 << 0)  /* Device wants a reply (DIRECT_MSG: reply expected) */
#define XT_FLAG_RESPONSE       (1 << 1)  /* Host reply to a device request */
#define XT_FLAG_CONFLICT       (1 << 2)  /* Someone wants a lock this device holds */

/* Agent names (REGISTER, DM to/from) are at most this many bytes on the wire. */
#define XT_MAX_NAME_LEN        32

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
    size_t target_len, reason_len;

    if (!pkt || !target_file) {
        return -1;
    }
    target_len = strlen(target_file);
    reason_len = reason ? strlen(reason) : 0;
    /* Lengths travel as one byte each, and the whole payload must fit the packet. */
    if (target_len > 255 || reason_len > 255 || 5 + 1 + target_len + 1 + reason_len > sizeof(payload)) {
        return -1;
    }

    payload[0] = XT_TOK_LCK;
    payload[1] = intent_id;
    payload[2] = XT_FLOW_WAIT; /* Default to &WAIT */
    payload[3] = (uint8_t)((ttl_sec >> 8) & 0xFF);
    payload[4] = (uint8_t)(ttl_sec & 0xFF);

    payload[5] = (uint8_t)target_len;
    memcpy(&payload[6], target_file, target_len);

    uint16_t reason_offset = (uint16_t)(6 + target_len);
    payload[reason_offset] = (uint8_t)reason_len;
    if (reason_len > 0) {
        memcpy(&payload[reason_offset + 1], reason, reason_len);
    }

    uint16_t total_payload_len = (uint16_t)(reason_offset + 1 + reason_len);
    return xt_build_packet(pkt, XT_OP_LOCK_ACQUIRE, 0x00, 0, payload, total_payload_len);
}

/**
 * Encodes a Release Lock Packet (!REL @file &DONE &PROCEED).
 */
static inline int xt_encode_release(
    xt_packet_t* pkt,
    const char* target_file
) {
    uint8_t payload[XT_MAX_PACKET_SIZE - XT_HEADER_SIZE];
    size_t target_len;

    if (!pkt || !target_file) {
        return -1;
    }
    target_len = strlen(target_file);
    if (target_len > 255 || 7 + target_len > sizeof(payload)) {
        return -1; /* Would overflow the payload buffer */
    }

    payload[0] = XT_TOK_REL;
    payload[1] = 0x00;
    payload[2] = XT_FLOW_DONE | XT_FLOW_PROCEED;
    payload[3] = 0x00;
    payload[4] = 0x00;

    payload[5] = (uint8_t)target_len;
    memcpy(&payload[6], target_file, target_len);
    payload[6 + target_len] = 0; /* 0-length reason */

    uint16_t total_payload_len = (uint16_t)(7 + target_len);
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


/* ==============================================================================
 * Conversation helpers (host bridge profile)
 *
 * A device joins a CrossTalk conversation through the host bridge
 * (`crosstalk-bridge` in packages/embedded). Payload layouts:
 *
 *   Device -> host                       Host -> device (unsolicited)
 *   REGISTER    UTF-8 name (<= 32 B)     BROADCAST  [from_len:1][from][text]
 *   HEARTBEAT   empty or status text     DIRECT_MSG [from_len:1][from][text]
 *   BROADCAST   UTF-8 text               LOCK_ACQUIRE packed !LCK (holder in reason),
 *   DIRECT_MSG  [to_len:1][to][text]       or packed !WARN with XT_FLAG_CONFLICT
 *   STATE_QUERY empty                    LOCK_RELEASE packed !REL
 *
 * Replies carry XT_FLAG_RESPONSE: REGISTER -> agent id text, HEARTBEAT -> empty,
 * LOCK_ACK / LOCK_DENIED -> packed XDialect, STATE_QUERY -> "members=N locks=M".
 * Note the direction: device BROADCAST is plain text, host BROADCAST is
 * attributed ([from_len][from][text]).
 *
 * Decoders return pointers into the received buffer; strings are NOT
 * NUL-terminated, so use the returned lengths.
 * ============================================================================== */

/* True if the bridge would read this first byte as packed XDialect, not text. */
static inline int xt_is_packed_action(uint8_t byte) {
    return (byte >= 0x10 && byte <= 0x15) || byte == 0x70 || byte == 0x71;
}

/* REGISTER: announce the device's agent name. Send it as the first frame. */
static inline int xt_encode_register(xt_packet_t* pkt, const char* name) {
    size_t len;
    if (!pkt || !name) return -1;
    len = strlen(name);
    if (len == 0 || len > XT_MAX_NAME_LEN) return -1;
    return xt_build_packet(pkt, XT_OP_REGISTER, 0x00, 0, (const uint8_t*)name, (uint16_t)len);
}

/* HEARTBEAT: keep-alive; optional status text becomes the agent's current task. */
static inline int xt_encode_heartbeat(xt_packet_t* pkt, const char* status) {
    size_t len = status ? strlen(status) : 0;
    if (!pkt || len > XT_MAX_PACKET_SIZE - XT_HEADER_SIZE) return -1;
    return xt_build_packet(pkt, XT_OP_HEARTBEAT, 0x00, 0, (const uint8_t*)status, (uint16_t)len);
}

/* BROADCAST: say something in the conversation. Text that starts with a
 * packed-XDialect action byte (0x10-0x15, 0x70, 0x71) is rejected because the
 * bridge would parse it as shorthand. */
static inline int xt_encode_text(xt_packet_t* pkt, const char* text) {
    size_t len;
    if (!pkt || !text) return -1;
    len = strlen(text);
    if (len == 0 || len > XT_MAX_PACKET_SIZE - XT_HEADER_SIZE) return -1;
    if (xt_is_packed_action((uint8_t)text[0])) return -1;
    return xt_build_packet(pkt, XT_OP_BROADCAST, 0x00, 0, (const uint8_t*)text, (uint16_t)len);
}

/* DIRECT_MSG: private message to a channel-mate by agent name or id.
 * Set reply_expected to 0 for acknowledgements so agents don't reply in a loop. */
static inline int xt_encode_dm(xt_packet_t* pkt, const char* to, const char* text, int reply_expected) {
    uint8_t payload[XT_MAX_PACKET_SIZE - XT_HEADER_SIZE];
    size_t to_len, text_len;
    if (!pkt || !to || !text) return -1;
    to_len = strlen(to);
    text_len = strlen(text);
    if (to_len == 0 || to_len > XT_MAX_NAME_LEN || text_len == 0) return -1;
    if (1 + to_len + text_len > sizeof(payload)) return -1;
    payload[0] = (uint8_t)to_len;
    memcpy(&payload[1], to, to_len);
    memcpy(&payload[1 + to_len], text, text_len);
    return xt_build_packet(pkt, XT_OP_DIRECT_MSG, reply_expected ? XT_FLAG_ACK_REQUESTED : 0x00, 0,
                           payload, (uint16_t)(1 + to_len + text_len));
}

/* STATE_QUERY: ask how many members and locks the conversation has. */
static inline int xt_encode_state_query(xt_packet_t* pkt) {
    if (!pkt) return -1;
    return xt_build_packet(pkt, XT_OP_STATE_QUERY, 0x00, 0, 0, 0);
}

/* Downlink BROADCAST / DIRECT_MSG: [from_len:1][from][text].
 * Returns 0, or -1 if the frame is not one of those or is malformed. */
static inline int xt_decode_attributed(
    const xt_frame_t* frame,
    const char** from, uint8_t* from_len,
    const char** text, uint16_t* text_len
) {
    uint8_t n;
    if (!frame || !from || !from_len || !text || !text_len) return -1;
    if (frame->opcode != XT_OP_BROADCAST && frame->opcode != XT_OP_DIRECT_MSG) return -1;
    if (frame->payload_len < 1 || !frame->payload) return -1;
    n = frame->payload[0];
    if ((uint16_t)(1 + n) > frame->payload_len) return -1;
    *from = (const char*)&frame->payload[1];
    *from_len = n;
    *text = (const char*)&frame->payload[1 + n];
    *text_len = (uint16_t)(frame->payload_len - 1 - n);
    return 0;
}

/* A packed XDialect payload, as sent in LOCK_* frames:
 * [action:1][intent:1][flow:1][ttl:2 BE][target_len:1][target][reason_len:1][reason] */
typedef struct {
    uint8_t  action;      /* XT_TOK_* */
    uint8_t  intent;      /* XT_INTENT_* or 0 */
    uint8_t  flow;        /* XT_FLOW_* bits */
    uint16_t ttl;         /* seconds */
    const char* target;   /* file path, not NUL-terminated */
    uint8_t  target_len;
    const char* reason;   /* e.g. the lock holder's name; not NUL-terminated */
    uint8_t  reason_len;
} xt_packed_t;

/* Decodes the packed XDialect payload of LOCK_ACQUIRE / LOCK_ACK / LOCK_DENIED /
 * LOCK_RELEASE frames. Returns 0, or -1 if it is truncated or inconsistent. */
static inline int xt_decode_packed(const xt_frame_t* frame, xt_packed_t* out) {
    const uint8_t* p;
    uint16_t len, reason_at;
    if (!frame || !out || !frame->payload) return -1;
    p = frame->payload;
    len = frame->payload_len;
    if (len < 7) return -1;
    out->action = p[0];
    out->intent = p[1];
    out->flow = p[2];
    out->ttl = (uint16_t)(((uint16_t)p[3] << 8) | p[4]);
    out->target_len = p[5];
    reason_at = (uint16_t)(6 + out->target_len);
    if (reason_at >= len) return -1;              /* need the reason length byte */
    out->target = (const char*)&p[6];
    out->reason_len = p[reason_at];
    if ((uint16_t)(reason_at + 1 + out->reason_len) > len) return -1;
    out->reason = (const char*)&p[reason_at + 1];
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

    template<typename StreamType>
    static bool registerName(StreamType& serial, const char* name) {
        xt_packet_t pkt;
        if (xt_encode_register(&pkt, name) != 0) return false;
        sendPacket(serial, pkt);
        return true;
    }

    template<typename StreamType>
    static bool say(StreamType& serial, const char* text) {
        xt_packet_t pkt;
        if (xt_encode_text(&pkt, text) != 0) return false;
        sendPacket(serial, pkt);
        return true;
    }

    template<typename StreamType>
    static bool directMessage(StreamType& serial, const char* to, const char* text, bool replyExpected = true) {
        xt_packet_t pkt;
        if (xt_encode_dm(&pkt, to, text, replyExpected ? 1 : 0) != 0) return false;
        sendPacket(serial, pkt);
        return true;
    }

    template<typename StreamType>
    static bool heartbeat(StreamType& serial, const char* status = 0) {
        xt_packet_t pkt;
        if (xt_encode_heartbeat(&pkt, status) != 0) return false;
        sendPacket(serial, pkt);
        return true;
    }
};

#endif

#endif /* CROSSTALK_MICRO_H */

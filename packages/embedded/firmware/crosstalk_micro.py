"""
CrossTalk Micro: Zero-dependency MicroPython / CircuitPython client
Runs on ESP32, Raspberry Pi Pico W, and constrained microcontrollers (< 10KB RAM).
"""

import struct
import time

XT_MAGIC = 0x58
XT_VERSION = 0x01

# Opcodes
OP_REGISTER = 0x01
OP_BROADCAST = 0x02
OP_LOCK_ACQUIRE = 0x04
OP_LOCK_RELEASE = 0x07

# XDialect Tokens
TOK_LCK = 0x10
TOK_REL = 0x11
INTENT_FEAT = 0x31
INTENT_FIX = 0x32
FLOW_WAIT = 0x01
FLOW_PROCEED = 0x08


class CrossTalkMicro:
    """Ultra-lightweight packet generator & parser for microcontrollers."""

    @staticmethod
    def pack_claim(target_file: str, reason: str = "Hardware sensor task", ttl: int = 60) -> bytes:
        """Packs a lock claim into a tiny 30-45 byte frame."""
        target_bytes = target_file.encode("utf-8")
        reason_bytes = reason.encode("utf-8")

        # Payload: [ACTION:1][INTENT:1][FLOW:1][TTL:2][TARGET_LEN:1][TARGET][REASON_LEN:1][REASON]
        payload = bytearray()
        payload.append(TOK_LCK)
        payload.append(INTENT_FEAT)
        payload.append(FLOW_WAIT)
        payload.extend(struct.pack(">H", ttl))
        payload.append(len(target_bytes))
        payload.extend(target_bytes)
        payload.append(len(reason_bytes))
        payload.extend(reason_bytes)

        # Frame Header: [MAGIC:1][VERSION:1][OPCODE:1][FLAGS:1][TIMESTAMP:4][PAYLOAD_LEN:2]
        header = struct.pack(
            ">BBBBII",
            XT_MAGIC,
            XT_VERSION,
            OP_LOCK_ACQUIRE,
            0,
            int(time.time()),
            len(payload),
        )
        # Prefix with 2-byte length for raw stream / serial framing
        frame = header + payload
        return struct.pack(">H", len(frame)) + frame

    @staticmethod
    def pack_release(target_file: str) -> bytes:
        """Packs a lock release packet (!REL @file &PROCEED)."""
        target_bytes = target_file.encode("utf-8")
        payload = bytearray()
        payload.append(TOK_REL)
        payload.append(0x00)
        payload.append(FLOW_PROCEED)
        payload.extend(struct.pack(">H", 0))
        payload.append(len(target_bytes))
        payload.extend(target_bytes)
        payload.append(0)

        header = struct.pack(
            ">BBBBII",
            XT_MAGIC,
            XT_VERSION,
            OP_LOCK_RELEASE,
            0,
            int(time.time()),
            len(payload),
        )
        frame = header + payload
        return struct.pack(">H", len(frame)) + frame

    @staticmethod
    def unpack_frame(raw_bytes: bytes):
        """Unpacks an incoming binary frame in-place."""
        if len(raw_bytes) < 10:
            return None
        magic, ver, opcode, flags, ts, plen = struct.unpack(">BBBBII", raw_bytes[:10])
        if magic != XT_MAGIC or ver != XT_VERSION:
            return None
        payload = raw_bytes[10 : 10 + plen]
        return {"opcode": opcode, "flags": flags, "timestamp": ts, "payload": payload}

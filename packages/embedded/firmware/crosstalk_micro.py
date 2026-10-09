"""
CrossTalk Micro: Zero-dependency MicroPython / CircuitPython client
Runs on ESP32, Raspberry Pi Pico W, and constrained microcontrollers (< 10KB RAM).
"""

import struct
import time

XT_MAGIC = 0x58
XT_VERSION = 0x01
XT_HEADER_SIZE = 10

# [MAGIC:1][VERSION:1][OPCODE:1][FLAGS:1][TIMESTAMP:4][PAYLOAD_LEN:2], big-endian
_HEADER = ">BBBBIH"

XT_MAX_PACKET_SIZE = 128
XT_MAX_PAYLOAD = XT_MAX_PACKET_SIZE - XT_HEADER_SIZE
XT_MAX_NAME_LEN = 32

# Opcodes
OP_HEARTBEAT = 0x00
OP_REGISTER = 0x01
OP_BROADCAST = 0x02
OP_DIRECT_MSG = 0x03
OP_LOCK_ACQUIRE = 0x04
OP_LOCK_ACK = 0x05
OP_LOCK_DENIED = 0x06
OP_LOCK_RELEASE = 0x07
OP_STATE_QUERY = 0x08

# Frame flag bits (header byte 3)
FLAG_ACK_REQUESTED = 0x01
FLAG_RESPONSE = 0x02
FLAG_CONFLICT = 0x04

# XDialect Tokens
TOK_LCK = 0x10
TOK_REL = 0x11
TOK_WARN = 0x14
INTENT_FEAT = 0x31
INTENT_FIX = 0x32
FLOW_WAIT = 0x01
FLOW_DONE = 0x04
FLOW_PROCEED = 0x08


def _frame(opcode: int, payload: bytes, flags: int = 0) -> bytes:
    """Builds a frame and prefixes it with a 2-byte length for raw stream / serial framing."""
    if len(payload) > XT_MAX_PAYLOAD:
        raise ValueError("payload is limited to %d bytes" % XT_MAX_PAYLOAD)
    header = struct.pack(_HEADER, XT_MAGIC, XT_VERSION, opcode, flags, int(time.time()) & 0xFFFFFFFF, len(payload))
    frame = header + payload
    return struct.pack(">H", len(frame)) + frame


def _short_string(value: str) -> bytes:
    """UTF-8 bytes of a string sent with a 1-byte length."""
    data = value.encode("utf-8")
    if len(data) > 255:
        raise ValueError("strings are limited to 255 bytes on the wire")
    return data


def _is_packed_action(byte: int) -> bool:
    """True if the bridge would read a BROADCAST starting with this byte as packed XDialect."""
    return 0x10 <= byte <= 0x15 or byte in (0x70, 0x71)


def _text(data) -> str:
    try:
        return bytes(data).decode("utf-8")
    except UnicodeError:
        return "".join(chr(b) if b < 0x80 else "?" for b in data)


class CrossTalkMicro:
    """Ultra-lightweight packet generator & parser for microcontrollers."""

    @staticmethod
    def pack_claim(target_file: str, reason: str = "Hardware sensor task", ttl: int = 60) -> bytes:
        """Packs a lock claim (!LCK @file #FEAT "reason" ~ttl &WAIT), length-prefixed for a stream."""
        target_bytes = _short_string(target_file)
        reason_bytes = _short_string(reason)

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

        return _frame(OP_LOCK_ACQUIRE, bytes(payload))

    @staticmethod
    def pack_release(target_file: str) -> bytes:
        """Packs a lock release (!REL @file &DONE &PROCEED), length-prefixed for a stream."""
        target_bytes = _short_string(target_file)
        payload = bytearray()
        payload.append(TOK_REL)
        payload.append(0x00)
        payload.append(FLOW_DONE | FLOW_PROCEED)
        payload.extend(struct.pack(">H", 0))
        payload.append(len(target_bytes))
        payload.extend(target_bytes)
        payload.append(0)

        return _frame(OP_LOCK_RELEASE, bytes(payload))

    @staticmethod
    def unpack_frame(raw_bytes: bytes):
        """Unpacks one binary frame (without its stream length prefix). None if invalid or partial."""
        if len(raw_bytes) < XT_HEADER_SIZE:
            return None
        magic, ver, opcode, flags, ts, plen = struct.unpack(_HEADER, raw_bytes[:XT_HEADER_SIZE])
        if magic != XT_MAGIC or ver != XT_VERSION or len(raw_bytes) < XT_HEADER_SIZE + plen:
            return None
        payload = raw_bytes[XT_HEADER_SIZE : XT_HEADER_SIZE + plen]
        return {"opcode": opcode, "flags": flags, "timestamp": ts, "payload": payload}

    # -- Conversation (host bridge profile) ---------------------------------
    # Device -> host: REGISTER name, HEARTBEAT [status], BROADCAST text,
    # DIRECT_MSG [to_len][to][text], STATE_QUERY. Host -> device: BROADCAST /
    # DIRECT_MSG as [from_len][from][text]; LOCK_* frames carry packed XDialect.

    @staticmethod
    def pack_register(name: str) -> bytes:
        """REGISTER: the device's agent name (<= 32 bytes). Send it first."""
        data = name.encode("utf-8")
        if not data or len(data) > XT_MAX_NAME_LEN:
            raise ValueError("name must be 1-%d bytes" % XT_MAX_NAME_LEN)
        return _frame(OP_REGISTER, data)

    @staticmethod
    def pack_text(text: str) -> bytes:
        """BROADCAST: a chat message to everyone in the conversation."""
        data = text.encode("utf-8")
        if not data:
            raise ValueError("text must not be empty")
        if _is_packed_action(data[0]):
            raise ValueError("text must not start with a control byte the bridge reads as shorthand")
        return _frame(OP_BROADCAST, data)

    @staticmethod
    def pack_dm(to: str, text: str, reply_expected: bool = True) -> bytes:
        """DIRECT_MSG to a channel-mate (agent name or id)."""
        to_bytes = to.encode("utf-8")
        text_bytes = text.encode("utf-8")
        if not to_bytes or len(to_bytes) > XT_MAX_NAME_LEN or not text_bytes:
            raise ValueError("to must be 1-%d bytes and text non-empty" % XT_MAX_NAME_LEN)
        payload = bytes([len(to_bytes)]) + to_bytes + text_bytes
        return _frame(OP_DIRECT_MSG, payload, FLAG_ACK_REQUESTED if reply_expected else 0)

    @staticmethod
    def pack_heartbeat(status: str = "") -> bytes:
        """HEARTBEAT; optional status text becomes the agent's current task."""
        return _frame(OP_HEARTBEAT, status.encode("utf-8"))

    @staticmethod
    def pack_state_query() -> bytes:
        """STATE_QUERY; the reply payload is "members=N locks=M"."""
        return _frame(OP_STATE_QUERY, b"")

    @staticmethod
    def unpack_attributed(payload: bytes):
        """Host BROADCAST / DIRECT_MSG payload -> (sender, text), or None if malformed."""
        if len(payload) < 1 or len(payload) < 1 + payload[0]:
            return None
        n = payload[0]
        return _text(payload[1 : 1 + n]), _text(payload[1 + n :])

    @staticmethod
    def unpack_packed(payload: bytes):
        """Packed XDialect payload of LOCK_* frames -> dict, or None if truncated."""
        if len(payload) < 7:
            return None
        action, intent, flow, ttl, tlen = struct.unpack(">BBBHB", payload[:6])
        reason_at = 6 + tlen
        if reason_at >= len(payload) or reason_at + 1 + payload[reason_at] > len(payload):
            return None
        rlen = payload[reason_at]
        return {
            "action": action, "intent": intent, "flow": flow, "ttl": ttl,
            "target": _text(payload[6:reason_at]),
            "reason": _text(payload[reason_at + 1 : reason_at + 1 + rlen]),
        }


class FrameReader:
    """Splits a byte stream (UART, socket) into frames: [len:2 BE][frame].

    Feed it whatever bytes arrive; it returns complete, valid frames as dicts
    (see CrossTalkMicro.unpack_frame). If a prefix is impossible (shorter than
    a header, or not followed by 'X' v1), it drops one byte and resyncs, so
    line noise at boot cannot stall the stream. A well-formed frame larger than
    max_frame is skipped whole, so its payload is never misread as frames.
    """

    def __init__(self, max_frame: int = XT_MAX_PACKET_SIZE):
        self.max_frame = max_frame
        self.buf = bytearray()
        self.skip = 0  # bytes left of an oversized frame being discarded

    def feed(self, data: bytes):
        self.buf.extend(data)
        frames = []
        while True:
            if self.skip:
                n = min(self.skip, len(self.buf))
                self.buf = self.buf[n:]
                self.skip -= n
                if self.skip:
                    break
            if len(self.buf) < 2:
                break
            n = (self.buf[0] << 8) | self.buf[1]
            if n < XT_HEADER_SIZE or (len(self.buf) >= 4 and (self.buf[2] != XT_MAGIC or self.buf[3] != XT_VERSION)):
                self.buf = self.buf[1:]
                continue
            if n > self.max_frame:
                if len(self.buf) < 4:
                    break  # need the magic/version bytes to tell a big frame from noise
                self.skip = 2 + n
                continue
            if len(self.buf) < 2 + n:
                break
            frame = CrossTalkMicro.unpack_frame(bytes(self.buf[2 : 2 + n]))
            if frame is None:
                self.buf = self.buf[1:]
                continue
            self.buf = self.buf[2 + n :]
            frames.append(frame)
        return frames

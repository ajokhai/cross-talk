/**
 * Arduino / ESP32 CrossTalk Node
 *
 * Joins a CrossTalk conversation through the host bridge over USB serial (or
 * Bluetooth SPP on ESP32), introduces itself, posts a reading, claims and
 * releases a file lock, and prints what other agents say.
 *
 * On the host, point the bridge at this device and a conversation address:
 *   crosstalk-bridge --channel xt_... --serial /dev/tty.usbserial-0001
 *
 * No heap use; one 128-byte receive buffer.
 */

#include "crosstalk_micro.h"

#ifdef ESP32
#include "BluetoothSerial.h"
BluetoothSerial SerialBT;
#define LINK SerialBT      // frames go over Bluetooth; USB Serial is the debug log
#else
#define LINK Serial        // frames and the debug log share USB Serial (log is noise to the bridge,
                           // which resyncs past it; use a second UART for a clean log)
#endif

static const char* DEVICE_NAME = "esp32-imu";

void setup() {
    Serial.begin(115200);
#ifdef ESP32
    SerialBT.begin("CrossTalk-ESP32-Node");
    Serial.println("CrossTalk node ready on Bluetooth. Pair it with the host running crosstalk-bridge.");
#endif
    delay(500);

    // 1. REGISTER must be the first frame (the bridge waits ~2 s for it).
    CrossTalkMicro::registerName(LINK, DEVICE_NAME);

    // 2. Say hello, then claim the calibration file while we work on it.
    CrossTalkMicro::say(LINK, "IMU online, starting calibration");
    CrossTalkMicro::claimLock(LINK, "src/calibration.h", XT_INTENT_FEAT, "Calibrating IMU sensor", 60);
}

/* Prints a host -> device frame in a readable form. */
static void printFrame(const xt_frame_t& frame) {
    const char* from;
    const char* text;
    uint8_t fromLen;
    uint16_t textLen;
    xt_packed_t packed;

    if (xt_decode_attributed(&frame, &from, &fromLen, &text, &textLen) == 0) {
        Serial.print(frame.opcode == XT_OP_DIRECT_MSG ? "[DM] " : "[chat] ");
        Serial.write((const uint8_t*)from, fromLen);
        Serial.print(": ");
        Serial.write((const uint8_t*)text, textLen);
        Serial.println();
        return;
    }

    if (frame.opcode >= XT_OP_LOCK_ACQUIRE && frame.opcode <= XT_OP_LOCK_RELEASE &&
        xt_decode_packed(&frame, &packed) == 0) {
        const char* what =
            frame.opcode == XT_OP_LOCK_ACK ? "lock ok" :
            frame.opcode == XT_OP_LOCK_DENIED ? "lock denied" :
            frame.opcode == XT_OP_LOCK_RELEASE ? "unlocked" :
            (frame.flags & XT_FLAG_CONFLICT) ? "someone wants" : "locked";
        Serial.print("[");
        Serial.print(what);
        Serial.print("] ");
        Serial.write((const uint8_t*)packed.target, packed.target_len);
        if (packed.reason_len) {
            Serial.print(" (");
            Serial.write((const uint8_t*)packed.reason, packed.reason_len);
            Serial.print(")");
        }
        Serial.println();
        return;
    }

    if (frame.opcode == XT_OP_REGISTER && (frame.flags & XT_FLAG_RESPONSE)) {
        Serial.print("[joined] agent id ");
        Serial.write(frame.payload, frame.payload_len);
        Serial.println();
        return;
    }

    if (frame.opcode == XT_OP_STATE_QUERY) {
        Serial.print("[state] ");
        Serial.write(frame.payload, frame.payload_len);
        Serial.println();
    }
}

/* Reads one length-prefixed frame if available. Drops a byte and resyncs when
 * the prefix is impossible, so serial noise cannot wedge the stream. */
static void pollLink() {
    static uint8_t buffer[XT_MAX_PACKET_SIZE];

    if (LINK.available() < 2) return;
    uint8_t hi = LINK.peek();
    if (hi != 0) {           // frames are <= 128 bytes, so the high length byte is 0
        LINK.read();
        return;
    }
    LINK.read();
    uint8_t lo = LINK.read();
    uint16_t frameLen = lo;
    if (frameLen < XT_HEADER_SIZE || frameLen > sizeof(buffer)) return;  // resync on the next byte

    if (LINK.readBytes(buffer, frameLen) != frameLen) return;           // timed out mid-frame
    xt_frame_t frame;
    if (xt_decode_packet(buffer, frameLen, &frame) == 0) printFrame(frame);
}

void loop() {
    static bool released = false;
    static unsigned long lastHeartbeat = 0;

    // After 10 seconds of simulated calibration, report and release the lock.
    if (!released && millis() > 10000) {
        CrossTalkMicro::say(LINK, "Calibration finished: gyro bias 0.02 dps");
        CrossTalkMicro::releaseLock(LINK, "src/calibration.h");
        released = true;
    }

    // Heartbeat every 30 s keeps the status current in the cockpit.
    if (millis() - lastHeartbeat > 30000) {
        CrossTalkMicro::heartbeat(LINK, released ? "idle" : "calibrating");
        lastHeartbeat = millis();
    }

    pollLink();
}

/**
 * Arduino / ESP32 CrossTalk Node
 * Demonstrates an embedded microcontroller agent connecting over Serial or Bluetooth
 * and claiming a file lock on the CrossTalk mesh using only 44 bytes of RAM.
 */

#include "crosstalk_micro.h"

#ifdef ESP32
#include "BluetoothSerial.h"
BluetoothSerial SerialBT;
#define TARGET_SERIAL SerialBT
#else
#define TARGET_SERIAL Serial
#endif

void setup() {
    Serial.begin(115200);

#ifdef ESP32
    SerialBT.begin("CrossTalk-ESP32-Node"); // Bluetooth device name
    Serial.println("CrossTalk Bluetooth Node Ready. Pair with host computer!");
#else
    Serial.println("CrossTalk Arduino Node Ready on Hardware Serial.");
#endif

    delay(2000);

    // 1. Claim lock on sensor calibration firmware using XDialect
    Serial.println("Sending Lock Claim: !LCK @src/calibration.h #FEAT 'Calibrating IMU sensor' &WAIT");
    CrossTalkMicro::claimLock(
        TARGET_SERIAL,
        "src/calibration.h",
        XT_INTENT_FEAT,
        "Calibrating IMU sensor",
        60
    );
}

void loop() {
    static unsigned long lastTime = 0;
    static bool released = false;

    // After 10 seconds of simulated sensor calibration, release the lock
    if (!released && millis() > 10000) {
        Serial.println("Sensor calibration finished. Releasing lock: !REL @src/calibration.h &DONE &PROCEED");
        CrossTalkMicro::releaseLock(TARGET_SERIAL, "src/calibration.h");
        released = true;
    }

    // Read incoming mesh packets from host
    if (TARGET_SERIAL.available() >= XT_HEADER_SIZE) {
        uint8_t buffer[XT_MAX_PACKET_SIZE];
        uint16_t bytesRead = TARGET_SERIAL.readBytes(buffer, TARGET_SERIAL.available());

        xt_frame_t frame;
        if (xt_decode_packet(buffer, bytesRead, &frame) == 0) {
            Serial.print("Received Opcode from Mesh: 0x");
            Serial.println(frame.opcode, HEX);
        }
    }

    delay(100);
}

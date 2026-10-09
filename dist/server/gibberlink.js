export class GibberlinkEngine {
    // Preset frequency plans
    static MODES = {
        audible_fast: {
            baseHz: 1875,
            stepHz: 93.75,
            symbolDurationMs: 15,
            numTones: 16 // 16-FSK (4 bits per symbol)
        },
        audible_standard: {
            baseHz: 1500,
            stepHz: 75,
            symbolDurationMs: 25,
            numTones: 16
        },
        ultrasonic: {
            baseHz: 17000,
            stepHz: 125,
            symbolDurationMs: 20,
            numTones: 16
        }
    };
    /**
     * Encodes text or structured intent into a pure Gibberlink Signal Stream packet.
     * This transmits the exact frequency-shift keying (FSK) audio signals directly
     * over data streams without requiring acoustic audio conversion.
     */
    static encode(input, modeName = 'audible_fast', metadata) {
        const mode = this.MODES[modeName] || this.MODES.audible_fast;
        const text = typeof input === 'string' ? input : JSON.stringify(input);
        const textBytes = Buffer.from(text, 'utf8');
        // Calculate CRC16 for error detection
        const crc = this.computeCrc16(textBytes);
        // Convert bytes into nibbles (4 bits each, values 0-15) for 16-FSK
        const payloadTones = [];
        for (let i = 0; i < textBytes.length; i++) {
            const b = textBytes[i];
            payloadTones.push((b >> 4) & 0x0f); // High nibble
            payloadTones.push(b & 0x0f); // Low nibble
        }
        // Append CRC nibbles (4 nibbles = 16 bits)
        payloadTones.push((crc >> 12) & 0x0f);
        payloadTones.push((crc >> 8) & 0x0f);
        payloadTones.push((crc >> 4) & 0x0f);
        payloadTones.push(crc & 0x0f);
        // Sync preamble tones (Gibberlink acoustic signature)
        const preambleTones = [15, 0, 15, 0];
        const postambleTones = [0, 15];
        // Combine all tone indices
        const allTones = [...preambleTones, ...payloadTones, ...postambleTones];
        // Map each tone index to its physical audio frequency (in Hz)
        const frequencies = allTones.map((toneIdx) => {
            return Math.round((mode.baseHz + toneIdx * mode.stepHz) * 100) / 100;
        });
        const totalDurationMs = allTones.length * mode.symbolDurationMs;
        return {
            protocol: 'gibberlink/signal-stream-v1',
            version: '1.0',
            mode: modeName,
            baseFrequencyHz: mode.baseHz,
            stepFrequencyHz: mode.stepHz,
            symbolDurationMs: mode.symbolDurationMs,
            totalDurationMs,
            preambleTones,
            payloadTones,
            postambleTones,
            frequencies,
            crc,
            rawBytes: Array.from(textBytes),
            text,
            metadata,
            timestamp: Date.now()
        };
    }
    /**
     * Decodes a Gibberlink Signal Stream packet directly back to its original intent/text.
     */
    static decode(packet) {
        try {
            const tones = packet.payloadTones;
            if (!tones || tones.length < 4) {
                return { valid: false, text: '', durationMs: 0, toneCount: 0 };
            }
            // Last 4 nibbles are CRC
            const dataNibbles = tones.slice(0, tones.length - 4);
            const crcNibbles = tones.slice(tones.length - 4);
            const expectedCrc = (crcNibbles[0] << 12) |
                (crcNibbles[1] << 8) |
                (crcNibbles[2] << 4) |
                crcNibbles[3];
            // Reconstruct bytes from nibbles
            const bytes = [];
            for (let i = 0; i < dataNibbles.length; i += 2) {
                const high = dataNibbles[i] || 0;
                const low = dataNibbles[i + 1] || 0;
                bytes.push((high << 4) | low);
            }
            const buf = Buffer.from(bytes);
            const computedCrc = this.computeCrc16(buf);
            const valid = computedCrc === expectedCrc;
            const text = buf.toString('utf8');
            let data = undefined;
            try {
                data = JSON.parse(text);
            }
            catch { }
            return {
                valid,
                text,
                data,
                toneCount: packet.frequencies.length,
                durationMs: packet.totalDurationMs
            };
        }
        catch (err) {
            return { valid: false, text: '', durationMs: 0, toneCount: 0 };
        }
    }
    /**
     * Generates a raw PCM audio buffer (Float32Array) from the signal packet.
     * Allows synthesizing the exact Gibberlink acoustic modem sound on demand.
     */
    static synthesizePcm(packet, sampleRate = 44100) {
        const symbolSamples = Math.floor((sampleRate * packet.symbolDurationMs) / 1000);
        const totalSamples = symbolSamples * packet.frequencies.length;
        const buffer = new Float32Array(totalSamples);
        let sampleOffset = 0;
        for (const freq of packet.frequencies) {
            const angularFreq = 2 * Math.PI * freq;
            for (let s = 0; s < symbolSamples; s++) {
                const t = s / sampleRate;
                // Smooth Tukey / Hanning window envelope to avoid clicks between tones
                const window = 0.5 * (1 - Math.cos((2 * Math.PI * s) / (symbolSamples - 1 || 1)));
                const sampleValue = Math.sin(angularFreq * t) * window * 0.7;
                buffer[sampleOffset + s] = sampleValue;
            }
            sampleOffset += symbolSamples;
        }
        return buffer;
    }
    /**
     * CRC-16-CCITT implementation for signal packet integrity
     */
    static computeCrc16(buffer) {
        let crc = 0xffff;
        for (let i = 0; i < buffer.length; i++) {
            crc ^= buffer[i] << 8;
            for (let j = 0; j < 8; j++) {
                if ((crc & 0x8000) !== 0) {
                    crc = ((crc << 1) ^ 0x1021) & 0xffff;
                }
                else {
                    crc = (crc << 1) & 0xffff;
                }
            }
        }
        return crc & 0xffff;
    }
}

export interface GibberlinkSignalPacket {
    protocol: 'gibberlink/signal-stream-v1';
    version: '1.0';
    mode: 'audible_fast' | 'audible_standard' | 'ultrasonic';
    baseFrequencyHz: number;
    stepFrequencyHz: number;
    symbolDurationMs: number;
    totalDurationMs: number;
    preambleTones: number[];
    payloadTones: number[];
    postambleTones: number[];
    frequencies: number[];
    crc: number;
    rawBytes: number[];
    text: string;
    metadata?: Record<string, any>;
    timestamp: number;
}
export interface GibberlinkDecodeResult {
    valid: boolean;
    text: string;
    data?: any;
    toneCount: number;
    durationMs: number;
}
export declare class GibberlinkEngine {
    private static MODES;
    /**
     * Encodes text or structured intent into a pure Gibberlink Signal Stream packet.
     * This transmits the exact frequency-shift keying (FSK) audio signals directly
     * over data streams without requiring acoustic audio conversion.
     */
    static encode(input: string | object, modeName?: 'audible_fast' | 'audible_standard' | 'ultrasonic', metadata?: Record<string, any>): GibberlinkSignalPacket;
    /**
     * Decodes a Gibberlink Signal Stream packet directly back to its original intent/text.
     */
    static decode(packet: GibberlinkSignalPacket): GibberlinkDecodeResult;
    /**
     * Generates a raw PCM audio buffer (Float32Array) from the signal packet.
     * Allows synthesizing the exact Gibberlink acoustic modem sound on demand.
     */
    static synthesizePcm(packet: GibberlinkSignalPacket, sampleRate?: number): Float32Array;
    /**
     * CRC-16-CCITT implementation for signal packet integrity
     */
    private static computeCrc16;
}

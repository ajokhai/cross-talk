import { DialectDictionary } from './dictionary.js';
export interface ParsedDialectMessage {
    action?: string;
    target?: string;
    intent?: string;
    reason?: string;
    ttl?: number;
    recipient?: string;
    flow?: string[];
    rawShorthand: string;
}
export declare class DialectEngine {
    private static dictionary;
    static getDictionary(): DialectDictionary;
    /**
     * Parses a concise shorthand string into a structured dialect message.
     * Format: <ACTION> [@<FILE>] [#<INTENT>] ["<REASON>"] [~<TTL>] [^<RECIPIENT>] [&<FLOW>...]
     */
    static parse(shorthand: string): ParsedDialectMessage;
    /**
     * Reversibly translates shorthand into natural, fluid human-readable English.
     */
    static toHuman(input: string | ParsedDialectMessage): string;
    /**
     * Expands concise XDialect shorthand into natural Chinese (中文支持).
     */
    static toChinese(shorthand: string): string;
    /**
     * Compiles natural human English or Chinese statements into concise XDialect shorthand.
     */
    static fromHuman(text: string): string;
    /**
     * Packs shorthand expression into ultra-compact binary bitstream bytes (15-30 bytes).
     *
     * Bit Layout:
     * [0] Action numeric ID (0x10..0x15)
     * [1] Intent numeric ID (0x30..0x37)
     * [2] Flow flags bitfield (bit0=&WAIT, bit1=&ACK, bit2=&DONE, bit3=&PROCEED)
     * [3..4] TTL in seconds (uint16)
     * [5] Target string length (uint8)
     * [6..N] Target UTF-8 bytes
     * [N+1] Reason string length (uint8)
     * [N+2..M] Reason UTF-8 bytes
     */
    static packToBits(input: string | ParsedDialectMessage): Buffer;
    /**
     * Unpacks a compact binary bitstream buffer back into structured AST, shorthand, and English.
     */
    static unpackFromBits(buf: Buffer): {
        parsed: ParsedDialectMessage;
        shorthand: string;
        human: string;
    };
}

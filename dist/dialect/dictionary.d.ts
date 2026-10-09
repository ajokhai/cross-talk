/**
 * XDialect v1.0.0 — Shared Versioned Token Dictionary for AI Agent Inter-Communication
 *
 * Compresses complex coordination intents into hyper-concise, lossless tokens
 * that can be bit-packed on the wire and losslessly translated into natural English.
 */
export interface DialectToken {
    code: string;
    numericId: number;
    category: 'action' | 'intent' | 'modifier' | 'flow';
    meaning: string;
    humanTemplate: string;
    zhMeaning?: string;
    zhTemplate?: string;
}
export interface DialectDictionary {
    version: string;
    name: string;
    checksum: string;
    updatedAt: string;
    tokens: Record<string, DialectToken>;
    grammar: {
        format: string;
        examples: Array<{
            shorthand: string;
            human: string;
            meaning: string;
            zh?: string;
        }>;
    };
}
export declare const DIALECT_V1: DialectDictionary;

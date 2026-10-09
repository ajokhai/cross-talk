import { DIALECT_V1, DialectDictionary, DialectToken } from './dictionary.js';

export interface ParsedDialectMessage {
  action?: string;        // e.g. '!LCK'
  target?: string;        // e.g. 'src/auth.ts'
  intent?: string;        // e.g. '#REF'
  reason?: string;        // e.g. 'jwt validation'
  ttl?: number;           // e.g. 180
  recipient?: string;     // e.g. 'Agent-2'
  flow?: string[];        // e.g. ['&WAIT']
  rawShorthand: string;
}

export class DialectEngine {
  private static dictionary: DialectDictionary = DIALECT_V1;

  public static getDictionary(): DialectDictionary {
    return this.dictionary;
  }

  /**
   * Parses a concise shorthand string into a structured dialect message.
   * Format: <ACTION> [@<FILE>] [#<INTENT>] ["<REASON>"] [~<TTL>] [^<RECIPIENT>] [&<FLOW>...]
   */
  public static parse(shorthand: string): ParsedDialectMessage {
    const trimmed = shorthand.trim();
    const result: ParsedDialectMessage = {
      rawShorthand: trimmed,
      flow: []
    };

    // Extract quoted reason first if present
    let working = trimmed;
    const quoteMatch = working.match(/"([^"]+)"|'([^']+)'/);
    if (quoteMatch) {
      result.reason = quoteMatch[1] || quoteMatch[2];
      working = working.replace(quoteMatch[0], ' ');
    }

    const tokens = working.split(/\s+/).filter(Boolean);

    for (const tok of tokens) {
      if (tok.startsWith('!')) {
        result.action = tok.toUpperCase();
      } else if (tok.startsWith('@')) {
        result.target = tok.slice(1);
      } else if (tok.startsWith('#')) {
        result.intent = tok.toUpperCase();
      } else if (tok.startsWith('~')) {
        result.ttl = parseInt(tok.slice(1), 10) || 300;
      } else if (tok.startsWith('^')) {
        result.recipient = tok.slice(1);
      } else if (tok.startsWith('&')) {
        result.flow?.push(tok.toUpperCase());
      } else if (!result.reason && !tok.startsWith('?') && !tok.startsWith('!')) {
        result.reason = tok;
      } else if (tok.startsWith('?')) {
        result.action = tok.toUpperCase();
      }
    }

    return result;
  }

  /**
   * Reversibly translates shorthand into natural, fluid human-readable English.
   */
  public static toHuman(input: string | ParsedDialectMessage): string {
    const parsed = typeof input === 'string' ? this.parse(input) : input;
    const parts: string[] = [];

    const targetStr = parsed.target ? `"${parsed.target}"` : 'the file';
    const reasonStr = parsed.reason ? `("${parsed.reason}")` : '';

    const intentDesc = parsed.intent && this.dictionary.tokens[parsed.intent]
      ? this.dictionary.tokens[parsed.intent].humanTemplate
      : parsed.intent ? parsed.intent.slice(1).toLowerCase() : '';

    switch (parsed.action) {
      case '!LCK': {
        const intentPart = intentDesc ? `, ${intentDesc} ${reasonStr}` : (reasonStr ? ` to ${reasonStr}` : '');
        parts.push(`I am editing ${targetStr}${intentPart}.`);
        if (parsed.ttl) {
          parts.push(`(Holding lock for ${parsed.ttl}s).`);
        }
        break;
      }

      case '!REL': {
        parts.push(`Finished editing ${targetStr}. Lock released and ready for others.`);
        break;
      }

      case '!BCST': {
        parts.push(`Announcement: ${parsed.reason || 'General broadcast'}.`);
        break;
      }

      case '!DM': {
        const to = parsed.recipient ? `to ${parsed.recipient}` : '';
        parts.push(`Direct message ${to}: ${parsed.reason || ''}.`);
        break;
      }

      case '!WARN': {
        parts.push(`Warning: Collision on ${targetStr}! Currently locked.`);
        break;
      }

      case '!PASS': {
        parts.push(`Handoff: Passing ${targetStr} to ${parsed.recipient || 'next agent'} (${parsed.reason || ''}).`);
        break;
      }

      case '?WHO': {
        parts.push('Checking which agents are currently active on the channel.');
        break;
      }

      case '?LOCKS': {
        parts.push('Querying currently held file locks.');
        break;
      }

      default: {
        if (parsed.reason) parts.push(parsed.reason);
      }
    }

    // Append flow modifiers (e.g. &WAIT -> "Hang on for me to finish before touching it.")
    if (parsed.flow && parsed.flow.length > 0) {
      for (const f of parsed.flow) {
        const token = this.dictionary.tokens[f];
        if (token) {
          parts.push(token.humanTemplate);
        }
      }
    }

    return parts.join(' ');
  }

  /**
   * Compiles natural English statements into concise XDialect shorthand.
   */
  public static fromHuman(text: string): string {
    const lower = text.toLowerCase();
    const tokens: string[] = [];

    // Detect file path
    const fileMatch = text.match(/(?:file|path|editing|touching|modify)\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/i) ||
                      text.match(/([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/);
    const file = fileMatch ? fileMatch[1] : null;

    // Detect action
    if (lower.includes('lock') || lower.includes('editing') || lower.includes("i'm editing") || lower.includes('modifying')) {
      tokens.push('!LCK');
    } else if (lower.includes('release') || lower.includes('unlock') || lower.includes('finished editing')) {
      tokens.push('!REL');
    } else if (lower.includes('who is')) {
      tokens.push('?WHO');
    } else if (lower.includes('what files') || lower.includes('check locks')) {
      tokens.push('?LOCKS');
    } else {
      tokens.push('!BCST');
    }

    if (file) {
      tokens.push(`@${file}`);
    }

    // Detect intent
    if (lower.includes('refactor')) tokens.push('#REF');
    else if (lower.includes('fix') || lower.includes('bug')) tokens.push('#FIX');
    else if (lower.includes('feature') || lower.includes('add')) tokens.push('#FEAT');
    else if (lower.includes('test')) tokens.push('#TEST');
    else if (lower.includes('migrate') || lower.includes('migration')) tokens.push('#MIG');

    // Detect wait / hang on flow
    if (lower.includes('hang on') || lower.includes('wait') || lower.includes("don't touch") || lower.includes('hold off')) {
      tokens.push('&WAIT');
    }
    if (lower.includes('done') || lower.includes('finished')) {
      tokens.push('&DONE');
    }
    if (lower.includes('proceed') || lower.includes('clear')) {
      tokens.push('&PROCEED');
    }

    return tokens.join(' ');
  }

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
  public static packToBits(input: string | ParsedDialectMessage): Buffer {
    const parsed = typeof input === 'string' ? this.parse(input) : input;

    const actionTok = parsed.action ? this.dictionary.tokens[parsed.action] : null;
    const actionId = actionTok ? actionTok.numericId : 0x00;

    const intentTok = parsed.intent ? this.dictionary.tokens[parsed.intent] : null;
    const intentId = intentTok ? intentTok.numericId : 0x00;

    let flowBits = 0;
    if (parsed.flow?.includes('&WAIT')) flowBits |= 1 << 0;
    if (parsed.flow?.includes('&ACK')) flowBits |= 1 << 1;
    if (parsed.flow?.includes('&DONE')) flowBits |= 1 << 2;
    if (parsed.flow?.includes('&PROCEED')) flowBits |= 1 << 3;

    const ttl = parsed.ttl || 300;
    const targetBuf = Buffer.from(parsed.target || '', 'utf8');
    const reasonBuf = Buffer.from(parsed.reason || '', 'utf8');

    const totalLen = 5 + 1 + targetBuf.length + 1 + reasonBuf.length;
    const buf = Buffer.alloc(totalLen);

    buf.writeUInt8(actionId, 0);
    buf.writeUInt8(intentId, 1);
    buf.writeUInt8(flowBits, 2);
    buf.writeUInt16BE(ttl, 3);

    buf.writeUInt8(targetBuf.length, 5);
    targetBuf.copy(buf, 6);

    const reasonOffset = 6 + targetBuf.length;
    buf.writeUInt8(reasonBuf.length, reasonOffset);
    reasonBuf.copy(buf, reasonOffset + 1);

    return buf;
  }

  /**
   * Unpacks a compact binary bitstream buffer back into structured AST, shorthand, and English.
   */
  public static unpackFromBits(buf: Buffer): { parsed: ParsedDialectMessage; shorthand: string; human: string } {
    if (buf.length < 7) {
      return {
        parsed: { rawShorthand: '' },
        shorthand: '',
        human: ''
      };
    }

    const actionId = buf.readUInt8(0);
    const intentId = buf.readUInt8(1);
    const flowBits = buf.readUInt8(2);
    const ttl = buf.readUInt16BE(3);

    const targetLen = buf.readUInt8(5);
    const target = buf.subarray(6, 6 + targetLen).toString('utf8');

    const reasonOffset = 6 + targetLen;
    const reasonLen = reasonOffset < buf.length ? buf.readUInt8(reasonOffset) : 0;
    const reason = reasonOffset + 1 + reasonLen <= buf.length
      ? buf.subarray(reasonOffset + 1, reasonOffset + 1 + reasonLen).toString('utf8')
      : '';

    // Find token codes by numeric ID
    let actionCode: string | undefined;
    let intentCode: string | undefined;

    for (const [code, tok] of Object.entries(this.dictionary.tokens)) {
      if (tok.numericId === actionId) actionCode = code;
      if (tok.numericId === intentId) intentCode = code;
    }

    const flow: string[] = [];
    if (flowBits & (1 << 0)) flow.push('&WAIT');
    if (flowBits & (1 << 1)) flow.push('&ACK');
    if (flowBits & (1 << 2)) flow.push('&DONE');
    if (flowBits & (1 << 3)) flow.push('&PROCEED');

    // Build canonical shorthand
    const parts: string[] = [];
    if (actionCode) parts.push(actionCode);
    if (target) parts.push(`@${target}`);
    if (intentCode) parts.push(intentCode);
    if (reason) parts.push(`"${reason}"`);
    if (ttl && ttl !== 300) parts.push(`~${ttl}`);
    flow.forEach(f => parts.push(f));

    const shorthand = parts.join(' ');
    const parsed: ParsedDialectMessage = {
      action: actionCode,
      target: target || undefined,
      intent: intentCode,
      reason: reason || undefined,
      ttl,
      flow,
      rawShorthand: shorthand
    };

    const human = this.toHuman(parsed);
    return { parsed, shorthand, human };
  }
}

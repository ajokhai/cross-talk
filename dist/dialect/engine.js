import { DIALECT_V1 } from './dictionary.js';
export class DialectEngine {
    static dictionary = DIALECT_V1;
    static getDictionary() {
        return this.dictionary;
    }
    /**
     * Parses a concise shorthand string into a structured dialect message.
     * Format: <ACTION> [@<FILE>] [#<INTENT>] ["<REASON>"] [~<TTL>] [^<RECIPIENT>] [&<FLOW>...]
     */
    static parse(shorthand) {
        const trimmed = shorthand.trim();
        const result = {
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
            }
            else if (tok.startsWith('@')) {
                result.target = tok.slice(1);
            }
            else if (tok.startsWith('#')) {
                result.intent = tok.toUpperCase();
            }
            else if (tok.startsWith('~')) {
                result.ttl = parseInt(tok.slice(1), 10) || 300;
            }
            else if (tok.startsWith('^')) {
                result.recipient = tok.slice(1);
            }
            else if (tok.startsWith('&')) {
                result.flow?.push(tok.toUpperCase());
            }
            else if (!result.reason && !tok.startsWith('?') && !tok.startsWith('!')) {
                result.reason = tok;
            }
            else if (tok.startsWith('?')) {
                result.action = tok.toUpperCase();
            }
        }
        return result;
    }
    /**
     * Reversibly translates shorthand into natural, fluid human-readable English.
     */
    static toHuman(input) {
        const parsed = typeof input === 'string' ? this.parse(input) : input;
        const parts = [];
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
                if (parsed.reason)
                    parts.push(parsed.reason);
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
     * Expands concise XDialect shorthand into natural Chinese (中文支持).
     */
    static toChinese(shorthand) {
        const parsed = this.parse(shorthand);
        if (!parsed)
            return shorthand;
        const parts = [];
        const targetStr = parsed.target ? `"${parsed.target}"` : '';
        const reasonStr = parsed.reason ? `（${parsed.reason}）` : '';
        let intentDesc = '';
        if (parsed.intent) {
            const token = this.dictionary.tokens[parsed.intent];
            intentDesc = token?.zhMeaning || token?.meaning || parsed.intent;
        }
        switch (parsed.action) {
            case '!LCK': {
                const intentPart = intentDesc ? `，进行${intentDesc}${reasonStr}` : (reasonStr ? `进行${reasonStr}` : '');
                parts.push(`正在编辑 ${targetStr}${intentPart}。`);
                if (parsed.ttl) {
                    parts.push(`（保持锁定 ${parsed.ttl} 秒）。`);
                }
                break;
            }
            case '!REL': {
                parts.push(`已完成对 ${targetStr} 的修改。文件锁已释放，其他智能体可安全编辑。`);
                break;
            }
            case '!BCST': {
                parts.push(`广播公告：${parsed.reason || '通用消息'}。`);
                break;
            }
            case '!DM': {
                const to = parsed.recipient ? `发给 ${parsed.recipient}` : '';
                parts.push(`定向私信${to}：${parsed.reason || ''}。`);
                break;
            }
            case '!WARN': {
                parts.push(`冲突警报：文件 ${targetStr} 已被其他智能体锁定！请勿修改。`);
                break;
            }
            case '!PASS': {
                parts.push(`任务移交：将文件 ${targetStr} 移交给 ${parsed.recipient || '下一智能体'}（${parsed.reason || ''}）。`);
                break;
            }
            case '?WHO': {
                parts.push('正在查询网络中当前活跃的智能体。');
                break;
            }
            case '?LOCKS': {
                parts.push('正在查询当前所有被锁定的文件状态。');
                break;
            }
            default: {
                if (parsed.reason)
                    parts.push(parsed.reason);
            }
        }
        // Append Chinese flow modifiers (e.g. &WAIT -> "请稍候，等我修改完成再操作。")
        if (parsed.flow && parsed.flow.length > 0) {
            for (const f of parsed.flow) {
                const token = this.dictionary.tokens[f];
                if (token && token.zhTemplate) {
                    parts.push(token.zhTemplate);
                }
                else if (token) {
                    parts.push(token.humanTemplate);
                }
            }
        }
        return parts.join(' ');
    }
    /**
     * Compiles natural human English or Chinese statements into concise XDialect shorthand.
     */
    static fromHuman(text) {
        const lower = text.toLowerCase();
        const tokens = [];
        // Detect file path
        const fileMatch = text.match(/(?:file|path|editing|touching|modify|修改|编辑|锁定|文件)\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/i) ||
            text.match(/([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/);
        const file = fileMatch ? fileMatch[1] : null;
        // Detect action (English & Chinese)
        if (lower.includes('lock') || lower.includes('editing') || lower.includes("i'm editing") || lower.includes('modifying') ||
            text.includes('锁定') || text.includes('正在修改') || text.includes('正在编辑')) {
            tokens.push('!LCK');
        }
        else if (lower.includes('release') || lower.includes('unlock') || lower.includes('finished editing') ||
            text.includes('释放') || text.includes('解锁') || text.includes('修改完成') || text.includes('改完了')) {
            tokens.push('!REL');
        }
        else if (lower.includes('who is') || lower.includes('who is active') || text.includes('谁在') || text.includes('活跃')) {
            tokens.push('?WHO');
        }
        else if (lower.includes('what files') || lower.includes('check locks') || text.includes('锁') || text.includes('占用')) {
            tokens.push('?LOCKS');
        }
        else {
            tokens.push('!BCST');
        }
        if (file) {
            tokens.push(`@${file}`);
        }
        // Detect intent (English & Chinese)
        if (lower.includes('refactor') || text.includes('重构'))
            tokens.push('#REF');
        else if (lower.includes('fix') || lower.includes('bug') || text.includes('修复') || text.includes('bug') || text.includes('缺陷'))
            tokens.push('#FIX');
        else if (lower.includes('feature') || lower.includes('add') || text.includes('功能') || text.includes('开发') || text.includes('新增'))
            tokens.push('#FEAT');
        else if (lower.includes('test') || text.includes('测试'))
            tokens.push('#TEST');
        else if (lower.includes('migrate') || lower.includes('migration') || text.includes('迁移'))
            tokens.push('#MIG');
        // Detect wait / hang on flow (English & Chinese)
        if (lower.includes('hang on') || lower.includes('wait') || lower.includes("don't touch") || lower.includes('hold off') ||
            text.includes('等我') || text.includes('稍等') || text.includes('别碰') || text.includes('请稍候') || text.includes('先别改')) {
            tokens.push('&WAIT');
        }
        if (lower.includes('done') || lower.includes('finished') || text.includes('完成') || text.includes('好了')) {
            tokens.push('&DONE');
        }
        if (lower.includes('proceed') || lower.includes('clear') || text.includes('可以继续') || text.includes('可以开始')) {
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
    static packToBits(input) {
        const parsed = typeof input === 'string' ? this.parse(input) : input;
        const actionTok = parsed.action ? this.dictionary.tokens[parsed.action] : null;
        const actionId = actionTok ? actionTok.numericId : 0x00;
        const intentTok = parsed.intent ? this.dictionary.tokens[parsed.intent] : null;
        const intentId = intentTok ? intentTok.numericId : 0x00;
        let flowBits = 0;
        if (parsed.flow?.includes('&WAIT'))
            flowBits |= 1 << 0;
        if (parsed.flow?.includes('&ACK'))
            flowBits |= 1 << 1;
        if (parsed.flow?.includes('&DONE'))
            flowBits |= 1 << 2;
        if (parsed.flow?.includes('&PROCEED'))
            flowBits |= 1 << 3;
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
    static unpackFromBits(buf) {
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
        let actionCode;
        let intentCode;
        for (const [code, tok] of Object.entries(this.dictionary.tokens)) {
            if (tok.numericId === actionId)
                actionCode = code;
            if (tok.numericId === intentId)
                intentCode = code;
        }
        const flow = [];
        if (flowBits & (1 << 0))
            flow.push('&WAIT');
        if (flowBits & (1 << 1))
            flow.push('&ACK');
        if (flowBits & (1 << 2))
            flow.push('&DONE');
        if (flowBits & (1 << 3))
            flow.push('&PROCEED');
        // Build canonical shorthand
        const parts = [];
        if (actionCode)
            parts.push(actionCode);
        if (target)
            parts.push(`@${target}`);
        if (intentCode)
            parts.push(intentCode);
        if (reason)
            parts.push(`"${reason}"`);
        if (ttl && ttl !== 300)
            parts.push(`~${ttl}`);
        flow.forEach(f => parts.push(f));
        const shorthand = parts.join(' ');
        const parsed = {
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

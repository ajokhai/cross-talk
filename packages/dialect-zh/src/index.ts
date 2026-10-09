import { DialectEngine, DIALECT_V1 } from 'cross-talk';

/**
 * XDialect Chinese mode (中文支持): expands shorthand into natural Chinese and
 * compiles Chinese statements into shorthand. Parsing and English stay in
 * cross-talk's DialectEngine; this package only adds the Chinese strings.
 */

export interface ZhToken {
  zhMeaning: string;     // Canonical Chinese description (中文说明)
  zhTemplate: string;    // Chinese expansion template (中文展开模板)
}

/** Chinese strings for the XDialect v1 tokens, keyed by token code. */
export const ZH_TOKENS: Record<string, ZhToken> = {
  // Actions
  '!LCK': { zhMeaning: '申请文件独占锁', zhTemplate: '申请独占锁定文件 {target} 进行{intent}：“{reason}”。' },
  '!REL': { zhMeaning: '释放文件锁', zhTemplate: '已释放文件 {target} 的锁，其他智能体可安全编辑。' },
  '!BCST': { zhMeaning: '全网广播公告', zhTemplate: '向网络中所有智能体广播：“{reason}”。' },
  '!DM': { zhMeaning: '定向私信发送', zhTemplate: '发送私信给智能体 {recipient}：“{reason}”。' },
  '!WARN': { zhMeaning: '文件冲突警告', zhTemplate: '冲突警告：文件 {target} 当前已被锁定！请稍等。' },
  '!PASS': { zhMeaning: '移交任务与文件锁', zhTemplate: '将文件 {target} 移交给智能体 {recipient}，说明：“{reason}”。' },

  // Intents
  '#REF': { zhMeaning: '代码重构', zhTemplate: '重构代码' },
  '#FEAT': { zhMeaning: '新功能开发', zhTemplate: '实现新功能' },
  '#FIX': { zhMeaning: '修复缺陷', zhTemplate: '修复错误缺陷' },
  '#TEST': { zhMeaning: '测试用例执行', zhTemplate: '编写或运行测试' },
  '#BLD': { zhMeaning: '代码编译与构建', zhTemplate: '编译构建项目' },
  '#MIG': { zhMeaning: '数据结构迁移', zhTemplate: '数据库或协议迁移' },
  '#REV': { zhMeaning: '代码审查', zhTemplate: '审查代码' },
  '#DOC': { zhMeaning: '文档更新', zhTemplate: '编写文档与注释' },

  // Flow control
  '&WAIT': { zhMeaning: '等我完成再修改', zhTemplate: '请稍候，等我修改完成再操作。' },
  '&ACK': { zhMeaning: '已收到，暂不修改', zhTemplate: '已确认，暂停修改并保持等待。' },
  '&DONE': { zhMeaning: '工作完成', zhTemplate: '操作已完成。' },
  '&PROCEED': { zhMeaning: '可以继续操作', zhTemplate: '其他智能体现在可以继续推进。' }
};

const CJK = /[㐀-鿿]/;

/**
 * Expands concise XDialect shorthand into natural Chinese (中文支持).
 */
export function toChinese(shorthand: string): string {
  const parsed = DialectEngine.parse(shorthand);

  const parts: string[] = [];
  const targetStr = parsed.target ? `"${parsed.target}"` : '';
  const reasonStr = parsed.reason ? `（${parsed.reason}）` : '';

  let intentDesc = '';
  if (parsed.intent) {
    intentDesc = ZH_TOKENS[parsed.intent]?.zhMeaning || DIALECT_V1.tokens[parsed.intent]?.meaning || parsed.intent;
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
      if (parsed.reason) parts.push(parsed.reason);
    }
  }

  // Append Chinese flow modifiers (e.g. &WAIT -> "请稍候，等我修改完成再操作。")
  for (const f of parsed.flow ?? []) {
    const zh = ZH_TOKENS[f]?.zhTemplate;
    if (zh) {
      parts.push(zh);
    } else if (DIALECT_V1.tokens[f]) {
      parts.push(DIALECT_V1.tokens[f].humanTemplate);
    }
  }

  return parts.join(' ');
}

/**
 * Compiles a Chinese statement into concise XDialect shorthand. Text without
 * Chinese characters is handed to DialectEngine.fromHuman.
 */
export function fromChinese(text: string): string {
  if (!CJK.test(text)) return DialectEngine.fromHuman(text);

  const lower = text.toLowerCase();
  const tokens: string[] = [];

  // Detect file path
  const fileMatch = text.match(/(?:修改|编辑|锁定|文件)\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/i) ||
                    text.match(/([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/);
  const file = fileMatch ? fileMatch[1] : null;

  // Detect action
  if (text.includes('锁定') || text.includes('正在修改') || text.includes('正在编辑')) {
    tokens.push('!LCK');
  } else if (text.includes('释放') || text.includes('解锁') || text.includes('修改完成') || text.includes('改完了')) {
    tokens.push('!REL');
  } else if (text.includes('谁在') || text.includes('活跃')) {
    tokens.push('?WHO');
  } else if (text.includes('锁') || text.includes('占用')) {
    tokens.push('?LOCKS');
  } else {
    tokens.push('!BCST');
  }

  if (file) {
    tokens.push(`@${file}`);
  }

  // Detect intent
  if (text.includes('重构')) tokens.push('#REF');
  else if (text.includes('修复') || lower.includes('bug') || text.includes('缺陷')) tokens.push('#FIX');
  else if (text.includes('功能') || text.includes('开发') || text.includes('新增')) tokens.push('#FEAT');
  else if (text.includes('测试')) tokens.push('#TEST');
  else if (text.includes('迁移')) tokens.push('#MIG');

  // Detect flow
  if (text.includes('等我') || text.includes('稍等') || text.includes('别碰') || text.includes('请稍候') || text.includes('先别改')) {
    tokens.push('&WAIT');
  }
  if (text.includes('完成') || text.includes('好了')) {
    tokens.push('&DONE');
  }
  if (text.includes('可以继续') || text.includes('可以开始')) {
    tokens.push('&PROCEED');
  }

  return tokens.join(' ');
}

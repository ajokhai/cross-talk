/**
 * XDialect v1.0.0 — Shared Versioned Token Dictionary for AI Agent Inter-Communication
 *
 * Compresses complex coordination intents into hyper-concise, lossless tokens
 * that can be bit-packed on the wire and losslessly translated into natural English.
 */
export const DIALECT_V1 = {
    version: '1.0.0',
    name: 'XDialect-AgentMesh',
    checksum: 'sha256-xd1-0001',
    updatedAt: '2026-10-09',
    tokens: {
        // Actions (Prefix: !)
        '!LCK': {
            code: '!LCK',
            numericId: 0x10,
            category: 'action',
            meaning: 'Claim exclusive lock on file',
            humanTemplate: 'Claiming exclusive file lock on {target} for {intent}: "{reason}".',
            zhMeaning: '申请文件独占锁',
            zhTemplate: '申请独占锁定文件 {target} 进行{intent}：“{reason}”。'
        },
        '!REL': {
            code: '!REL',
            numericId: 0x11,
            category: 'action',
            meaning: 'Release lock on file',
            humanTemplate: 'Releasing file lock on {target}. File is now open for other agents.',
            zhMeaning: '释放文件锁',
            zhTemplate: '已释放文件 {target} 的锁，其他智能体可安全编辑。'
        },
        '!BCST': {
            code: '!BCST',
            numericId: 0x12,
            category: 'action',
            meaning: 'Broadcast announcement to mesh',
            humanTemplate: 'Announcing to all agents: {reason}.',
            zhMeaning: '全网广播公告',
            zhTemplate: '向网络中所有智能体广播：“{reason}”。'
        },
        '!DM': {
            code: '!DM',
            numericId: 0x13,
            category: 'action',
            meaning: 'Direct message to specific agent',
            humanTemplate: 'Direct message to {recipient}: {reason}.',
            zhMeaning: '定向私信发送',
            zhTemplate: '发送私信给智能体 {recipient}：“{reason}”。'
        },
        '!WARN': {
            code: '!WARN',
            numericId: 0x14,
            category: 'action',
            meaning: 'File collision or conflict alert',
            humanTemplate: 'Conflict Alert: {target} is currently locked! Please hold.',
            zhMeaning: '文件冲突警告',
            zhTemplate: '冲突警告：文件 {target} 当前已被锁定！请稍等。'
        },
        '!PASS': {
            code: '!PASS',
            numericId: 0x15,
            category: 'action',
            meaning: 'Handoff task / file lock to another agent',
            humanTemplate: 'Handing off {target} to {recipient} with context: "{reason}".',
            zhMeaning: '移交任务与文件锁',
            zhTemplate: '将文件 {target} 移交给智能体 {recipient}，说明：“{reason}”。'
        },
        // Intents / Verbs (Prefix: #)
        '#REF': {
            code: '#REF',
            numericId: 0x30,
            category: 'intent',
            meaning: 'Refactoring existing code without changing external behavior',
            humanTemplate: 'refactoring',
            zhMeaning: '代码重构',
            zhTemplate: '重构代码'
        },
        '#FEAT': {
            code: '#FEAT',
            numericId: 0x31,
            category: 'intent',
            meaning: 'Implementing new feature or capability',
            humanTemplate: 'implementing new feature',
            zhMeaning: '新功能开发',
            zhTemplate: '实现新功能'
        },
        '#FIX': {
            code: '#FIX',
            numericId: 0x32,
            category: 'intent',
            meaning: 'Fixing bug or error condition',
            humanTemplate: 'fixing bug',
            zhMeaning: '修复缺陷',
            zhTemplate: '修复错误缺陷'
        },
        '#TEST': {
            code: '#TEST',
            numericId: 0x33,
            category: 'intent',
            meaning: 'Running or authoring test suites',
            humanTemplate: 'testing',
            zhMeaning: '测试用例执行',
            zhTemplate: '编写或运行测试'
        },
        '#BLD': {
            code: '#BLD',
            numericId: 0x34,
            category: 'intent',
            meaning: 'Compiling or building codebase',
            humanTemplate: 'building',
            zhMeaning: '代码编译与构建',
            zhTemplate: '编译构建项目'
        },
        '#MIG': {
            code: '#MIG',
            numericId: 0x35,
            category: 'intent',
            meaning: 'Database or schema migration',
            humanTemplate: 'migrating schema',
            zhMeaning: '数据结构迁移',
            zhTemplate: '数据库或协议迁移'
        },
        '#REV': {
            code: '#REV',
            numericId: 0x36,
            category: 'intent',
            meaning: 'Code review or auditing',
            humanTemplate: 'reviewing',
            zhMeaning: '代码审查',
            zhTemplate: '审查代码'
        },
        '#DOC': {
            code: '#DOC',
            numericId: 0x37,
            category: 'intent',
            meaning: 'Updating documentation or comments',
            humanTemplate: 'documenting',
            zhMeaning: '文档更新',
            zhTemplate: '编写文档与注释'
        },
        // Flow & Coordination Control (Prefix: &)
        '&WAIT': {
            code: '&WAIT',
            numericId: 0x50,
            category: 'flow',
            meaning: 'Hang on / do not touch until finished',
            humanTemplate: 'Hang on for me to finish before touching it.',
            zhMeaning: '等我完成再修改',
            zhTemplate: '请稍候，等我修改完成再操作。'
        },
        '&ACK': {
            code: '&ACK',
            numericId: 0x51,
            category: 'flow',
            meaning: 'Acknowledged / will wait',
            humanTemplate: 'Understood, holding off.',
            zhMeaning: '已收到，暂不修改',
            zhTemplate: '已确认，暂停修改并保持等待。'
        },
        '&DONE': {
            code: '&DONE',
            numericId: 0x52,
            category: 'flow',
            meaning: 'Task finished / ready for next step',
            humanTemplate: 'Finished work.',
            zhMeaning: '工作完成',
            zhTemplate: '操作已完成。'
        },
        '&PROCEED': {
            code: '&PROCEED',
            numericId: 0x53,
            category: 'flow',
            meaning: 'Clear to proceed',
            humanTemplate: 'You are clear to proceed now.',
            zhMeaning: '可以继续操作',
            zhTemplate: '其他智能体现在可以继续推进。'
        },
        // Queries (Prefix: ?)
        '?WHO': {
            code: '?WHO',
            numericId: 0x70,
            category: 'action',
            meaning: 'Query active agents on mesh',
            humanTemplate: 'Who is active on the channel?'
        },
        '?LOCKS': {
            code: '?LOCKS',
            numericId: 0x71,
            category: 'action',
            meaning: 'Query currently held file locks',
            humanTemplate: 'What files are currently locked?'
        }
    },
    grammar: {
        format: '<ACTION> [@<FILE>] [#<INTENT>] ["<REASON>"] [~<TTL_SEC>] [^<RECIPIENT>] [&<FLOW>]',
        examples: [
            {
                shorthand: '!LCK @src/auth.ts #REF "jwt validation" ~180 &WAIT',
                human: 'I am editing src/auth.ts, refactoring jwt validation (180s lock). Hang on for me to finish before touching it.',
                meaning: 'Locks src/auth.ts for 3 minutes for jwt refactoring and instructs peers to wait.'
            },
            {
                shorthand: '!REL @src/auth.ts &DONE &PROCEED',
                human: 'Finished work on src/auth.ts. Lock released. You are clear to proceed now.',
                meaning: 'Releases lock on src/auth.ts and signals peers that it is safe to edit.'
            },
            {
                shorthand: '!DM ^Agent-2 &ACK "waiting for your commit"',
                human: 'Direct message to Agent-2: Understood, holding off; waiting for your commit.',
                meaning: 'Direct acknowledgement to peer agent.'
            },
            {
                shorthand: '!WARN @src/db.ts #MIG &WAIT',
                human: 'Conflict Alert: src/db.ts is locked for database migration! Hang on for me to finish before touching it.',
                meaning: 'Warns that src/db.ts cannot be touched.'
            }
        ]
    }
};

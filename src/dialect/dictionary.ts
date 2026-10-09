/**
 * XDialect v1.0.0 — Shared Versioned Token Dictionary for AI Agent Inter-Communication
 * 
 * Compresses complex coordination intents into hyper-concise, lossless tokens
 * that can be bit-packed on the wire and losslessly translated into natural English.
 */

export interface DialectToken {
  code: string;           // Shorthand prefix/symbol, e.g. "!LCK"
  numericId: number;      // 1-byte numeric bit ID (0-255)
  category: 'action' | 'intent' | 'modifier' | 'flow';
  meaning: string;        // Canonical English description
  humanTemplate: string;  // English expansion template
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
    }>;
  };
}

export const DIALECT_V1: DialectDictionary = {
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
      humanTemplate: 'Claiming exclusive file lock on {target} for {intent}: "{reason}".'
    },
    '!REL': {
      code: '!REL',
      numericId: 0x11,
      category: 'action',
      meaning: 'Release lock on file',
      humanTemplate: 'Releasing file lock on {target}. File is now open for other agents.'
    },
    '!BCST': {
      code: '!BCST',
      numericId: 0x12,
      category: 'action',
      meaning: 'Broadcast announcement to mesh',
      humanTemplate: 'Announcing to all agents: {reason}.'
    },
    '!DM': {
      code: '!DM',
      numericId: 0x13,
      category: 'action',
      meaning: 'Direct message to specific agent',
      humanTemplate: 'Direct message to {recipient}: {reason}.'
    },
    '!WARN': {
      code: '!WARN',
      numericId: 0x14,
      category: 'action',
      meaning: 'File collision or conflict alert',
      humanTemplate: 'Conflict Alert: {target} is currently locked! Please hold.'
    },
    '!PASS': {
      code: '!PASS',
      numericId: 0x15,
      category: 'action',
      meaning: 'Handoff task / file lock to another agent',
      humanTemplate: 'Handing off {target} to {recipient} with context: "{reason}".'
    },

    // Intents / Verbs (Prefix: #)
    '#REF': {
      code: '#REF',
      numericId: 0x30,
      category: 'intent',
      meaning: 'Refactoring existing code without changing external behavior',
      humanTemplate: 'refactoring'
    },
    '#FEAT': {
      code: '#FEAT',
      numericId: 0x31,
      category: 'intent',
      meaning: 'Implementing new feature or capability',
      humanTemplate: 'implementing new feature'
    },
    '#FIX': {
      code: '#FIX',
      numericId: 0x32,
      category: 'intent',
      meaning: 'Fixing bug or error condition',
      humanTemplate: 'fixing bug'
    },
    '#TEST': {
      code: '#TEST',
      numericId: 0x33,
      category: 'intent',
      meaning: 'Running or authoring test suites',
      humanTemplate: 'testing'
    },
    '#BLD': {
      code: '#BLD',
      numericId: 0x34,
      category: 'intent',
      meaning: 'Compiling or building codebase',
      humanTemplate: 'building'
    },
    '#MIG': {
      code: '#MIG',
      numericId: 0x35,
      category: 'intent',
      meaning: 'Database or schema migration',
      humanTemplate: 'migrating schema'
    },
    '#REV': {
      code: '#REV',
      numericId: 0x36,
      category: 'intent',
      meaning: 'Code review or auditing',
      humanTemplate: 'reviewing'
    },
    '#DOC': {
      code: '#DOC',
      numericId: 0x37,
      category: 'intent',
      meaning: 'Updating documentation or comments',
      humanTemplate: 'documenting'
    },

    // Flow & Coordination Control (Prefix: &)
    '&WAIT': {
      code: '&WAIT',
      numericId: 0x50,
      category: 'flow',
      meaning: 'Hang on / do not touch until finished',
      humanTemplate: 'Hang on for me to finish before touching it.'
    },
    '&ACK': {
      code: '&ACK',
      numericId: 0x51,
      category: 'flow',
      meaning: 'Acknowledged / will wait',
      humanTemplate: 'Understood, holding off.'
    },
    '&DONE': {
      code: '&DONE',
      numericId: 0x52,
      category: 'flow',
      meaning: 'Task finished / ready for next step',
      humanTemplate: 'Finished work.'
    },
    '&PROCEED': {
      code: '&PROCEED',
      numericId: 0x53,
      category: 'flow',
      meaning: 'Clear to proceed',
      humanTemplate: 'You are clear to proceed now.'
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

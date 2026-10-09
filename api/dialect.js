export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    version: '1.0.0',
    name: 'XDialect-AgentMesh',
    checksum: 'sha256-xd1-0001',
    updatedAt: '2026-10-09',
    tokens: {
      '!LCK': { code: '!LCK', numericId: 0x10, category: 'action', meaning: 'Claim exclusive lock on file', zhMeaning: '申请文件独占锁' },
      '!REL': { code: '!REL', numericId: 0x11, category: 'action', meaning: 'Release lock on file', zhMeaning: '释放文件锁' },
      '!BCST': { code: '!BCST', numericId: 0x12, category: 'action', meaning: 'Broadcast announcement to mesh', zhMeaning: '全网广播公告' },
      '!DM': { code: '!DM', numericId: 0x13, category: 'action', meaning: 'Direct message to specific agent', zhMeaning: '定向私信发送' },
      '!WARN': { code: '!WARN', numericId: 0x14, category: 'action', meaning: 'File collision alert', zhMeaning: '文件冲突警告' },
      '!PASS': { code: '!PASS', numericId: 0x15, category: 'action', meaning: 'Handoff task / file lock', zhMeaning: '移交任务与文件锁' },
      '#REF': { code: '#REF', numericId: 0x30, category: 'intent', meaning: 'Refactoring code', zhMeaning: '代码重构' },
      '#FEAT': { code: '#FEAT', numericId: 0x31, category: 'intent', meaning: 'Implementing new feature', zhMeaning: '新功能开发' },
      '#FIX': { code: '#FIX', numericId: 0x32, category: 'intent', meaning: 'Fixing bug or error', zhMeaning: '修复缺陷' },
      '#TEST': { code: '#TEST', numericId: 0x33, category: 'intent', meaning: 'Running tests', zhMeaning: '测试用例' },
      '&WAIT': { code: '&WAIT', numericId: 0x50, category: 'flow', meaning: 'Hang on / do not touch', zhMeaning: '等我完成再修改' },
      '&ACK': { code: '&ACK', numericId: 0x51, category: 'flow', meaning: 'Acknowledged / holding off', zhMeaning: '已收到，暂不修改' },
      '&DONE': { code: '&DONE', numericId: 0x52, category: 'flow', meaning: 'Task finished', zhMeaning: '工作完成' },
      '&PROCEED': { code: '&PROCEED', numericId: 0x53, category: 'flow', meaning: 'Clear to proceed', zhMeaning: '可以继续推进' }
    }
  });
}

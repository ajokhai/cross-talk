#!/usr/bin/env node
/**
 * CrossTalk PreToolUse Lifecycle Hook
 * Intercepts write_to_file, replace_file_content, and multi_replace_file_content
 * Checks whether the target file is locked by another agent on the CrossTalk mesh.
 */

import http from 'node:http';

async function checkLock(filePath) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(filePath);
    const req = http.get(`http://localhost:4488/api/check-lock?file=${encoded}`, { timeout: 800 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch {
          resolve({ locked: false });
        }
      });
    });

    req.on('error', () => {
      resolve({ locked: false }); // If hub is offline, don't block
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ locked: false });
    });
  });
}

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  try {
    const payload = JSON.parse(input || '{}');
    const toolCall = payload.toolCall;

    if (
      toolCall &&
      (toolCall.name === 'replace_file_content' ||
       toolCall.name === 'write_to_file' ||
       toolCall.name === 'multi_replace_file_content')
    ) {
      const targetFile = toolCall.args?.TargetFile;
      if (targetFile) {
        const lockInfo = await checkLock(targetFile);
        if (lockInfo.locked && lockInfo.lock) {
          const l = lockInfo.lock;
          process.stdout.write(JSON.stringify({
            decision: 'ask',
            reason: `⚠️ CrossTalk Lock Alert: [${l.file}] is currently claimed by ${l.holderName} ("${l.reason}"). Please confirm or wait before modifying.`
          }));
          return;
        }
      }
    }

    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  } catch (err) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  }
}

main();

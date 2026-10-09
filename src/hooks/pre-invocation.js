#!/usr/bin/env node
/**
 * CrossTalk PreInvocation Lifecycle Hook
 * Injects real-time awareness of active agents, locks, and broadcasts into the model context.
 */

import http from 'node:http';

async function fetchState() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:4488/api/state', { timeout: 800 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
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
    const state = await fetchState();
    if (!state || (!state.agents?.length && !state.locks?.length)) {
      process.stdout.write(JSON.stringify({ injectSteps: [] }));
      return;
    }

    const otherAgents = (state.agents || []).filter(a => a.environment !== 'web');
    const locks = state.locks || [];

    if (otherAgents.length === 0 && locks.length === 0) {
      process.stdout.write(JSON.stringify({ injectSteps: [] }));
      return;
    }

    const lines = ['[CrossTalk Mesh Awareness]'];
    if (otherAgents.length > 0) {
      lines.push(`Active Peer Agents: ${otherAgents.map(a => `${a.name} (${a.currentTask})`).join(' | ')}`);
    }
    if (locks.length > 0) {
      lines.push(`Active File Locks: ${locks.map(l => `${l.file} (held by ${l.holderName}: "${l.reason}")`).join(' | ')}`);
    }

    process.stdout.write(JSON.stringify({
      injectSteps: [
        {
          ephemeralMessage: lines.join('\n')
        }
      ]
    }));
  } catch (err) {
    process.stdout.write(JSON.stringify({ injectSteps: [] }));
  }
}

main();

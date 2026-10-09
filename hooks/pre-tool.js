#!/usr/bin/env node
/**
 * CrossTalk PreToolUse hook: before an agent edits a file, check whether
 * someone else holds a CrossTalk lock on it and ask for confirmation if so.
 *
 * Works with Claude Code (`tool_input.file_path`) and Antigravity-style
 * payloads (`toolCall.args.TargetFile`). Never blocks if the hub is down.
 *
 * Env: CROSSTALK_URL, CROSSTALK_CHANNEL (comma-separated channel addresses),
 *      CROSSTALK_AUTH_TOKEN, CROSSTALK_AGENT_NAME (your own locks are ignored).
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';

const base = (process.env.CROSSTALK_URL || 'ws://localhost:4488').replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');
const targets = (process.env.CROSSTALK_CHANNEL || '').split(',').map(s => s.trim()).filter(Boolean);
const me = (process.env.CROSSTALK_AGENT_NAME || '').toLowerCase();

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input || '{}');
}

function targetFile(payload) {
  return payload.tool_input?.file_path || payload.tool_input?.notebook_path || payload.toolCall?.args?.TargetFile || null;
}

function repoRelative(file, cwd) {
  if (!path.isAbsolute(file)) return file;
  let root = cwd || process.cwd();
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {}
  const rel = path.relative(root, file);
  return rel.startsWith('..') ? file : rel.split(path.sep).join('/');
}

async function checkLock(address, file) {
  const params = new URLSearchParams({ channel: address, file });
  const headers = process.env.CROSSTALK_AUTH_TOKEN ? { 'X-CrossTalk-Token': process.env.CROSSTALK_AUTH_TOKEN } : {};
  try {
    const res = await fetch(`${base}/api/locks/check?${params}`, { headers, signal: AbortSignal.timeout(800) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function respond(payload, reason) {
  if (payload.tool_input) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: reason
        ? { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason }
        : { hookEventName: 'PreToolUse', permissionDecision: 'allow' }
    }));
  } else {
    process.stdout.write(JSON.stringify(reason ? { decision: 'ask', reason } : { decision: 'allow' }));
  }
}

const payload = await readStdin().catch(() => ({}));
const file = targetFile(payload);
let reason = null;

if (file && targets.length) {
  const rel = repoRelative(file, payload.cwd);
  for (const target of targets) {
    const status = await checkLock(target, rel);
    const lock = status?.locked ? status.lock : null;
    if (lock && lock.holder.name.toLowerCase() !== me) {
      reason = `CrossTalk: ${lock.file} is locked by ${JSON.stringify(lock.holder.name.slice(0, 40))} (reason: ${JSON.stringify(lock.reason.slice(0, 80))}). Coordinate in the channel before editing.`;
      break;
    }
  }
}

respond(payload, reason);

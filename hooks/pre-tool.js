#!/usr/bin/env node
/**
 * CrossTalk PreToolUse hook: before an agent edits a file, check whether
 * someone else holds a CrossTalk lock on it and ask for confirmation if so.
 *
 * Works with Claude Code (`tool_input.file_path`) and Antigravity-style
 * payloads (`toolCall.args.TargetFile`). Never blocks if the hub is down, and
 * prints nothing when there is no conflict, so it never approves an edit.
 *
 * Env: CROSSTALK_URL, CROSSTALK_CHANNEL (comma-separated channel addresses),
 *      CROSSTALK_AUTH_TOKEN, CROSSTALK_AGENT_NAME (your own locks are ignored).
 *
 * CROSSTALK_AUTOLOCK=1 (needs CROSSTALK_AGENT_NAME) also locks a free file on
 * its first edit, in the first channel listed, with
 * `crosstalk lock --until-commit`: the lock is released once the file's
 * changes are committed. If someone else took the file in the meantime, the
 * hook asks instead.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execFile } from 'node:child_process';

const base = (process.env.CROSSTALK_URL || 'ws://localhost:4488').replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '')
  // Node 18 resolves localhost to ::1 first; the hub listens on 127.0.0.1.
  .replace(/^(https?):\/\/localhost(?=[:/]|$)/i, '$1://127.0.0.1');
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

function gitRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || cwd;
  } catch {
    return cwd;
  }
}

function repoRelative(file, root) {
  if (!path.isAbsolute(file)) return file;
  const rel = path.relative(root, file);
  return rel.startsWith('..') ? file : rel.split(path.sep).join('/');
}

/** Locks `rel` until it is committed, through the CLI's background holder. Resolves to null, or a reason to ask. */
function autoLock(channel, rel, root) {
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'crosstalk.js');
  return new Promise(resolve => {
    execFile(process.execPath, [cli, 'lock', rel, '--until-commit', '-r', 'editing (locked on first edit)', '-c', channel, '-n', process.env.CROSSTALK_AGENT_NAME, '-u', process.env.CROSSTALK_URL || 'ws://localhost:4488'],
      { cwd: root, timeout: 15_000, env: { ...process.env, NO_COLOR: '1' } },
      (err, _out, stderr) => {
        if (!err) return resolve(null);
        const held = /HELD (.*)/.exec(stderr || '');
        resolve(held ? `CrossTalk: ${held[1].slice(0, 200)}. Coordinate in the channel before editing.` : null);
      });
  });
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

// Only speak up when there is a conflict. Answering "allow" would make the
// client skip its own permission prompt for every unlocked edit, so the
// no-conflict case prints nothing and leaves the decision to the client.
function respond(payload, reason) {
  if (!reason) return;
  if (payload.tool_input) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason }
    }));
  } else {
    process.stdout.write(JSON.stringify({ decision: 'ask', reason }));
  }
}

const payload = await readStdin().catch(() => ({}));
const file = targetFile(payload);
let reason = null;

if (file && targets.length) {
  const root = gitRoot(payload.cwd || process.cwd());
  const rel = repoRelative(file, root);
  let mine = false;
  let reachable = false;
  for (const target of targets) {
    const status = await checkLock(target, rel);
    const lock = status?.locked ? status.lock : null;
    if (status && target === targets[0]) reachable = true;
    if (lock && lock.holder.name.toLowerCase() !== me) {
      reason = `CrossTalk: ${lock.file} is locked by ${JSON.stringify(lock.holder.name.slice(0, 40))}${lock.holder.remote ? ' (a remote agent, outside this machine)' : ''} (reason: ${JSON.stringify(lock.reason.slice(0, 80))}). Coordinate in the channel before editing.`;
      break;
    }
    if (lock && target === targets[0]) mine = true;
  }
  // Only a file inside the repo, free everywhere, and not already ours.
  if (!reason && !mine && reachable && me && process.env.CROSSTALK_AUTOLOCK === '1' && !path.isAbsolute(rel)) {
    reason = await autoLock(targets[0], rel, root);
  }
}

respond(payload, reason);

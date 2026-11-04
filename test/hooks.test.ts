import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { startServer } from '../src/server/index.js';
import { CrossTalk } from '../src/client/sdk.js';

function runHook(script: string, env: Record<string, string>, payload: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('node', [script], { env: { ...process.env, ...env } }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
    child.stdin!.end(JSON.stringify(payload));
  });
}

test('pre-tool hook prints nothing for an unlocked file, and asks for a locked one', async () => {
  const server = await startServer({ port: 0, quiet: true });
  const holder = await CrossTalk.connect({ name: 'holder', url: server.url, reconnect: false });
  try {
    const ch = await holder.createChannel('hook-check');
    await ch.lock('app/products/[handle]/route.ts', 'routing');
    const env = { CROSSTALK_URL: server.url, CROSSTALK_CHANNEL: ch.address, CROSSTALK_AGENT_NAME: 'editor' };
    const edit = (file: string) => ({ tool_name: 'Edit', tool_input: { file_path: file } });

    // No conflict: no output at all, so the client's own permission prompt still applies.
    assert.equal(await runHook('hooks/pre-tool.js', env, edit('src/free.ts')), '');
    assert.equal(await runHook('hooks/pre-tool.js', env, { toolCall: { args: { TargetFile: 'src/free.ts' } } }), '');

    // Conflict (a path with brackets, which a naive curl URL would glob): ask, never allow.
    const out = JSON.parse(await runHook('hooks/pre-tool.js', env, edit('app/products/[handle]/route.ts')));
    assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /locked by "holder"/);

    // Your own lock isn't a conflict.
    assert.equal(await runHook('hooks/pre-tool.js', { ...env, CROSSTALK_AGENT_NAME: 'holder' }, edit('app/products/[handle]/route.ts')), '');
  } finally {
    await holder.close();
    await server.close();
  }
});

test('pre-tool hook prints nothing when the hub is down', async () => {
  const env = { CROSSTALK_URL: 'ws://127.0.0.1:9', CROSSTALK_CHANNEL: 'xt_AAAAAAAAAAAAAAAAAAAAAA' };
  assert.equal(await runHook('hooks/pre-tool.js', env, { tool_input: { file_path: 'a.ts' } }), '');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { LockManager } from '../src/server/locks.js';
import { AgentInfo } from '../src/server/types.js';
import http from 'node:http';
import { startServer } from '../src/server/index.js';
import { InMemoryStorage } from '../src/server/storage.js';

function createMockAgent(id: string, name: string, workspace = 'repo-1'): AgentInfo {
  return {
    id,
    name,
    role: 'developer',
    environment: 'bot',
    workspace,
    status: 'working',
    currentTask: 'Testing',
    lockedFiles: [],
    connectedAt: Date.now(),
    lastSeen: Date.now()
  };
}

function sendRawGet(port: number, requestPath: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method: 'GET'
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('1. Path Traversal Guard: Prevents arbitrary file reads', async () => {
  const port = 4991;
  const storage = new InMemoryStorage();
  const { server } = await startServer(port, '127.0.0.1', storage, ['127.0.0.1/32']);

  try {
    // Raw HTTP traversal to package.json
    const resRaw = await sendRawGet(port, '/../../package.json');
    assert.equal(resRaw.statusCode, 403, 'Raw traversal to package.json must return 403');
    assert.match(resRaw.body, /403 Forbidden/);

    // Encoded traversal attempt (%2e%2e)
    const resEncoded = await sendRawGet(port, '/%2e%2e/%2e%2e/package.json');
    assert.equal(resEncoded.statusCode, 403, 'Encoded traversal must return 403');

    // Missing external file via normalized path should return 404, not leak index.html
    const resMissingAsset = await fetch(`http://127.0.0.1:${port}/package.json`);
    assert.equal(resMissingAsset.status, 404, 'Direct request for package.json outside webDir must return 404');

    // Valid file request must succeed
    const resValid = await fetch(`http://127.0.0.1:${port}/index.html`);
    assert.equal(resValid.status, 200, 'Valid static file must return 200');
  } finally {
    server.close();
  }
});

test('2. Lock Namespacing: Allows identical paths across different channels/workspaces', () => {
  const lm = new LockManager();
  try {
    const agentA = createMockAgent('agent-a', 'Agent Alpha', '/workspaces/alpha');
    const agentB = createMockAgent('agent-b', 'Agent Beta', '/workspaces/beta');
    const agentC = createMockAgent('agent-c', 'Agent Collision', '/workspaces/alpha');

    // Agent A in channel "team-a" acquires lock on "src/index.ts"
    const resA = lm.acquire('src/index.ts', agentA, 'Feature A', 60, 'team-a');
    assert.equal(resA.success, true, 'Agent A should acquire lock');

    // Agent B in channel "team-b" acquires lock on same relative path "src/index.ts"
    const resB = lm.acquire('src/index.ts', agentB, 'Feature B', 60, 'team-b');
    assert.equal(resB.success, true, 'Agent B should acquire lock in separate channel');

    // Agent C in SAME channel "team-a" and SAME workspace attempts lock on "src/index.ts"
    const resC = lm.acquire('src/index.ts', agentC, 'Conflict', 60, 'team-a');
    assert.equal(resC.success, false, 'Agent C should be blocked by Agent A in same channel');
    assert.equal(resC.existingHolder?.id, 'agent-a');
  } finally {
    lm.destroy();
  }
});

test('3. TTL Clamping & Quota: Prevents lock hoarding and indefinite starvation', () => {
  const lm = new LockManager();
  try {
    const agent = createMockAgent('agent-hoarder', 'Agent Hoarder', '/workspace/main');

    // Request 68-year TTL (2147483647 seconds)
    const resCrazyTtl = lm.acquire('file-0.ts', agent, 'DoS test', 2147483647, 'default');
    assert.equal(resCrazyTtl.success, true);
    assert.ok(resCrazyTtl.lock);
    const grantedTtlSeconds = Math.round((resCrazyTtl.lock.expiresAt - resCrazyTtl.lock.acquiredAt) / 1000);
    assert.equal(grantedTtlSeconds, LockManager.MAX_TTL_SECONDS, 'TTL must be clamped to MAX_TTL_SECONDS (1800s / 30m)');

    // Acquire up to max quota (10 locks)
    for (let i = 1; i < LockManager.MAX_LOCKS_PER_AGENT; i++) {
      const res = lm.acquire(`file-${i}.ts`, agent, `File ${i}`, 60, 'default');
      assert.equal(res.success, true, `Should acquire up to lock ${i}`);
    }

    // Attempt 11th lock (must be rejected)
    const resExceeded = lm.acquire('file-11.ts', agent, '11th file', 60, 'default');
    assert.equal(resExceeded.success, false, '11th lock must be rejected');
    assert.equal(resExceeded.quotaExceeded, true, 'Result must flag quotaExceeded');
    assert.match(resExceeded.error || '', /quota exceeded/i);
  } finally {
    lm.destroy();
  }
});

test('4. REST API Token Authorization: Enforces CROSSTALK_AUTH_TOKEN when configured', async () => {
  const port = 4992;
  const storage = new InMemoryStorage();
  const testToken = 'secret-test-token-xyz';
  process.env.CROSSTALK_AUTH_TOKEN = testToken;

  const { server } = await startServer(port, '127.0.0.1', storage, ['127.0.0.1/32']);

  try {
    // Unauthenticated request to /api/history
    const resNoAuth = await fetch(`http://127.0.0.1:${port}/api/history`);
    assert.equal(resNoAuth.status, 401, 'Request without token must return 401');

    // Request with Bearer header
    const resBearer = await fetch(`http://127.0.0.1:${port}/api/history`, {
      headers: { Authorization: `Bearer ${testToken}` }
    });
    assert.equal(resBearer.status, 200, 'Request with valid Bearer token must succeed');

    // Request with query parameter ?token=
    const resQuery = await fetch(`http://127.0.0.1:${port}/api/history?token=${testToken}`);
    assert.equal(resQuery.status, 200, 'Request with query token must succeed');

    // Public discovery route (/api/dialect) remains accessible
    const resDialect = await fetch(`http://127.0.0.1:${port}/api/dialect`);
    assert.equal(resDialect.status, 200, 'Dialect discovery should remain public');
  } finally {
    delete process.env.CROSSTALK_AUTH_TOKEN;
    server.close();
  }
});

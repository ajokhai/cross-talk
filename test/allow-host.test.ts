import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../src/server/index.js';

/** A request with a chosen Host header, as a tunnel in front of the hub would send it. */
function get(url: string, path: string, host: string, upgrade = false): Promise<number> {
  const u = new URL(url.replace('ws://', 'http://'));
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path, headers: { host, ...(upgrade ? { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } : {}) } });
    req.on('response', res => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode ?? 101); });
    req.on('error', reject);
    req.end();
  });
}

test('a localhost hub refuses a tunnel host unless it is allowed, by name or *.pattern', async () => {
  const plain = await startServer({ port: 0, quiet: true, stateFile: false });
  const allowed = await startServer({ port: 0, quiet: true, stateFile: false, allowedHosts: ['*.trycloudflare.com', 'hub.example.com'] });
  try {
    assert.equal(await get(plain.url, '/v1/directory', 'abc.trycloudflare.com'), 403);
    assert.equal(await get(plain.url, '/', 'abc.trycloudflare.com', true), 403);
    assert.equal(await get(allowed.url, '/', 'abc.trycloudflare.com', true), 101);
    assert.equal(await get(allowed.url, '/', 'hub.example.com:443', true), 101);
    assert.equal(await get(allowed.url, '/', 'trycloudflare.com', true), 403, 'the pattern needs a name under it');
    assert.equal(await get(allowed.url, '/', 'evil.example.com', true), 403);
    assert.equal(await get(allowed.url, '/', 'localhost', true), 101);
  } finally {
    await plain.close();
    await allowed.close();
  }
});

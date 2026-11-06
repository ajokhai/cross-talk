import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore: plain JS Vercel function
import { countInstalls, handle } from '../api/installs.js';

const release = (tag: string, n: number, other = 0) => ({
  tag_name: tag,
  assets: [{ name: 'cross-talk.tgz', download_count: n }, { name: 'checksums.txt', download_count: other }]
});
const fakeFetch = (pages: unknown[][], status = 200) => async (url: string) => {
  const page = Number(new URL(url).searchParams.get('page'));
  return { ok: status === 200, status, json: async () => pages[page - 1] ?? [] } as any;
};

test('installs are the package downloads summed over every release, other assets ignored', async () => {
  const r = await countInstalls(fakeFetch([[release('v2.18.0', 3, 50), release('v2.17.0', 5), { tag_name: 'v1', assets: [] }]]), {});
  assert.equal(r.installs, 8);
  assert.deepEqual(r.releases.map((x: any) => x.installs), [3, 5, 0]);
});

test('GET returns the count, cached; a GitHub failure is a 502, not a crash', async () => {
  const call = async (f: any) => {
    let status = 0, body = '';
    const headers: Record<string, string> = {};
    await handle({ method: 'GET' } as any, { setHeader: (k: string, v: string) => (headers[k] = v), set statusCode(v: number) { status = v; }, end: (t?: string) => (body = t ?? '') } as any, f, {});
    return { status, headers, body: body ? JSON.parse(body) : undefined };
  };
  const ok = await call(fakeFetch([[release('v2.18.0', 7)]]));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.installs, 7);
  assert.match(ok.headers['Cache-Control'], /s-maxage=3600/);
  const bad = await call(fakeFetch([], 403));
  assert.equal(bad.status, 502);
});

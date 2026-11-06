import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cachedLatest, latestRelease, newest, updateNotice, VERSION, UPDATE_CHECK_MS } from '../src/version.js';

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xt-upd-'));
/** A fake GitHub: answers releases/latest with a redirect to the given tag, counting calls. */
function github(tag: string) {
  const f: any = async () => { f.calls++; return { status: 302, headers: new Headers({ location: `https://github.com/ajokhai/cross-talk/releases/tag/${tag}` }) }; };
  f.calls = 0;
  return f;
}

test('the latest release is read from GitHub at most once a week, and cached', async () => {
  const h = home();
  const gh = github('v9.1.0');
  assert.equal(await latestRelease({ home: h, now: 0, env: {}, fetchImpl: gh }), '9.1.0');
  assert.equal(await latestRelease({ home: h, now: UPDATE_CHECK_MS - 1, env: {}, fetchImpl: github('v9.2.0') }), '9.1.0', 'cached within the week');
  assert.equal(gh.calls, 1);
  assert.equal(cachedLatest(h), '9.1.0');
  assert.equal(await latestRelease({ home: h, now: UPDATE_CHECK_MS, env: {}, fetchImpl: github('v9.2.0') }), '9.2.0', 'checked again once the week is up (or when the machine comes back after a long time off)');
  assert.match(updateNotice(newest('1.0.0', cachedLatest(h)))!, /CrossTalk 9\.2\.0 is available/);
});

test('no check when turned off or on CI, and offline never throws', async () => {
  const gh = github('v9.9.9');
  assert.equal(await latestRelease({ home: home(), env: { CROSSTALK_UPDATE_CHECK: '0' }, fetchImpl: gh }), undefined);
  assert.equal(await latestRelease({ home: home(), env: { GITHUB_ACTIONS: 'true' }, fetchImpl: gh }), undefined);
  assert.equal(gh.calls, 0);
  const offline: any = async () => { throw new Error('offline'); };
  assert.equal(await latestRelease({ home: home(), env: {}, fetchImpl: offline }), undefined);
  assert.equal(updateNotice(newest(undefined, VERSION)), undefined, 'no notice when current');
});

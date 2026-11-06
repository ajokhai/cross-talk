// GET /api/installs: how many times CrossTalk has been installed, counted by
// GitHub as downloads of the release package (cross-talk.tgz), summed across
// every release. No ping from the installer: every `npm install -g <release url>`
// downloads that file, and GitHub keeps the count. Cached for an hour.
// GITHUB_TOKEN (optional) raises GitHub's rate limit.

export const REPO = 'ajokhai/cross-talk';
export const ASSET = 'cross-talk.tgz';

/** Sums the package's downloads over all releases (paged). `fetchImpl` is injectable for tests. */
export async function countInstalls(fetchImpl = fetch, env = process.env) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'crosstalk-site' };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  let installs = 0;
  const releases = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetchImpl(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw Object.assign(new Error(`GitHub answered ${res.status}`), { status: res.status });
    const list = await res.json();
    for (const r of list) {
      const n = (r.assets || []).filter(a => a.name === ASSET).reduce((s, a) => s + (a.download_count || 0), 0);
      installs += n;
      releases.push({ tag: r.tag_name, installs: n });
    }
    if (list.length < 100) break;
  }
  return { installs, releases };
}

export async function handle(req, res, fetchImpl = fetch, env = process.env) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.statusCode = 405;
    return res.end();
  }
  try {
    const body = await countInstalls(fetchImpl, env);
    res.statusCode = 200;
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'install count unavailable', status: err.status }));
  }
}

export default function handler(req, res) {
  return handle(req, res);
}

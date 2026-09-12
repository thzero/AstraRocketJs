// Build-time contributor list from the GitHub REST API.
//
// Writes src/data/contributors.generated.json — the people credited in the
// About dialog. Like the motor/component catalogs this is a BUILD ARTIFACT:
// generated, committed, and bundled, so the app makes no runtime call to
// github.com (see the privacy copy in src/i18n/locales/*.json — the only
// network call at runtime is the motor database).
//
// Avatars are inlined as data URIs for the same reason: an <img> pointing at
// avatars.githubusercontent.com would be a third-party request from every
// user's browser. They're fetched at 64px, so each is a couple of KB.
//
// Run manually or in CI (never inside `vite build`):
//   node scripts/sync-contributors.mjs
//   node scripts/sync-contributors.mjs --repo owner/name   # override the repo
//
// The Pages deploy (.github/workflows/deploy-pages.yml) runs this before the
// build, as a best-effort step: the output file is only written once every
// fetch has succeeded, so a failure here leaves the committed JSON in place.
//
// Unauthenticated the GitHub API allows 60 requests/hour per IP; set
// GITHUB_TOKEN (CI: `${{ github.token }}`) to lift that to 5,000.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../src/data/contributors.generated.json', import.meta.url));
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** owner/name from --repo, else parsed out of package.json's repository URL. */
function resolveRepo() {
  const i = process.argv.indexOf('--repo');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const url = PKG.repository?.url ?? '';
  const m = url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!m) throw new Error(`Cannot derive owner/repo from package.json repository.url ("${url}") — pass --repo`);
  return m[1];
}

const REPO = resolveRepo();
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': `${PKG.name}-sync-contributors`,
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) {
    const hint = res.status === 403 && !TOKEN ? ' (rate limited — set GITHUB_TOKEN)' : '';
    throw new Error(`GET ${path} → HTTP ${res.status}${hint}`);
  }
  return res.json();
}

/** Fetch the avatar at 64px and inline it, so the app loads nothing from GitHub. */
async function inlineAvatar(url) {
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}s=64`, {
      headers: { 'User-Agent': headers['User-Agent'] },
    });
    if (!res.ok) return undefined;
    const type = res.headers.get('content-type') || 'image/png';
    const b64 = Buffer.from(await res.arrayBuffer()).toString('base64');
    return `data:${type};base64,${b64}`;
  } catch {
    return undefined; // No avatar → the dialog falls back to an initial.
  }
}

// The API pages at 100; a repo this size never fills one page, but page anyway.
const raw = [];
for (let page = 1; page <= 10; page++) {
  const batch = await api(`/repos/${REPO}/contributors?per_page=100&page=${page}`);
  raw.push(...batch);
  if (batch.length < 100) break;
}

// Drop bots (dependabot, github-actions, …) — they're not people to credit.
const people = raw
  .filter((c) => c.type !== 'Bot' && !/\[bot\]$/.test(c.login))
  .sort((a, b) => b.contributions - a.contributions || a.login.localeCompare(b.login));

const contributors = [];
for (const c of people) {
  contributors.push({
    login: c.login,
    url: c.html_url,
    contributions: c.contributions,
    avatar: await inlineAvatar(c.avatar_url),
  });
}

writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), repo: REPO, contributors }, null, 2) + '\n');
console.log(
  `Wrote ${contributors.length} contributors → src/data/contributors.generated.json`,
  contributors.map((c) => c.login).join(', '),
);

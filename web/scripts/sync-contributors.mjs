// Build-time contributor list from the GitHub REST API.
//
// Writes public/data/contributors.generated.json: the people credited in the
// About dialog. It is a build artifact: generated, committed, and served from
// the app's own origin, so the app makes no runtime call to github.com (see the
// privacy copy in src/i18n/locales/*.json). Unlike the motor and component
// catalogs it is never read from the `data` branch (src/services/app/remoteData.ts),
// so the copy a deploy builds is the one users get.
//
// Avatars are inlined as data URIs for the same reason: an <img> pointing at
// avatars.githubusercontent.com would be a third-party request from every
// user's browser. They're fetched at 64px, so each is a couple of KB.
//
// Run manually or in CI (never inside `vite build`):
//   node scripts/sync-contributors.mjs
//   node scripts/sync-contributors.mjs --repo owner/name   # override the repo
//
// The Pages deploy (.github/workflows/deploy.yml) runs this before the
// build, as a best-effort step: a failed contributor-list fetch exits before
// writing, so the committed JSON stays in place. A failed avatar fetch does not:
// that person is written with no avatar and the dialog shows an initial.
//
// Unauthenticated the GitHub API allows 60 requests/hour per IP; set
// GITHUB_TOKEN (CI: `${{ github.token }}`) to lift that to 5,000.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg } from './lib/args.mjs';
import { writeDataManifest } from './lib/dataManifest.mjs';

const DATA_DIR = fileURLToPath(new URL('../public/data', import.meta.url));
const OUT = join(DATA_DIR, 'contributors.generated.json');
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** owner/name from --repo, else parsed out of package.json's repository URL. */
function resolveRepo() {
  const repo = arg('repo');
  if (repo) return repo;
  const url = PKG.repository?.url ?? '';
  const m = url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!m) throw new Error(`Cannot derive owner/repo from package.json repository.url ("${url}"); pass --repo`);
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
    const hint = res.status === 403 && !TOKEN ? ' (rate limited, set GITHUB_TOKEN)' : '';
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

// Drop bots (dependabot, github-actions, …): they're not people to credit.
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

// The previous `generated` stamp is kept when the list is unchanged: the
// manifest hashes the whole file, so a new stamp on the same people would make
// every browser download it again after each deploy.
let generated = new Date().toISOString();
try {
  const prev = JSON.parse(readFileSync(OUT, 'utf8'));
  if (prev.repo === REPO && JSON.stringify(prev.contributors) === JSON.stringify(contributors)) {
    generated = prev.generated;
  }
} catch {
  // No readable previous list: stamp this one now.
}
// Compact, like the other catalogs: browsers download it.
writeFileSync(OUT, JSON.stringify({ generated, repo: REPO, contributors }) + '\n');
writeDataManifest(DATA_DIR);
console.log(
  `Wrote ${contributors.length} contributors → public/data/contributors.generated.json`,
  contributors.map((c) => c.login).join(', '),
);

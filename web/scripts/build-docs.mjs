// Builds the Docusaurus site into web/public/docs, where Vite copies it into
// dist and the service worker precaches it. That is what the in-app Help dialog
// reads (src/services/app/helpDocs.ts).
//
//   npm run docs:build
//
// The e2e and update-flow jobs in e2e-full.yml run it before their browser
// checks, and it is how Help is worked on locally: public/docs is gitignored,
// and without it the dialog can only offer the docs site. The deploy builds the same tree with
// its own docusaurus command (.github/workflows/deploy.yml).
//
// It exists instead of a one-line npm script because of DOCS_BASE_URL. The
// docs config defaults its baseUrl to "/" so `docusaurus start` and `serve`
// work standalone, but inside the app the site lives one directory down, and
// every asset it references is an absolute path built from that base. Left at
// the default, a local build would ask for /assets/css/... and get the app's
// 404 instead of its own stylesheet. So the base is derived here from the same
// PAGES_BASE the app build reads, which keeps the two in step.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const website = fileURLToPath(new URL('../../website/', import.meta.url));
// The website's own Docusaurus CLI, run by this same node with no shell: a
// shell joins the arguments unquoted, so an --out-dir with a space would
// split, and Windows refuses to spawn npx.cmd without one.
const core = createRequire(join(website, 'package.json')).resolve('@docusaurus/core/package.json');
const cli = join(dirname(core), 'bin', 'docusaurus.mjs');
const outDir = fileURLToPath(new URL('../public/docs', import.meta.url));

// Mirrors vite.config.ts: PAGES_BASE or "/", with the docs one level under it.
const appBase = (process.env.PAGES_BASE || '/').replace(/\/*$/, '/');

const { status, error } = spawnSync(process.execPath, [cli, 'build', '--out-dir', outDir], {
  cwd: website,
  stdio: 'inherit',
  env: { ...process.env, DOCS_BASE_URL: `${appBase}docs/` },
});

if (error) throw error;
process.exit(status ?? 1);

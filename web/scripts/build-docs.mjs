// Builds the Docusaurus site into web/public/docs, where Vite copies it into
// dist and the service worker precaches it. That is what the in-app Help dialog
// reads (src/services/helpDocs.ts).
//
//   npm run docs:build
//
// The deploy does this itself (.github/workflows/deploy.yml, before the app
// build), so this script is for working on Help locally: public/docs is
// gitignored, and without it the dialog can only offer the docs site.
//
// It exists instead of a one-line npm script because of DOCS_BASE_URL. The
// docs config defaults its baseUrl to "/" so `docusaurus start` and `serve`
// work standalone, but inside the app the site lives one directory down, and
// every asset it references is an ABSOLUTE path built from that base. Left at
// the default, a local build would ask for /assets/css/... and get the app's
// 404 instead of its own stylesheet. So the base is derived here from the same
// PAGES_BASE the app build reads, which keeps the two in step.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const website = fileURLToPath(new URL('../../website/', import.meta.url));
const outDir = fileURLToPath(new URL('../public/docs', import.meta.url));

// Mirrors vite.config.ts: PAGES_BASE or "/", with the docs one level under it.
const appBase = (process.env.PAGES_BASE || '/').replace(/\/*$/, '/');

const { status, error } = spawnSync('npx', ['docusaurus', 'build', '--out-dir', outDir], {
  cwd: website,
  stdio: 'inherit',
  shell: true, // npx is a shell script on POSIX and a .cmd on Windows.
  env: { ...process.env, DOCS_BASE_URL: `${appBase}docs/` },
});

if (error) throw error;
process.exit(status ?? 1);

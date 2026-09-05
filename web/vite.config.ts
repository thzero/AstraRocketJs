import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
const { version } = pkg;

// The Help/docs link. Prefer the explicit `wiki.url` in package.json; fall back to
// the repository URL + "/wiki" (normalized: strip the "git+" prefix / ".git" suffix).
// Single source in package.json, plus a build-time override:
//   HELP_URL=https://docs.example.com npm run build
const repoUrl: string = (pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
const helpUrl: string = process.env.HELP_URL || pkg.wiki?.url || (repoUrl ? `${repoUrl}/wiki` : '');

export default defineConfig({
  // On GitHub Pages the app is served from https://<user>.github.io/<repo>/, so the
  // CI build sets PAGES_BASE=/<repo>/ and every asset + engine URL resolves under it.
  // Local dev/preview leave it unset → '/', so nothing changes locally.
  base: process.env.PAGES_BASE || '/',
  plugins: [react(), tailwindcss()],
  // Expose the package version to the app (shown in the header).
  define: { __APP_VERSION__: JSON.stringify(version), __HELP_URL__: JSON.stringify(helpUrl) },
  // The vendored TeaVM engine is a large ES module; don't let esbuild choke pre-bundling it.
  optimizeDeps: { exclude: ['./src/engine/vendor/orkengine.mjs'] },
  // The sim worker (engine/simWorker.ts) is a module worker that dynamic-imports
  // the engine, so its bundle is code-split — which needs the ES worker format
  // (the default 'iife' can't code-split).
  worker: { format: 'es' },
});

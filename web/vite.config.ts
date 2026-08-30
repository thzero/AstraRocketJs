import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  // On GitHub Pages the app is served from https://<user>.github.io/<repo>/, so the
  // CI build sets PAGES_BASE=/<repo>/ and every asset + engine URL resolves under it.
  // Local dev/preview leave it unset → '/', so nothing changes locally.
  base: process.env.PAGES_BASE || '/',
  plugins: [react(), tailwindcss()],
  // Expose the package version to the app (shown in the header).
  define: { __APP_VERSION__: JSON.stringify(version) },
  // The vendored TeaVM engine is a large ES module; don't let esbuild choke pre-bundling it.
  optimizeDeps: { exclude: ['./src/engine/vendor/orkengine.mjs'] },
  // The sim worker (engine/simWorker.ts) is a module worker that dynamic-imports
  // the engine, so its bundle is code-split — which needs the ES worker format
  // (the default 'iife' can't code-split).
  worker: { format: 'es' },
});

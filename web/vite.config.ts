import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
const { version } = pkg;

// The Help/docs link. Prefer the explicit `wiki.url` in package.json; fall back to
// the repository URL + "/wiki" (normalized: strip the "git+" prefix / ".git" suffix).
// Single source in package.json, plus a build-time override:
//   HELP_URL=https://docs.example.com npm run build
const repoUrl: string = (pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
const helpUrl: string = process.env.HELP_URL || pkg.wiki?.url || (repoUrl ? `${repoUrl}/wiki` : '');

// Where the About dialog's "contributors" heading links. Same shape as the Help
// link: `contributorsPage.url` in package.json (NOT `contributors` — that key is
// npm's own people array), else the repository's contributor graph. Build-time
// override:
//   CONTRIBUTORS_URL=https://example.com/team npm run build
// Set either to '' to render the heading as plain, unlinked text.
const contributorsUrl: string =
  process.env.CONTRIBUTORS_URL ?? pkg.contributorsPage?.url ?? (repoUrl ? `${repoUrl}/graphs/contributors` : '');

export default defineConfig({
  // On GitHub Pages the app is served from https://<user>.github.io/<repo>/, so the
  // CI build sets PAGES_BASE=/<repo>/ and every asset + engine URL resolves under it.
  // Local dev/preview leave it unset → '/', so nothing changes locally.
  base: process.env.PAGES_BASE || '/',
  plugins: [
    react(),
    tailwindcss(),
    // Offline support. Everything the app needs is static (the WASM kernel runs
    // the physics in-browser; there is no backend), so it can work fully offline
    // once cached — which matters at a launch site with no signal.
    VitePWA({
      // 'prompt', not 'autoUpdate': a silent activate reloads the page, which would
      // interrupt an edit in progress. UpdateToast asks first.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'AstraRocketJs',
        short_name: 'AstraRocket',
        description: 'Design and simulate model rockets in your browser.',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        display: 'standalone',
        orientation: 'any',
        // Resolved against `base`, so this works under the /<repo>/ Pages subpath.
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          // Separate entry: launchers crop to a circle/squircle, and the "any"
          // icons would lose their fins to that crop.
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // .wasm and the public/data catalogs are not in the default glob.
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,json}'],
        // The JS engine is a ~970 kB FALLBACK backend, emitted twice (main thread
        // + sim worker). WASM-GC is the path essentially every current browser
        // takes, so precaching ~1.9 MB of unused fallback on every install is a
        // bad trade — the runtimeCaching rule below stores it on first use, which
        // is when we learn the browser actually needs it.
        globIgnores: ['**/openrocket-engine-*.js'],
        // The WASM kernel alone is ~2.5 MB, over Workbox's 2 MiB default.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // The docs site is copied into dist/docs at deploy time, so it is NOT
        // part of the precache — but the SW's navigation fallback would still
        // answer every /docs/ navigation with the app shell, replacing the docs
        // with the app for anyone who has visited before. Exclude them.
        navigateFallbackDenylist: [/\/docs\//],
        runtimeCaching: [
          {
            // Catalogs published to the `data` branch (see sync-catalogs.yml).
            // Stale-while-revalidate: render instantly from cache, refresh in the
            // background, so a weekly catalog refresh lands on the next open.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/gh\/.*@data\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'astra-catalogs',
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // The excluded JS-engine fallback: cache it the first time a browser
            // that needs it actually loads it.
            urlPattern: /\/openrocket-engine-[\w-]+\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'astra-engine-js',
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  // Expose the package version to the app (shown in the header).
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __HELP_URL__: JSON.stringify(helpUrl),
    __CONTRIBUTORS_URL__: JSON.stringify(contributorsUrl),
  },
  // The vendored TeaVM engine is a large ES module; don't let esbuild choke pre-bundling it.
  optimizeDeps: { exclude: ['./src/engine/vendor/orkengine.mjs'] },
  // The sim worker (engine/simWorker.ts) is a module worker that dynamic-imports
  // the engine, so its bundle is code-split — which needs the ES worker format
  // (the default 'iife' can't code-split).
  worker: { format: 'es' },
});

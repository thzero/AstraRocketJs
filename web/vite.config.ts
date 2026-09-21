import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
// The version the app reports. Overridable so scripts/check-update-flow.mjs can
// build two distinguishable versions from one checkout and watch the service
// worker hand one over to the other; nothing else sets it.
const version: string = process.env.APP_VERSION_OVERRIDE || pkg.version;

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
        //
        // The catalogs (public/data/*.generated.json, ~2.6 MB) are precached
        // ON PURPOSE, and it is a real double: the deployed app reads them from
        // the CDN copy on the `data` branch first (VITE_DATA_BASE in deploy.yml)
        // and the runtimeCaching rule below stores that copy too. But the CDN
        // is tried first and the in-build copy is the FALLBACK
        // (services/remoteData.ts), so a runtime rule for /data/ would only
        // ever fill on a session where the CDN had already failed. Someone who
        // installs the app online and first opens the motor picker at a launch
        // site with no signal gets an empty picker unless the in-build copy was
        // precached at install. Offline at first open is the stated goal of the
        // PWA (the comment on VitePWA above), so the 2.6 MB stays in the
        // precache and the CDN copy is the one that refreshes.
        // `ork` is in here for the bundled OpenRocket examples
        // (public/examples/, see services/exampleLibrary.ts). All seventeen come
        // to ~340 kB with their stored flight data stripped, which is cheap
        // enough to buy the same promise the rest of the app makes: an example
        // opens on a first offline load, not only if you happened to be online
        // when you went looking for one.
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,json,ork}'],
        // The JS engine is a ~970 kB FALLBACK backend, emitted twice (main thread
        // + sim worker). WASM-GC is the path essentially every current browser
        // takes, so precaching ~1.9 MB of unused fallback on every install is a
        // bad trade — the runtimeCaching rule below stores it on first use, which
        // is when we learn the browser actually needs it.
        globIgnores: ['**/openrocket-engine-*.js'],
        // The WASM kernel alone is ~2.5 MB, over Workbox's 2 MiB default.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // No precache-first navigation route. With it, every page load was
        // answered from the worker's precache, so a plain reload could NEVER
        // show a new deploy: the page stayed on the old build until the toast
        // fired (after the CDN's ten-minute cache let the new worker through),
        // and people learned to hard-reload instead, which is the one thing a
        // PWA is supposed to spare them. Page loads go network-first below.
        navigateFallback: null,
        // And no directory-index mapping in the precache route. Workbox
        // registers that route before every runtime route, and with the
        // default it answers a navigation to the site root with the precached
        // index.html itself, so the network-first rule below was never
        // reached (the check in scripts/check-update-flow.mjs caught exactly
        // that). The fallback below names index.html explicitly, so offline
        // still gets the shell.
        directoryIndex: '',
        runtimeCaching: [
          {
            // Page loads: the network copy of index.html when it answers within
            // a few seconds, else the precached shell (offline, or a dead link
            // at a launch site). Online, a reload therefore shows whatever the
            // CDN is serving, exactly what a hard reload would, and the hashed
            // assets it references are fetched or precached as usual. The
            // toast still handles a tab that stays open across a deploy.
            //
            // /docs/ is the Docusaurus site copied into dist at deploy time;
            // a docs page must never fall back to the app shell.
            urlPattern: ({ request, url }) => request.mode === 'navigate' && !url.pathname.includes('/docs/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'astra-shell',
              networkTimeoutSeconds: 3,
              precacheFallback: { fallbackURL: 'index.html' },
              cacheableResponse: { statuses: [200] },
            },
          },
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
          {
            // Launch-site map tiles (components/sim/SiteMap.tsx).
            //
            // Cache-first, and this is the point of the map rather than a
            // nicety: a pad you checked at home has to draw at the field, and
            // the field is where there is no signal. A tile is a picture of
            // the ground, so a stale one is still right - Esri and OSM change
            // imagery on the order of years - which is why nothing revalidates.
            //
            // Capped at 600 tiles, a little over a screenful at each zoom for
            // a handful of pads, so browsing the world does not grow without
            // limit; Workbox evicts the least recently used past that.
            urlPattern:
              /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/(World_Imagery|World_Street_Map)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'astra-map-tiles',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
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
  // The vendored TeaVM engine (src/engine/vendor/openrocket-engine.mjs) is a
  // large ES module, and it used to be listed under `optimizeDeps.exclude` so
  // esbuild would not pre-bundle it. That entry was a no-op: `exclude` takes
  // bare package specifiers (`three`, `@react-three/fiber`), and a relative
  // source path never matches. It did not need to: the dependency optimizer
  // only pre-bundles node_modules, and a file under src/ is served as-is by
  // Vite's transform pipeline, so the engine was never being pre-bundled.
  // The sim worker (engine/simWorker.ts) is a module worker that dynamic-imports
  // the engine, so its bundle is code-split — which needs the ES worker format
  // (the default 'iife' can't code-split).
  worker: { format: 'es' },
});

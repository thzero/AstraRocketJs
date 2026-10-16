import { readFileSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/** The package.json fields this config reads. */
interface PackageInfo {
  version: string;
  repository?: { url?: string };
  wiki?: { url?: string };
  contributorsPage?: { url?: string };
}
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as PackageInfo;
// The version the app reports. Overridable so scripts/check-update-flow.mjs can
// build two distinguishable versions from one checkout and watch the service
// worker hand one over to the other; nothing else sets it.
const version: string = process.env.APP_VERSION_OVERRIDE || pkg.version;

/**
 * This build's id: the time it was built, so a later build always has a higher
 * one. A browser treats any service worker script that differs from the running
 * one as an update, older included, and the GitHub Pages CDN can serve the
 * previous sw.js from some of its nodes for minutes after a deploy. So the page
 * asks the waiting and active workers for their ids and takes the waiting one up
 * only when its id is higher (services/app/swBuild.ts). The worker answers from a small
 * script named per build, so no node can serve a stale copy of it.
 */
const buildId = Date.now();
const swBuildFile = `sw-build-${buildId}.js`;
const swBuildSource = `// Answers the page's "which build are you?" (services/app/swBuild.ts).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_BUILD' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ build: ${buildId} });
  }
});
`;

// The Help/docs link. Prefer the explicit `wiki.url` in package.json; fall back to
// the repository URL + "/wiki" (normalized: strip the "git+" prefix / ".git" suffix).
// Single source in package.json, plus a build-time override:
//   HELP_URL=https://docs.example.com npm run build
const repoUrl: string = (pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
const helpUrl: string = process.env.HELP_URL || pkg.wiki?.url || (repoUrl ? `${repoUrl}/wiki` : '');

// Where the About dialog's "contributors" heading links. Same shape as the Help
// link: `contributorsPage.url` in package.json (not `contributors`: that key is
// npm's own people array), else the repository's contributor graph. Build-time
// override:
//   CONTRIBUTORS_URL=https://example.com/team npm run build
// Set either to '' to render the heading as plain, unlinked text.
const contributorsUrl: string =
  process.env.CONTRIBUTORS_URL ?? pkg.contributorsPage?.url ?? (repoUrl ? `${repoUrl}/graphs/contributors` : '');

// Which OpenRocket this build is, read from engine-java/extract/UPSTREAM - the
// one file that names the pinned commit and the one a bump touches. The About
// dialog shows it so "the same physics core" has an answer a reader can check:
// a short SHA, its date, and a link to the commit itself.
//
// Read, never copied. A version string typed into the dialog (or into a doc, or
// into a README) is a second copy of a SHA, and the copy is what goes stale -
// silently, since nothing compares it to anything.
const upstreamText = readFileSync(new URL('../engine-java/extract/UPSTREAM', import.meta.url), 'utf-8');
// `key = value` lines, ignoring the long header (every comment line is `#`).
const upstreamFields = new Map(
  upstreamText
    .split('\n')
    .map((line) => /^(\w+)\s*=\s*(\S+)/.exec(line))
    .filter((m) => m !== null)
    .map((m) => [m[1]!, m[2]!] as const),
);
const upstreamField = (key: string): string => {
  const value = upstreamFields.get(key);
  if (!value) throw new Error(`engine-java/extract/UPSTREAM has no \`${key}\` line`);
  return value;
};
const upstreamRef = upstreamField('ref');
// https://github.com/owner/name.git -> https://github.com/owner/name
const upstreamRepo = upstreamField('repo').replace(/\.git$/, '');
const upstream = {
  ref: upstreamRef,
  // Nine hex, which is how this repo writes a short OpenRocket SHA everywhere
  // else (UPSTREAM's own `describe`, the patch ledger).
  shortRef: upstreamRef.slice(0, 9),
  date: upstreamField('date'),
  commitUrl: `${upstreamRepo}/commit/${upstreamRef}`,
};

/**
 * The catalogs a data-host build reads from the host and nowhere else
 * (services/app/remoteData.ts). Such a build leaves its own copy of them out of
 * the output and the precache, so the app can never fall back to a catalog
 * older than the published one. Offline, the service worker answers from its
 * cached download (the `astra-catalogs` rules below). Dev, preview and a build
 * with no data host keep reading public/data.
 */
const hostedCatalogs = process.env.VITE_DATA_BASE?.trim()
  ? ['data/motors.generated.json', 'data/components.generated.json']
  : [];

export default defineConfig({
  // On GitHub Pages the app is served from https://<user>.github.io/<repo>/, so the
  // CI build sets PAGES_BASE=/<repo>/ and every asset + engine URL resolves under it.
  // Local dev/preview leave it unset → '/', so nothing changes locally.
  base: process.env.PAGES_BASE || '/',
  plugins: [
    react(),
    tailwindcss(),
    // The service worker's build-id script (see buildId above).
    {
      name: 'sw-build-id',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: swBuildFile, source: swBuildSource });
      },
    },
    (() => {
      // The folder the build wrote, not `./dist`: a build given `--outDir`
      // would otherwise keep the hosted catalogs and delete them from dist.
      let outDir = '';
      return {
        name: 'drop-hosted-catalogs',
        apply: 'build' as const,
        configResolved(config: { root: string; build: { outDir: string } }) {
          outDir = resolvePath(config.root, config.build.outDir);
        },
        closeBundle() {
          for (const file of hostedCatalogs) rmSync(resolvePath(outDir, file), { force: true });
        },
      };
    })(),
    // Offline support. Everything the app needs is static (the WASM kernel runs
    // the physics in-browser; there is no backend), so it can work fully offline
    // once cached, which matters at a launch site with no signal.
    VitePWA({
      // 'prompt', not 'autoUpdate': a silent activate reloads the page, which would
      // interrupt an edit in progress. UpdateToast asks first.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png'],
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
        // The catalogs in the build (public/data/*.generated.json) are
        // precached. In a data-host build that is the materials and the
        // contributors only: the motors and components come from the host, are
        // kept by the `astra-catalogs` rule below, and are fetched in the
        // background on every visit (services/app/warmCatalogs.ts), so an app
        // opened once online still has them at a launch site with no signal.
        // The rule sees only a page the worker controls, and the first visit is
        // not one, so there warmCatalogs.ts writes them to that cache itself.
        // `ork` is in here for the bundled OpenRocket examples
        // (public/examples/, see services/storage/exampleLibrary.ts). The set comes
        // to ~340 kB with their stored flight data stripped, which is cheap
        // enough to buy the same promise the rest of the app makes: an example
        // opens on a first offline load, not only if you happened to be online
        // when you went looking for one.
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,json,ork}'],
        // The JS engine is a ~1.1 MB fallback backend, emitted twice (main thread
        // + sim worker). WASM-GC is the path essentially every current browser
        // takes, so precaching ~2.2 MB of unused fallback on every install is a
        // bad trade: the runtimeCaching rule below stores it on first use, which
        // is when we learn the browser actually needs it.
        //
        // The docs site's own search index is the other one: 2.2 MB across the two
        // locales, and the search box it feeds lives in the Docusaurus navbar,
        // which `website/src/css/custom.css` hides whenever a page is embedded in
        // the Help dialog. So precaching it would cost every install 2.2 MB for a
        // control nobody in the app can reach. It stays available to anyone reading
        // the published site, which is who the plugin is for, and the Help dialog
        // searches the same pages its own way.
        globIgnores: [
          '**/openrocket-engine-*.js',
          '**/search-index*.json',
          '**/sw-build-*.js',
          ...hostedCatalogs.map((file) => `**/${file}`),
        ],
        // Loaded by sw.js itself, so it answers which build it is (see buildId).
        importScripts: [swBuildFile],
        // The WASM kernel alone is ~2.5 MB, over Workbox's 2 MiB default.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // `?v=<hash>` has to be ignored when matching the precache, or the
        // runtime catalogs are unreachable offline.
        //
        // remoteData.ts appends the manifest's content hash to every catalog
        // URL so a CDN cannot serve a stale copy. manifest.json is itself
        // precached, so with the network off the app still reads a hash and
        // still asks for `data/motors.generated.json?v=429fee4cf0b3` - and
        // Workbox keys the precache on `data/motors.generated.json`, so the
        // query would make every one of those a miss. Offline, the request would
        // fall through every runtime rule (they cover page loads, docs pages,
        // the jsDelivr host, the engine fallback, the report fonts and map
        // tiles) and fail at the network: no motors,
        // no components, no materials, on the one device that is at a launch
        // site with no signal. Workbox's default ignores only `utm_*` and
        // `fbclid`.
        //
        // Ignoring it costs nothing. The in-build copy changes only when the
        // app is rebuilt, and a rebuild changes the precache revision, which
        // is what actually busts this cache. The separately deployed catalog
        // host - the copy the hash exists for - is a different origin and is
        // answered by its own StaleWhileRevalidate rule below, which this does
        // not touch.
        //
        // `?retry=<n>` is the engine Retry (retryUrl in engine/openRocketEngine.ts).
        // A retry needs a url the browser has not already got in flight, but the
        // file it names is the precached one, and offline the precache is the
        // only copy there is.
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^v$/, /^retry$/],
        cleanupOutdatedCaches: true,
        // No precache-first navigation route. With one, every page load would be
        // answered from the worker's precache, so a plain reload could never
        // show a new deploy: the page would stay on the old build until the toast
        // fired (after the CDN's ten-minute cache let the new worker through),
        // and people would hard-reload instead, which is the one thing a PWA is
        // supposed to spare them. Page loads go network-first below.
        navigateFallback: null,
        // And no directory-index mapping in the precache route. Workbox
        // registers that route before every runtime route, and with the
        // default it answers a navigation to the site root with the precached
        // index.html itself, so the network-first rule below would never be
        // reached (scripts/check-update-flow.mjs checks for this). The fallback
        // below names index.html explicitly, so offline still gets the shell.
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
            // a docs page must never fall back to the app shell, so it is
            // excluded here and handled by the rule below instead.
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
            // Docs pages reached by navigation: the Help menu's "open on the
            // docs site" link, or a docs URL someone bookmarked or was sent.
            //
            // Every docs page is already precached, but under its file key,
            // `docs/<slug>/index.html`. A navigation asks for
            // `docs/<slug>/`, and `directoryIndex` is disabled above, so
            // Workbox never tries the index.html form of it and the request
            // would go to the network and fail offline. Turning directoryIndex
            // back on is not the fix: it is one setting for the whole precache
            // route, and the reason it is off is that it also answers the
            // app's own root from the precache, which would stop a plain
            // reload from ever showing a new deploy.
            //
            // So a rule of its own: network-first, and offline it serves back
            // any docs page already visited. The in-app Help dialog does not
            // rely on this at all, because it requests
            // `docs/<slug>/index.html` directly and that is the precache key
            // (services/app/helpDocs.ts). This is the fallback for reading the
            // docs outside the dialog.
            //
            // It does mean a visited page is stored twice, once precached and
            // once here. Capped at 40 entries, which is more pages than the
            // site has.
            urlPattern: ({ request, url }) => request.mode === 'navigate' && url.pathname.includes('/docs/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'astra-docs',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // The data host's manifest.json (services/app/remoteData.ts): a
            // content hash per published catalog, which the page appends to
            // each catalog URL as `?v=<hash>`. Network first, so an online open
            // reads the hash the host serves now and asks for the catalog under
            // it, which the catalog rule below then stores; the cached manifest
            // answers only when the network fails or takes over three seconds,
            // and then it names the `?v=<hash>` copies the cache already holds.
            // A network answer that lands after the timeout is stored too, so
            // until the next online open the cached manifest can name a copy
            // the cache does not hold.
            //
            // Stale-while-revalidate here would hand the page the previous
            // manifest on the first open after a refresh while storing the new
            // one behind it, and the next offline open would ask for catalogs
            // under hashes nothing cached (scripts/check-offline-data.mjs
            // checks the refresh-then-offline sequence).
            //
            // The same cache as the catalogs, because a page the worker does not
            // control writes the manifest there itself
            // (services/app/warmCatalogs.ts). One URL per host, overwritten in
            // place, so no entry cap.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/gh\/.*@data\/manifest\.json$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'astra-catalogs',
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Catalogs published to the `data` branch (see sync-catalogs.yml),
            // and the only copy of the motors and components a data-host build
            // has offline. Keyed on the whole URL, hash included, so a refreshed
            // catalog is a new entry under its new hash. Stale-while-revalidate:
            // a hash the cache holds renders instantly from cache, and a new one
            // is fetched and stored on the online open that first asks for it,
            // which is the first open after a refresh (the manifest rule above
            // serves the refreshed hash that same open).
            //
            // No maxAgeSeconds: Workbox refuses a cached response older than
            // that, and this is the only offline copy, so a user who has not
            // opened the app online for that long would have no motors and no
            // parts at the field. The `?v=<hash>` keys and the revalidation
            // keep it current, and maxEntries caps how many it holds
            // (scripts/check-offline-data.mjs checks both).
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/gh\/.*@data\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'astra-catalogs',
              expiration: { maxEntries: 16 },
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
            // The PDF report's Unicode fonts (public/fonts, ~2.5 MB in all; see
            // services/report/reportFonts.ts). Not in the precache glob: most
            // reports are WinAnsi text and never ask for them, and the JP pair
            // alone is 2.3 MB. A report that needs one fetches it once and this
            // keeps it, so the same report works at the field. A report that
            // needs a font never fetched prints in Helvetica and says so.
            //
            // Cache-first and never revalidated, so the cache name carries a
            // version: bump it whenever a file in public/fonts changes.
            urlPattern: /\/fonts\/[\w-]+\.ttf$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'astra-report-fonts-v1',
              expiration: { maxEntries: 8 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Map tiles: the launch-site map (components/sim/SiteMap.tsx) and
            // the ground track's imagery (components/canvas/GroundTrack.tsx).
            //
            // Cache-first, and this is the point of the map rather than a
            // nicety: a pad you checked at home has to draw at the field, and
            // the field is where there is no signal. A tile is a picture of
            // the ground, so a stale one is still right - Esri and OSM change
            // imagery on the order of years - which is why nothing revalidates.
            //
            // Capped at 1200 tiles, a little over a screenful at each zoom for
            // a handful of pads, so browsing the world does not grow without
            // limit; Workbox evicts the least recently used past that.
            //
            // No maxAgeSeconds: Workbox refuses a cached response older than
            // that, so a site checked at home longer ago than the limit would
            // draw blank at the field (scripts/check-offline-data.mjs checks
            // the built rule).
            //
            // The ground track pulls tiles around the same pads as the site map,
            // so most of what it asks for is already here, but it sizes its zoom to the
            // flight rather than to SITE_ZOOM and so fills a second zoom level
            // per site. A cap that evicts a pad's imagery to make room for the
            // same pad's imagery at another zoom would break the one promise
            // the cache exists for, which is that a site checked at home draws
            // at the field.
            urlPattern:
              /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/(World_Imagery|World_Street_Map)\//,
            handler: 'CacheFirst',
            options: {
              // v2: the tiles are requested with CORS, because the 3D ground
              // map loads them as WebGL textures. An opaque entry, as cached
              // without CORS, cannot answer a CORS request: it would fail the
              // texture and the plain `<img>` maps that ask the same way. The
              // versioned cache name keeps such entries out.
              cacheName: 'astra-map-tiles-v2',
              expiration: { maxEntries: 1200 },
              cacheableResponse: { statuses: [0, 200] },
              // A tile is cached under its address without the user's Esri
              // key (services/map/esriKey), so adding, renewing or clearing a
              // key still finds every tile already stored, and the key itself
              // is never written into the cache.
              plugins: [
                {
                  cacheKeyWillBeUsed: ({ request }) => {
                    const url = new URL(request.url);
                    url.searchParams.delete('token');
                    return Promise.resolve(url.href);
                  },
                },
              ],
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
    __UPSTREAM__: JSON.stringify(upstream),
  },
  // The vendored TeaVM engine (src/engine/vendor/openrocket-engine.mjs) is a
  // large ES module that needs no `optimizeDeps.exclude` entry: the dependency
  // optimizer only pre-bundles node_modules, and a file under src/ is served
  // as-is by Vite's transform pipeline. (`exclude` takes bare package
  // specifiers anyway, so a relative source path would never match.)
  // The sim worker (engine/simWorker.ts) is a module worker that dynamic-imports
  // the engine, so its bundle is code-split, which needs the ES worker format
  // (the default 'iife' can't code-split).
  worker: { format: 'es' },
});

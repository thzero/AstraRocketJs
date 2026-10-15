// The runtime catalogs with the network switched off, against real builds and
// a real worker.
//
//   npm run e2e:offline-data
//
// Motors, components, materials and contributors are files fetched at run time
// (src/services/app/remoteData.ts), not bundled. Two layouts ship, and each is
// built and checked here:
//
//  1. No data host (`VITE_DATA_BASE` unset): all four are files under
//     public/data, precached by the service worker, so "offline at first open"
//     covers them the way it covers the app shell and the docs.
//
//  2. A data host (`VITE_DATA_BASE` set, as the deploy builds it): motors and
//     components are read from the host only. vite.config.ts leaves them out of
//     the precache (`hostedCatalogs`), so offline they exist only in the
//     `astra-catalogs` runtime cache, which the background warm fetch
//     (warmCatalogs.ts) fills. Materials and contributors stay in the build and
//     the precache.
//
// The hazard in the first layout is the cache-buster. remoteData appends the
// manifest's content hash to every catalog URL so a CDN cannot serve a stale
// copy after the file is replaced. `manifest.json` is itself precached, so with
// the network off the app still reads a hash and still asks for
// `data/motors.generated.json?v=<hash>`. Workbox keys the precache on
// `data/motors.generated.json` and its default `ignoreURLParametersMatching`
// covers only `utm_*` and `fbclid`, so vite.config.ts adds `v` to that list.
// Without it every catalog request misses the precache, falls through each
// runtime rule and fails at the network: no motors, no components, no
// materials, on exactly the device that is standing at a launch site with no
// signal.
//
// The hazard in the second is the chain that fills the runtime cache. The
// first visit is never controlled by the worker (registerType 'prompt', no
// clientsClaim), so the worker's rule never sees its warm fetch and the app has
// to write the catalogs to `astra-catalogs` itself; a later, controlled visit
// relies on the rule, so the host URL has to match its pattern. Either way the
// cached keys have to be the manifest and the `?v=<hash>` URLs the app asks for
// again offline. A break anywhere in it leaves a user who opened the app once
// online with no motors and no parts offline, and no error until a picker
// opens. Both visits are checked: a single uncontrolled one, then a controlled
// one with the cache emptied first.
//
// That cache is also the only offline copy, so nothing may age it out. A rule
// with `maxAgeSeconds` makes Workbox's ExpirationPlugin refuse a cached
// response whose Date header is older than the limit, and a user who has not
// opened the app online for that long has no motors and no parts at the field.
// The built sw.js is read for the rule's options, and before each offline read
// every cached entry is given a Date header a year old. The map tile cache
// holds the imagery of a site checked at home for drawing at the field, so its
// rule is read the same way and may not carry an age either.
//
// The host is answered by the harness: every request to HOST is fulfilled from
// public/data, the service worker's included. HOST has to match the
// `astra-catalogs` urlPattern in vite.config.ts, as the deployed host does.
//
// Nothing else here can see this. The Playwright suite never takes the network
// away from a worker-controlled page, and vitest has no browser.
//
// What is checked is the URL the app actually builds: read manifest.json the
// way the app reads it, from the same base, then ask for every catalog it
// names with the buster attached, and require a parseable body. The
// composition of that URL is remoteData's own, covered by remoteData.test.ts;
// what cannot be tested anywhere but here is whether a service worker answers
// it.
//
// Exit 0 on success, 1 with the failing catalog named.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// The callbacks handed to page.evaluate() run in the browser; the lint config
// for scripts/ knows only Node globals.
/* global caches */

const WEB = fileURLToPath(new URL('..', import.meta.url));
const VITE = resolve(WEB, 'node_modules/vite/bin/vite.js');
const DATA = resolve(WEB, 'public/data');
const OUT = 'dist-offline-data-check';
const OUT_HOSTED = 'dist-offline-data-check-hosted';
const PORT = 4183;
const URL_ = `http://localhost:${PORT}/`;
// The data host the second build reads. Never reached: the harness answers it.
const HOST = 'https://cdn.jsdelivr.net/gh/astra-offline-check/catalogs@data/';
// The catalogs a data-host build reads from the host (vite.config.ts
// `hostedCatalogs`, remoteData.ts `BUILD_ONLY`), and the ones it keeps.
const HOSTED = ['motors', 'components'];
const IN_BUILD = ['materials', 'contributors'];
// vite.config.ts names the runtime caches this way.
const CATALOG_CACHE = 'astra-catalogs';
const MAP_TILE_CACHE = 'astra-map-tiles-v2';
// The runtime caches that hold the only offline copy of what they cache, so
// their rules cap the entry count and never age an entry out.
const NO_AGE_CACHES = [CATALOG_CACHE, MAP_TILE_CACHE];
// The app settings blob (services/storage/settings.ts); the same key e2e/base.ts
// seeds. Spelled out because this is a plain .mjs harness with no TS loader, so it
// cannot import STORAGE_PREFIX. A mismatch is self-detecting: the app would come up
// without settings and the check below would fail.
const SETTINGS_KEY = 'astrarocketjs:settings:v1';

const log = (...a) => console.log('[offline-data]', ...a);

function build(outDir, env = {}) {
  execFileSync(process.execPath, [VITE, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: WEB,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

async function serve(outDir) {
  const child = spawn(process.execPath, [VITE, 'preview', '--outDir', outDir, '--port', String(PORT), '--strictPort'], {
    cwd: WEB,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(URL_);
      if (res.ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('preview server did not come up');
}

/** A page with the pre-release modal acknowledged, as a returning user has it. */
async function openPage(context) {
  const page = await context.newPage();
  // A fresh profile gets the pre-release "work in progress" modal.
  await page.addInitScript((key) => {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(key) || '{}') ?? {};
    } catch {
      // a corrupt blob; the app discards it too, so start clean
    }
    try {
      localStorage.setItem(key, JSON.stringify({ ...stored, wipAcknowledged: true }));
    } catch {
      // about:blank has no storage; the real navigation runs this again
    }
  }, SETTINGS_KEY);
  return page;
}

/** Load the app, let the worker install, and reload so it controls the page. */
async function takeOver(page) {
  await page.goto(URL_);
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), null, { timeout: 60_000 });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 });
}

/**
 * Read catalogs the way remoteData does: each base's manifest first
 * (revalidated), then each catalog it names, cache-busted by that catalog's
 * hash. `only` limits a base to the catalogs the app reads from it.
 */
function readCatalogs(page, sources) {
  return page.evaluate(async (sources) => {
    const get = async (url, init) => {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };
    const out = {};
    for (const { base, only } of sources) {
      let manifest;
      try {
        manifest = await get(`${base}manifest.json`, { cache: 'no-cache' });
      } catch (e) {
        return { manifest: `${base}manifest.json: ${String(e)}` };
      }
      for (const name of only ?? Object.keys(manifest)) {
        const hash = manifest[name];
        if (!hash) {
          out[name] = { ok: false, error: `${base}manifest.json has no hash for it` };
          continue;
        }
        try {
          const body = await get(`${base}${name}.generated.json?v=${hash}`);
          const n = Array.isArray(body) ? body.length : Object.keys(body).length;
          out[name] = { ok: n > 0, entries: n, error: n > 0 ? undefined : 'empty body' };
        } catch (e) {
          out[name] = { ok: false, error: String(e).slice(0, 120) };
        }
      }
    }
    return { catalogs: out };
  }, sources);
}

function report(results, expected) {
  if (results.manifest) throw new Error(`manifest.json is not available offline: ${results.manifest}`);
  const names = Object.keys(results.catalogs);
  const missing = expected.filter((n) => !names.includes(n));
  if (missing.length) {
    throw new Error(
      `manifest.json names ${names.length} catalog(s) (${names.join(', ')}); missing ${missing.join(', ')}`,
    );
  }
  for (const n of names) {
    const r = results.catalogs[n];
    log(` ${r.ok ? 'OK  ' : 'FAIL'} ${n}${r.ok ? ` (${r.entries} entries)` : `: ${r.error}`}`);
  }
  const broken = names.filter((n) => !results.catalogs[n].ok);
  if (broken.length) throw new Error(`unreachable offline: ${broken.join(', ')}`);
}

/**
 * The options of one runtime cache rule's ExpirationPlugin in the built sw.js,
 * as the source text between its braces. Workbox emits each rule as
 * `new X({cacheName:"...",plugins:[new ExpirationPlugin({...}),...]})`.
 */
function ruleExpiration(outDir, cacheName) {
  const sw = readFileSync(resolve(WEB, outDir, 'sw.js'), 'utf8');
  const at = sw.search(new RegExp(`cacheName:\\s*["']${cacheName}["']`));
  if (at < 0) throw new Error(`${outDir}/sw.js has no ${cacheName} rule`);
  const rest = sw.slice(at);
  const end = rest.search(/registerRoute\(/);
  const rule = end < 0 ? rest : rest.slice(0, end);
  const m = rule.match(/ExpirationPlugin\(\{([^}]*)\}\)/);
  if (!m) throw new Error(`the ${cacheName} rule in ${outDir}/sw.js has no ExpirationPlugin`);
  return m[1];
}

/** Each only-copy cache in the built sw.js caps its entries and has no expiry age. */
function checkNoAge(outDir) {
  for (const cacheName of NO_AGE_CACHES) {
    const expiration = ruleExpiration(outDir, cacheName);
    if (/maxAgeSeconds/.test(expiration))
      throw new Error(`the ${cacheName} rule expires entries by age (${expiration}); offline it is the only copy`);
    if (!/maxEntries/.test(expiration)) throw new Error(`the ${cacheName} rule has no maxEntries cap (${expiration})`);
    log(`OK: the ${cacheName} rule caps its entries and has no expiry age`);
  }
}

/** Rewrite every entry in the catalog cache with a Date header a year old. */
function ageCatalogCache(page) {
  return page.evaluate(async (cacheName) => {
    const cache = await caches.open(cacheName);
    const old = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toUTCString();
    const keys = await cache.keys();
    for (const req of keys) {
      const res = await cache.match(req);
      if (!res) continue;
      const headers = new Headers(res.headers);
      headers.set('date', old);
      await cache.put(req, new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers }));
    }
    return keys.length;
  }, CATALOG_CACHE);
}

/** The service worker's precache list, as the URLs it names. */
function precached(outDir) {
  const sw = readFileSync(resolve(WEB, outDir, 'sw.js'), 'utf8');
  const urls = new Set();
  // Workbox inlines the list as `{url:"...",revision:...}` objects; the quote
  // style varies with the minifier.
  for (const m of sw.matchAll(/url:\s*["']([^"']+)["']/g)) urls.add(m[1]);
  // A list this short means the pattern no longer matches the generated file.
  if (urls.size < 10) throw new Error(`could not read the precache list from ${outDir}/sw.js`);
  return urls;
}

async function bundledPass(browser) {
  log('layout 1: no data host, every catalog precached');
  log('building');
  build(OUT);
  const server = await serve(OUT);
  const context = await browser.newContext();
  try {
    const page = await openPage(context);
    log('install the worker and let it take the page');
    await takeOver(page);

    await context.setOffline(true);
    log('network off');

    report(await readCatalogs(page, [{ base: 'data/' }]), [...HOSTED, ...IN_BUILD]);
    log('OK: every runtime catalog loads with the network off, cache-buster and all');
  } finally {
    await context.close();
    server.kill();
  }
}

async function hostedPass(browser) {
  log(`layout 2: data host ${HOST}`);
  log('building');
  build(OUT_HOSTED, { VITE_DATA_BASE: HOST });

  // The layout itself: the hosted catalogs are not precached, the others are.
  const list = precached(OUT_HOSTED);
  for (const n of HOSTED) {
    if (list.has(`data/${n}.generated.json`)) throw new Error(`a data-host build precaches data/${n}.generated.json`);
    if (existsSync(resolve(WEB, OUT_HOSTED, `data/${n}.generated.json`)))
      throw new Error(`a data-host build ships data/${n}.generated.json in ${OUT_HOSTED}`);
  }
  for (const n of IN_BUILD) {
    if (!list.has(`data/${n}.generated.json`))
      throw new Error(`a data-host build does not precache data/${n}.generated.json`);
  }

  // The only offline copy of the hosted catalogs, and of the map tiles, has
  // no expiry age.
  checkNoAge(OUT_HOSTED);

  const files = new Set(readdirSync(DATA));
  const manifest = JSON.parse(readFileSync(resolve(DATA, 'manifest.json'), 'utf8'));
  const server = await serve(OUT_HOSTED);
  const context = await browser.newContext();
  let answered = 0;
  // Every request to the host, the worker's included, answered from public/data.
  const answerHost = () =>
    context.route(`${HOST}**`, (route) => {
      const file = new URL(route.request().url()).pathname.split('/').pop();
      if (!files.has(file)) return route.fulfill({ status: 404, body: 'not found' });
      answered++;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: readFileSync(resolve(DATA, file)),
      });
    });
  // The keys the app asks for offline: the host's manifest, and each catalog
  // with its buster.
  const want = [
    `${HOST}manifest.json`,
    ...HOSTED.map((n) => `${HOST}${n}.generated.json?v=${encodeURIComponent(manifest[n])}`),
  ];

  /** Wait for the background fetch to put every key in the catalog cache. */
  async function waitForCache(page) {
    // The warm fetch runs when the main thread is idle, with a 10 s cap, and on
    // a first visit after the worker has installed.
    const cached = () =>
      page.evaluate(async (cacheName) => {
        if (!(await caches.has(cacheName))) return [];
        return (await (await caches.open(cacheName)).keys()).map((r) => r.url);
      }, CATALOG_CACHE);
    // Polled from here: waitForFunction takes a returned promise as truthy.
    let have = [];
    for (let i = 0; i < 120 && !want.every((u) => have.includes(u)); i++) {
      await new Promise((r) => setTimeout(r, 500));
      have = await cached();
    }
    if (!want.every((u) => have.includes(u))) {
      throw new Error(
        `the ${CATALOG_CACHE} cache never held ${want.join(', ')} (host answered ${answered} request(s); cache has: ${have.join(', ') || 'nothing'})`,
      );
    }
  }

  /** Age the catalog cache, take the network away, reopen the app, and read every catalog. */
  async function readOffline(page) {
    log(`date ${await ageCatalogCache(page)} cached catalog entries a year back`);
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.setOffline(true);
    log('network off; reopen the app');
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 });
    report(
      await readCatalogs(page, [
        { base: HOST, only: HOSTED },
        { base: 'data/', only: IN_BUILD },
      ]),
      [...HOSTED, ...IN_BUILD],
    );
  }

  try {
    await answerHost();
    const page = await openPage(context);
    // One visit and no reload: the worker installs but does not control this
    // page (registerType 'prompt', no clientsClaim), so its runtime rule never
    // sees the warm fetch. The app has to store the catalogs itself.
    log('first visit: let the worker install, with the page left uncontrolled');
    await page.goto(URL_);
    await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), null, { timeout: 60_000 });
    if (await page.evaluate(() => !!navigator.serviceWorker.controller))
      throw new Error('the first visit is controlled by the worker, so it no longer checks an uncontrolled page');
    log('wait for the background fetch to fill the catalog cache');
    await waitForCache(page);
    await readOffline(page);
    log('OK: one online visit leaves the hosted catalogs readable offline');

    // A controlled page: the app leaves storing to the worker's own rule, so the
    // rule's pattern and cache name are what fill the cache here.
    await context.setOffline(false);
    await answerHost();
    await page.evaluate((cacheName) => caches.delete(cacheName), CATALOG_CACHE);
    log('controlled visit: empty the catalog cache and reopen the app online');
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 });
    await waitForCache(page);
    await readOffline(page);
    log('OK: the hosted catalogs load offline from the runtime cache, the others from the precache');
  } finally {
    await context.close();
    server.kill();
  }
}

async function main() {
  const browser = await chromium.launch();
  try {
    await bundledPass(browser);
    await hostedPass(browser);
  } finally {
    await browser.close();
    rmSync(resolve(WEB, OUT), { recursive: true, force: true });
    rmSync(resolve(WEB, OUT_HOSTED), { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(`[offline-data] ${e.message}`);
  process.exit(1);
});

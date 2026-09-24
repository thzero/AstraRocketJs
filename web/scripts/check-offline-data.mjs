// The runtime catalogs with the network switched off, against a real build and
// a real worker.
//
//   npm run e2e:offline-data
//
// Motors, components, materials and contributors are files under public/data
// fetched at run time (src/services/remoteData.ts), not bundled. They are
// precached by the service worker, so "offline at first open" should cover them
// the way it covers the app shell and the docs. It did not.
//
// THE BUG THIS EXISTS FOR. remoteData appends the manifest's content hash to
// every catalog URL so a CDN cannot serve a stale copy after the file is
// replaced. `manifest.json` is itself precached, so with the network off the
// app still READS a hash and still asks for
// `data/motors.generated.json?v=429fee4cf0b3`. Workbox keys the precache on
// `data/motors.generated.json` and its default `ignoreURLParametersMatching`
// covers only `utm_*` and `fbclid`, so every one of those was a miss: the
// request fell through each runtime rule (they cover page loads, the jsDelivr
// host and the engine fallback) and failed at the network. No motors, no
// components, no materials, on exactly the device that is standing at a launch
// site with no signal. The fix is in vite.config.ts, and it is one line; the
// reason it went unnoticed for so long is that nothing looked.
//
// Nothing else here can see this. The Playwright suite runs against the Vite
// DEV server, which registers no worker, and vitest has no browser.
//
// What is checked is the URL the app actually builds: read manifest.json the
// way the app reads it, then ask for every catalog it names with the buster
// attached, and require a parseable body. The composition of that URL is
// remoteData's own, covered by remoteData.test.ts; what cannot be tested
// anywhere but here is whether a service worker answers it.
//
// Exit 0 on success, 1 with the failing catalog named.
import { execFileSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const VITE = resolve(WEB, 'node_modules/vite/bin/vite.js');
const OUT = 'dist-offline-data-check';
const PORT = 4183;
const URL_ = `http://localhost:${PORT}/`;
// The app settings blob (services/settings.ts); the same key e2e/base.ts seeds.
const SETTINGS_KEY = 'astrarrocketjs:settings:v1';

const log = (...a) => console.log('[offline-data]', ...a);

async function serve() {
  const child = spawn(process.execPath, [VITE, 'preview', '--outDir', OUT, '--port', String(PORT), '--strictPort'], {
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

async function main() {
  log('building');
  execFileSync(process.execPath, [VITE, 'build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: WEB,
    stdio: 'inherit',
  });

  const server = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // A fresh profile gets the pre-release "work in progress" modal.
    await page.addInitScript((key) => {
      try {
        const stored = JSON.parse(localStorage.getItem(key) || '{}') ?? {};
        localStorage.setItem(key, JSON.stringify({ ...stored, wipAcknowledged: true }));
      } catch {
        // about:blank has no storage; the real navigation runs this again
      }
    }, SETTINGS_KEY);

    log('install the worker and let it take the page');
    await page.goto(URL_);
    await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), null, { timeout: 60_000 });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 });

    await page.context().setOffline(true);
    log('network off');

    const results = await page.evaluate(async () => {
      const get = async (url, init) => {
        const res = await fetch(url, init);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      };
      // Exactly what remoteData does: the manifest first (revalidated), then
      // each catalog it names, cache-busted by that catalog's hash.
      const manifest = await get('data/manifest.json', { cache: 'no-cache' }).catch((e) => ({ __error: String(e) }));
      if (manifest.__error) return { manifest: manifest.__error };
      const out = {};
      for (const [name, hash] of Object.entries(manifest)) {
        try {
          const body = await get(`data/${name}.generated.json?v=${hash}`);
          const n = Array.isArray(body) ? body.length : Object.keys(body).length;
          out[name] = { ok: true, entries: n };
        } catch (e) {
          out[name] = { ok: false, error: String(e).slice(0, 120) };
        }
      }
      return { catalogs: out };
    });

    if (results.manifest) throw new Error(`manifest.json is not available offline: ${results.manifest}`);
    const names = Object.keys(results.catalogs);
    if (names.length < 4) {
      throw new Error(`manifest.json names only ${names.length} catalog(s) (${names.join(', ')}); expected 4`);
    }
    const broken = names.filter((n) => !results.catalogs[n].ok);
    for (const n of names) {
      const r = results.catalogs[n];
      log(` ${r.ok ? 'OK  ' : 'FAIL'} ${n}${r.ok ? ` (${r.entries} entries)` : `: ${r.error}`}`);
    }
    if (broken.length) throw new Error(`unreachable offline: ${broken.join(', ')}`);

    log('OK: every runtime catalog loads with the network off, cache-buster and all');
  } finally {
    await browser.close();
    server.kill();
    rmSync(resolve(WEB, OUT), { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(`[offline-data] ${e.message}`);
  process.exit(1);
});

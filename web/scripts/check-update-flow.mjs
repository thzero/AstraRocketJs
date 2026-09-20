// The service-worker update flow, end to end, against two real builds.
//
// The dev server registers no service worker, so nothing in the Playwright
// suite can exercise what happens on a deploy: a tab open on the old build must
// see the new one on a plain reload, be offered it by the toast if it stays
// open, and come back on it when Reload is clicked. Every one of those shipped
// broken at some point without anything here noticing: the worker answered
// page loads from its precache (so a reload could never show a deploy and
// people learned to hard-reload), and nothing under vitest can see a worker.
//
// This builds version A into its own output directory, serves it, loads it in
// Chromium until the worker controls the page, then rebuilds version B into the
// same directory and expects, in order: a plain reload shows B; an update check
// raises the toast; the toast's Reload keeps B on screen. No hard reload
// anywhere.
//
//   npm run e2e:update
//
// Exit 0 on success, 1 with the failing step named and a diagnostic of what
// each layer thought the page was. Two production builds plus a browser: about
// two minutes.
import { execFileSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// The callbacks handed to page.evaluate() run in the browser; the lint config
// for scripts/ knows only Node globals.
/* global document, location */

const WEB = fileURLToPath(new URL('..', import.meta.url));
const VITE = resolve(WEB, 'node_modules/vite/bin/vite.js');
const OUT = 'dist-update-check';
const PORT = 4179;
const URL_ = `http://localhost:${PORT}/`;
const VERSION_A = '0.0.0-update-a';
const VERSION_B = '0.0.0-update-b';
// The app settings blob (services/settings.ts); the same key e2e/base.ts seeds.
const SETTINGS_KEY = 'astrarrocketjs:settings:v1';

const log = (...a) => console.log('[update-flow]', ...a);
const chunkOf = (html) => html.match(/assets\/index-[\w-]+\.js/)?.[0] ?? null;

function build(version) {
  log(`building ${version}`);
  execFileSync(process.execPath, [VITE, 'build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: WEB,
    stdio: 'inherit',
    env: { ...process.env, APP_VERSION_OVERRIDE: version },
  });
}

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
  build(VERSION_A);
  const server = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // A fresh profile gets the pre-release "work in progress" modal, which sits
    // above the toast and would swallow the click on Reload. Acknowledge it
    // the way e2e/base.ts does, so this drives a returning user's tab.
    await page.addInitScript((key) => {
      try {
        const stored = JSON.parse(localStorage.getItem(key) || '{}') ?? {};
        localStorage.setItem(key, JSON.stringify({ ...stored, wipAcknowledged: true }));
      } catch {
        // about:blank has no storage; the real navigation runs this again
      }
    }, SETTINGS_KEY);

    // On failure, say what each layer thinks the page is: the server's copy,
    // the copy the worker hands the page, the worker in control, and what
    // rendered. A bare timeout names none of them.
    const diagnose = async () => {
      const info = await page.evaluate(async () => {
        const viaWorker = await fetch(location.href, { cache: 'no-store' }).then((r) => r.text());
        const reg = await navigator.serviceWorker.getRegistration();
        return {
          renderedVersion: document.body.textContent?.match(/v0\.0\.0-update-[ab]/)?.[0] ?? null,
          pageHtml: document.documentElement.outerHTML,
          viaWorkerHtml: viaWorker,
          controller: navigator.serviceWorker.controller?.scriptURL ?? null,
          active: reg?.active?.scriptURL ?? null,
          waiting: reg?.waiting?.scriptURL ?? null,
        };
      });
      const serverHtml = await (await fetch(URL_, { cache: 'no-store' })).text();
      log(
        'diagnostics',
        JSON.stringify(
          {
            renderedVersion: info.renderedVersion,
            pageChunk: chunkOf(info.pageHtml),
            fetchedThroughWorkerChunk: chunkOf(info.viaWorkerHtml),
            serverChunk: chunkOf(serverHtml),
            controller: info.controller,
            active: info.active,
            waiting: info.waiting,
          },
          null,
          2,
        ),
      );
    };
    const step = async (name, fn) => {
      log(name);
      try {
        await fn();
      } catch (e) {
        await diagnose().catch((d) => log('diagnostics unavailable:', d instanceof Error ? d.message : d));
        throw new Error(`FAILED at "${name}": ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    };

    await step('load version A and let its worker take the page', async () => {
      await page.goto(URL_);
      await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), null, { timeout: 60_000 });
      // A returning user's tab: reload once so the page is controlled by the
      // worker regardless of how the first install claimed it.
      await page.reload();
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 });
      await page.getByText(`v${VERSION_A}`, { exact: true }).waitFor({ timeout: 60_000 });
    });

    build(VERSION_B);

    // The complaint this file exists for: a plain reload after a deploy showed
    // the OLD build, because the worker answered page loads from its precache,
    // and people learned to hard-reload. Page loads are network-first now, so
    // an ordinary reload lands on the new build with no toast involved.
    await step('a plain reload shows version B, before any update prompt', async () => {
      await page.reload();
      await page.getByText(`v${VERSION_B}`, { exact: true }).waitFor({ timeout: 60_000 });
    });

    await step('ask the registration for an update', async () => {
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) throw new Error('no registration');
        await reg.update();
      });
    });

    await step('the toast offers the new version', async () => {
      await page.getByText('A new version is available.').waitFor({ timeout: 60_000 });
    });

    await step('the toast Reload keeps version B on screen', async () => {
      await page.getByRole('button', { name: 'Reload', exact: true }).click();
      await page.getByText(`v${VERSION_B}`, { exact: true }).waitFor({ timeout: 60_000 });
    });

    // Network-first page loads must not cost the PWA its reason to exist:
    // with the network gone, a reload still gets the shell (the precached
    // index.html through the fallback) and the app still boots.
    await step('offline, a reload still boots the app from the worker', async () => {
      const failed = [];
      const errors = [];
      const onFailed = (r) => failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`);
      const onConsole = (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text());
      page.on('requestfailed', onFailed);
      page.on('console', onConsole);
      await page.context().setOffline(true);
      try {
        // A reload while offline can reject at the navigation layer even when
        // the worker answered it; what matters is whether the app boots.
        await page
          .reload({ waitUntil: 'commit' })
          .catch((e) => log('reload while offline:', String(e.message).split(/\r?\n/)[0]));
        await page.getByText(`v${VERSION_B}`, { exact: true }).waitFor({ timeout: 60_000 });
      } catch (e) {
        log('offline failed requests:', JSON.stringify(failed.slice(0, 12), null, 2));
        log('offline console errors:', JSON.stringify(errors.slice(0, 12), null, 2));
        log(
          'offline page text:',
          JSON.stringify((await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')).slice(0, 300)),
        );
        throw e;
      } finally {
        page.off('requestfailed', onFailed);
        page.off('console', onConsole);
        await page.context().setOffline(false);
      }
    });

    log('OK: a plain reload and the toast both put the new build on screen, and offline still boots');
  } finally {
    await browser.close();
    server.kill();
    rmSync(resolve(WEB, OUT), { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

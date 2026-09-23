// Help with the network switched off, against a real build and a real worker.
//
//   npm run e2e:offline-help
//
// The Playwright suite runs against the Vite DEV server, which registers no
// service worker, so nothing in it can see whether Help actually works at a
// launch site with no signal. That is the whole reason the docs are built into
// the app rather than only published, so it is worth a check of its own.
//
// Two things are proven here, and they are cached by different mechanisms:
//
//  1. The in-app Help dialog opens a page NOBODY HAS READ, offline. It asks for
//     `docs/<slug>/index.html`, which is the key Workbox precaches each page
//     under, so every page is available from the first install onward. This is
//     the promise the feature is for.
//
//  2. Navigating straight to a docs URL still works offline for a page already
//     visited. Those requests go to `docs/<slug>/`, which the precache does NOT
//     answer (`directoryIndex` is off, see vite.config.ts), so they are covered
//     by the `astra-docs` runtimeCaching rule instead.
//
// Needs web/public/docs to exist: `npm run docs:build` first, which the deploy
// does for itself. Exit 0 on success, 1 with the failing step named.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const VITE = resolve(WEB, 'node_modules/vite/bin/vite.js');
const DOCS = resolve(WEB, 'public/docs/index.html');
const OUT = 'dist-offline-check';
const PORT = 4181;
const URL_ = `http://localhost:${PORT}/`;
// The app settings blob (services/settings.ts); the same key e2e/base.ts seeds.
const SETTINGS_KEY = 'astrarrocketjs:settings:v1';

// Pages nobody opens before going offline. The first is read through the
// dialog, the second by navigating at it directly.
const UNREAD_PAGE = { menuItem: 'Safety', heading: 'Safety' };
const DIRECT_PAGE = 'docs/motors/';

const log = (...a) => console.log('[offline-help]', ...a);

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
  if (!existsSync(DOCS)) {
    throw new Error('web/public/docs is empty: run `npm run docs:build` first (the deploy does this for itself)');
  }

  log('building');
  execFileSync(process.execPath, [VITE, 'build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: WEB,
    stdio: 'inherit',
  });

  const server = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // A fresh profile gets the pre-release "work in progress" modal, whose
    // backdrop would swallow the click on the menu.
    await page.addInitScript((key) => {
      try {
        const stored = JSON.parse(localStorage.getItem(key) || '{}') ?? {};
        localStorage.setItem(key, JSON.stringify({ ...stored, wipAcknowledged: true }));
      } catch {
        // about:blank has no storage; the real navigation runs this again
      }
    }, SETTINGS_KEY);

    const failed = [];
    page.on('requestfailed', (r) => failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`));

    const step = async (name, fn) => {
      log(name);
      try {
        await fn();
      } catch (e) {
        log('failed requests:', JSON.stringify(failed.slice(-12), null, 2));
        throw new Error(`FAILED at "${name}": ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    };

    await step('install the worker and let it take the page', async () => {
      await page.goto(URL_);
      await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), null, { timeout: 60_000 });
      await page.reload();
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 });
    });

    await step(`visit ${DIRECT_PAGE} once, ONLINE, so the runtime rule has it`, async () => {
      await page.goto(URL_ + DIRECT_PAGE);
      await page.locator('article h1').waitFor({ timeout: 30_000 });
      await page.goto(URL_);
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 });
    });

    await page.context().setOffline(true);
    log('network off');

    await step(`offline, Help opens "${UNREAD_PAGE.heading}", a page never read`, async () => {
      await page.getByRole('button', { name: 'Menu' }).click();
      await page.getByRole('menuitem', { name: UNREAD_PAGE.menuItem }).click();
      // The article inside the frame, not the dialog heading: this has to fail
      // if the frame came up on the "open it online" fallback instead.
      const article = page.frameLocator('iframe[title="Help"]').locator('article h1');
      await article.waitFor({ timeout: 30_000 });
      const text = (await article.textContent())?.trim();
      if (text !== UNREAD_PAGE.heading) throw new Error(`frame shows ${JSON.stringify(text)}`);
    });

    await step(`offline, ${DIRECT_PAGE} still loads by direct navigation`, async () => {
      await page.goto(URL_ + DIRECT_PAGE, { waitUntil: 'commit' }).catch((e) => {
        // A navigation while offline can reject at the navigation layer even
        // when the worker answered it; what rendered is what matters.
        log('navigation while offline:', String(e.message).split(/\r?\n/)[0]);
      });
      await page.locator('article h1').waitFor({ timeout: 30_000 });
    });

    log('OK: Help reads offline, both through the dialog and by direct navigation');
  } finally {
    await browser.close();
    server.kill();
    rmSync(resolve(WEB, OUT), { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(`[offline-help] ${e.message}`);
  process.exit(1);
});

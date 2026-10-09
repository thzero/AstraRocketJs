// cspell:ignore Инструменты Hulpmiddelen Opgeslagen язык
import { test, expect, runFlight, ready, box } from './base';

/**
 * A face wider than the system font of whatever machine is running the test.
 *
 * `system-ui` is whatever the OS supplies: Segoe UI on Windows, DejaVu Sans on a
 * Linux runner, about 12% wider for the same text at the same size. A width
 * budget measured in the narrow one and asserted as a pixel height passes on the
 * machine it was measured on and wraps the header to two lines on the other, and
 * on any Linux or ChromeOS user's screen with it.
 *
 * Verdana is that wide face where it is installed, and falls back to the same
 * generic sans-serif a Linux runner already uses where it is not, so the row is
 * measured in a wide face either way. `!important` to beat Tailwind's preflight
 * on `html`, and `header *` because the tabs and the badges set their own family
 * through utility classes.
 */
const WIDE_FACE = 'html, body, header, header * { font-family: Verdana, sans-serif !important; }';

/**
 * The desktop workbench tabs sit in the header, not in a strip below it.
 *
 * A row of their own costs a full line to hold two or three words while the header
 * beside them runs empty from the WASM badge to the far-right controls. Asserted
 * geometrically rather than by class name: what matters is that the tabs cost no
 * vertical space, which is exactly "the nav is inside the header's box", and that
 * nothing wraps the header onto a second line.
 *
 * Desktop-only, and in its own file for that reason: it measures the header
 * at the lg breakpoint exactly (1024), where the phone project's emulation
 * (isMobile, DPR 2.625) keeps the desktop nav in the DOM but unrendered, and
 * mobile-layout.spec.ts is run by that project.
 */
test('the workbench tabs live in the header rather than a row of their own', async ({ page }) => {
  // The narrowest desktop width (the lg breakpoint), with all five tabs showing.
  await page.setViewportSize({ width: 1024, height: 900 });
  await ready(page);
  await runFlight(page);

  const header = page.locator('header').first();
  // The save status is part of the tightest state, and it only appears once the
  // debounced autosave lands - a tick or two after the run. Measured before it
  // arrives the header is lighter than the one anybody sees.
  await expect(header.getByText(/^Saved/)).toBeVisible();
  await page.addStyleTag({ content: WIDE_FACE });

  const nav = page.getByRole('navigation', { name: /Workbench/i });
  await expect(nav.getByRole('button')).toHaveCount(5);

  const h = await box(header);
  const n = await box(nav);

  // Inside the header, horizontally and vertically: the tabs cost no strip of
  // their own, which is the whole point of putting them here.
  expect(n.x).toBeGreaterThan(h.x);
  expect(n.y).toBeGreaterThanOrEqual(h.y);
  expect(n.y + n.height).toBeLessThanOrEqual(h.y + h.height + 1);
  expect(n.x + n.width).toBeLessThan(h.x + h.width);

  // And the first pane starts immediately under it, with no strip in between.
  expect((await box(page.locator('main'))).y).toBeLessThanOrEqual(h.y + h.height + 1);

  // One row at this width in English, in a face wider than the local one. The
  // wordiest languages wrap here - there is not enough width at 1024 for five
  // tabs, the identity block, the save status and four controls in German - and
  // that is what the second test pins.
  expect(h.height).toBeLessThan(70);
});

/**
 * The identity block reads the same at every width, and the row is one line from
 * 1180 up in the worst language there is.
 *
 * The mark, the app name, the version, the pre-release word and the engine
 * backend are what the header answers at a glance, so no breakpoint takes one of
 * them away: a narrower window must not mean a different header. What gives
 * instead is the save status' age and the menu button's word, below xl, the
 * header's gaps and its icon buttons' padding between lg and xl, and
 * below 1180 the row wraps in the wordiest languages rather than dropping any of
 * the five.
 *
 * Measured in {@link WIDE_FACE}, not in the one the developer happens to have,
 * and in European Portuguese, which is the worst case twice over: its own name is
 * the longest in the language switcher, and 'Pré-visualização' is the longest
 * translation of the pre-release word. Russian and Dutch are checked at 1180 too:
 * their words for the tabs, 'Инструменты' and 'Hulpmiddelen' above all, are
 * the longest, and leave the row only a few pixels to spare.
 */
test('the identity block is the same at every width, and the row fits from 1180', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await ready(page);
  await runFlight(page);

  const header = page.locator('header').first();
  await expect(header.getByText(/^Saved/)).toBeVisible();
  await page.getByRole('combobox', { name: /language|idioma/i }).selectOption('pt-PT');
  await expect(header.getByText(/^Guardado/)).toBeVisible();
  await page.addStyleTag({ content: WIDE_FACE });

  const title = header.getByRole('heading', { level: 1 });
  const mark = header.getByText('🚀');
  // The version opens About, so it is a button; the backend names itself only in
  // its tooltip, where the product names are latin in every language.
  const version = header.getByRole('button', { name: /^v\d/ });
  const backend = header.getByTitle(/WebAssembly|JavaScript/);

  // Every width a desktop layout is drawn at, and a phone width under them.
  for (const width of [1440, 1280, 1180, 1120, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(mark).toBeVisible();
    expect((await box(title)).width).toBeGreaterThan(50);
    await expect(version).toBeVisible();
    await expect(backend).toBeVisible();
    // The pre-release word travels with them: it is the widest of the five and
    // so the first thing a width budget would be tempted to drop.
    expect((await box(version.locator('..'))).width).toBeGreaterThan(90);
  }

  // One row from 1180 up, in this language and this face.
  for (const width of [1180, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await box(header)).height).toBeLessThan(70);
  }

  await page.setViewportSize({ width: 1180, height: 900 });
  for (const [lang, saved] of [
    ['ru', /^Сохранено/],
    ['nl', /^Opgeslagen/],
  ] as const) {
    await page.getByRole('combobox', { name: /language|idioma|язык|taal/i }).selectOption(lang);
    await expect(header.getByText(saved)).toBeVisible();
    expect((await box(header)).height, lang).toBeLessThan(70);
  }
});

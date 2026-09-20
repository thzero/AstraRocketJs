import { test, expect, runFlight, ready, box } from './base';

/**
 * The desktop workbench tabs sit IN the header, not in a strip below it.
 *
 * They used to own a full row of their own to hold two or three words, while the
 * header beside them ran empty from the WASM badge to the far-right controls.
 * Asserted geometrically rather than by class name: what matters is that the
 * tabs cost no vertical space, which is exactly "the nav is inside the header's
 * box", and that nothing wraps the header onto a second line.
 *
 * Desktop-only, and in its own file for that reason: it measures the header
 * at the lg breakpoint EXACTLY (1024), where the phone project's emulation
 * (isMobile, DPR 2.625) keeps the desktop nav in the DOM but unrendered, and
 * mobile-layout.spec.ts is run by that project.
 */
test('the workbench tabs live in the header rather than a row of their own', async ({ page }) => {
  // The narrowest desktop width (the lg breakpoint), in the longer of the two
  // languages, with all three tabs showing - the tightest the header ever gets
  // before the bottom bar takes over.
  await page.setViewportSize({ width: 1024, height: 900 });
  await ready(page);
  await runFlight(page);
  await page.getByRole('combobox', { name: /language|idioma/i }).selectOption('es');

  const header = page.locator('header').first();
  const nav = page.getByRole('navigation', { name: /Workbench|Banco/i });
  await expect(nav.getByRole('button')).toHaveCount(3);

  const h = await box(header);
  const n = await box(nav);

  // Inside the header, horizontally and vertically.
  expect(n.x).toBeGreaterThan(h.x);
  expect(n.y).toBeGreaterThanOrEqual(h.y);
  expect(n.y + n.height).toBeLessThanOrEqual(h.y + h.height + 1);
  expect(n.x + n.width).toBeLessThan(h.x + h.width);

  // One row: the header is no taller than a single line of controls. It wraps by
  // design on a phone, and a wrap here would put back the row this removed.
  expect(h.height).toBeLessThan(70);

  // And the first pane starts immediately under it, with no strip in between.
  expect((await box(page.locator('main'))).y).toBeLessThanOrEqual(h.y + h.height + 1);
});

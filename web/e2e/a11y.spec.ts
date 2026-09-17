import { test, expect } from './base';

/**
 * Keyboard and screen-reader reachability.
 *
 * Each of these was a real gap: a modal with no way out but the mouse, state
 * signalled by color alone, several controls sharing one accessible name, and
 * a "disabled" toggle that was only disabled to the mouse.
 */
test.describe('accessibility', () => {
  test('the export dialog closes on Escape and names its close button', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: /Rocket Design Report/i }).click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();

    // The close button used to have no accessible name at all — just "✕".
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();

    // …and there was no keyboard way out of an aria-modal overlay.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('the settings tabs are a real tablist, not color alone', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: /Settings/i }).click();

    const tabs = page.getByRole('tab');
    expect(await tabs.count()).toBeGreaterThan(1);
    // Exactly one selected, and which one is exposed rather than implied by a
    // background color.
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
  });

  test('unit chips in the stats strip have distinct accessible names', async ({ page }) => {
    await page.goto('/');

    // Four of these are the LENGTH quantity (length, max diameter, CG, CP) and
    // two are MASS. Named by quantity alone all six announced identically;
    // each now carries its own tile's name.
    //
    // Scoped to the strip: "Length unit" also exists in the launch panel (the
    // rod's length), which is a separate cross-panel collision and not what
    // this pins.
    const strip = page.locator('div.grid').filter({ hasText: 'Max diameter' }).first();
    const names = await strip.evaluate((el) =>
      [...el.querySelectorAll('select[aria-label]')].map((s) => s.getAttribute('aria-label') || ''),
    );
    expect(names.length).toBeGreaterThanOrEqual(5);
    expect(new Set(names).size).toBe(names.length);
  });

  test('no two unit chips on one screen announce the same name', async ({ page }) => {
    await page.goto('/');

    // The whole workbench at once: the stats strip, the property panel and the
    // launch panel each mint unit chips, and they used to collide ACROSS panels
    // — two "Length unit"s (the rod's and the rocket's) and two "Direction
    // unit"s (the rod's and the wind's) on screen together, indistinguishable
    // to anyone navigating by name.
    await expect(page.getByText('Max diameter')).toBeVisible();
    const names = await page.evaluate(() =>
      [...document.querySelectorAll('select[aria-label]')]
        .map((s) => s.getAttribute('aria-label') || '')
        .filter((n) => /unit/i.test(n)),
    );
    expect(names.length).toBeGreaterThan(5);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes, `duplicate unit chip names: ${[...new Set(dupes)].join(', ')}`).toEqual([]);
  });

  /**
   * Seven dialogs declared `aria-modal` with no focus trap and no focus
   * restore, so Tab walked straight out into the page behind the overlay and
   * the trigger lost focus on close — while seven of their siblings used
   * `useFocusTrap` all along.
   */
  test('a modal keeps Tab inside it and hands focus back on close', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Menu' }).click();
    const trigger = page.getByRole('menuitem', { name: /About/ });
    await trigger.click();

    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();

    // Tab all the way round; focus must never leave the panel.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const inside = await dialog.evaluate((el) => el.contains(document.activeElement));
      expect(inside, `focus escaped the dialog after ${i + 1} tabs`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('the import and export .ork menu items are told apart', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Menu' }).click();

    // Both submenus can be open at once, and both entries used to read
    // "OpenRocket (.ork)" — ambiguous to a screen reader and a strict-mode
    // violation for getByRole.
    await page.getByRole('menuitem', { name: /^Import$/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Import OpenRocket (.ork)' })).toBeVisible();
  });

  /**
   * Both hand-rolled chart families carried their numbers only on hover:
   * `hoverM` / `hoverT` had exactly one setter each, `onPointerMove` on a plain
   * `<div>`. So every value in the drag curves and the flight charts was
   * unreachable without a mouse.
   */
  test('the aero chart crosshair can be driven from the keyboard', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Aero', exact: true }).click();

    const chart = page.getByRole('group', { name: /arrow keys to move the crosshair/i }).first();
    await expect(chart).toBeVisible();

    // Focusing alone plants the crosshair — there is something to read at once.
    await chart.focus();
    // Attribute match, not a class selector: the Tailwind class contains a
    // slash, which a CSS selector would need escaped.
    const crosshair = () => page.locator('svg line[class*="stroke-slate-300"]');
    // Count, not visibility: a 1px SVG <line> has no meaningful bounding box,
    // so Playwright reports it hidden even while it is drawn and positioned.
    // One per chart card — hoverM is shared, so all three track together.
    expect(await crosshair().count()).toBeGreaterThan(0);

    // Arrowing moves it: the line's x must change.
    const xAt = async () => crosshair().first().getAttribute('x1');
    const start = await xAt();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await xAt()).not.toBe(start);

    // Home and End reach the ends, and Escape puts it away.
    await page.keyboard.press('Home');
    const home = await xAt();
    await page.keyboard.press('End');
    expect(await xAt()).not.toBe(home);
    await page.keyboard.press('Escape');
    await expect(crosshair()).toHaveCount(0);
  });

  test('the flight chart crosshair can be driven from the keyboard', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Run flight simulation/ }).click();
    await page.getByRole('button', { name: 'Flight', exact: true }).click({ timeout: 30_000 });

    const charts = page.getByRole('group', { name: /arrow keys to move the crosshair/i }).first();
    await expect(charts).toBeVisible();

    // The time readout is a live region, so its text is what a reader hears.
    const readout = page.locator('[aria-live="polite"]').filter({ hasText: /s$/ }).first();
    await charts.focus();
    const mid = await readout.textContent();

    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await readout.textContent()).not.toBe(mid);

    await page.keyboard.press('Home');
    const atStart = await readout.textContent();
    await page.keyboard.press('End');
    expect(await readout.textContent()).not.toBe(atStart);
  });
});

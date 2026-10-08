import AxeBuilder from '@axe-core/playwright';
import { test, expect, runFlight, defined, ready, openTab, type Page } from './base';

/** What axe found on the page as it is, one line per element, WCAG 2.1 A and AA. */
async function axeViolations(page: Page, where: string): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return result.violations.flatMap((v) =>
    v.nodes.map((n) => {
      const colors = n.any[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined;
      const detail = colors?.contrastRatio
        ? ` (${colors.fgColor} on ${colors.bgColor}, ${colors.contrastRatio}:1)`
        : '';
      return `${where}: ${v.id}${detail} at ${n.target.join(' ')}`;
    }),
  );
}

/**
 * The main screens through axe, in every theme. Contrast is the part the JSX
 * lint cannot see: it depends on the theme's tokens and the surface under the
 * text, so each theme is its own scan. The theme attribute is set directly;
 * the setting that normally sets it is covered in daylight-toggle.spec.ts.
 */
for (const theme of ['dark', 'light', 'daylight'] as const) {
  test(`axe finds nothing on the main screens in the ${theme} theme`, async ({ page }) => {
    await ready(page);
    await runFlight(page);
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);

    const found: string[] = [];
    for (const tab of ['Design', 'Simulations', 'Results'] as const) {
      await openTab(page, tab);
      found.push(...(await axeViolations(page, tab)));
    }
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: /Settings/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    found.push(...(await axeViolations(page, 'Settings')));

    expect(found, found.join('\n')).toEqual([]);
  });
}

/**
 * Keyboard and screen-reader reachability: modals close from the keyboard,
 * state is exposed rather than shown by color alone, and controls that sit
 * together carry distinct accessible names.
 */
test.describe('accessibility', () => {
  test('the export dialog closes on Escape and names its close button', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: /Rocket Design Report/i }).click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();

    // The close button carries a real accessible name, not just the ✕ glyph.
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();

    // An aria-modal overlay must have a keyboard way out.
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

    // Four of these are the length quantity (length, max diameter, CG, CP) and
    // two are mass. Named by quantity alone they would announce identically, so
    // each carries its own tile's name.
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
    // launch panel each mint unit chips, and they must not collide across panels:
    // two "Length unit"s (the rod's and the rocket's) or two "Direction unit"s
    // (the rod's and the wind's) on screen together are indistinguishable to
    // anyone navigating by name.
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
   * An `aria-modal` dialog needs a focus trap and focus restore (`useFocusTrap`):
   * without them Tab walks out into the page behind the overlay and the trigger
   * loses focus on close.
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

    // Both submenus can be open at once, so two entries reading "OpenRocket
    // (.ork)" are ambiguous to a screen reader and a strict-mode violation for
    // getByRole.
    await page.getByRole('menuitem', { name: /^Import$/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Import OpenRocket (.ork)' })).toBeVisible();
  });

  /**
   * The drag curves and the flight charts show their values at a crosshair.
   * The crosshair must be movable from the keyboard as well as by pointer, or
   * those values are unreachable without a mouse.
   */
  test('the aero chart crosshair can be driven from the keyboard', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Aero', exact: true }).click();

    const chart = page.getByRole('group', { name: /arrow keys to move the crosshair/i }).first();
    await expect(chart).toBeVisible();

    // Focusing alone plants the crosshair, so there is something to read at once.
    await chart.focus();
    // The crosshair line carries a data hook so the test does not depend on
    // its color class.
    const crosshair = () => page.locator('svg line[data-crosshair]');
    // Count, not visibility: a 1px SVG <line> has no meaningful bounding box,
    // so Playwright reports it hidden even while it is drawn and positioned.
    // One per chart card: hoverM is shared, so all three track together.
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
    await runFlight(page);
    await page.getByRole('button', { name: 'Flight', exact: true }).click();

    const charts = page.getByRole('group', { name: /arrow keys to move the crosshair/i }).first();
    await expect(charts).toBeVisible();

    // The time readout is a live region, so its text is what a reader hears.
    const readout = page.locator('[aria-live="polite"]').filter({ hasText: /s$/ }).first();
    await charts.focus();
    const mid = defined(await readout.textContent(), 'the time readout text');

    // Web-first (`toHaveText` retries) rather than a one-shot `textContent()`
    // compare: the readout is a live region that updates after the keypress,
    // and a read taken before it would compare the text with itself.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(readout).not.toHaveText(mid);

    await page.keyboard.press('Home');
    const atStart = defined(await readout.textContent(), 'the time readout text at Home');
    await page.keyboard.press('End');
    await expect(readout).not.toHaveText(atStart);
  });
});

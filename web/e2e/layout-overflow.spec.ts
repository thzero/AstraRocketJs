import { test, expect, note, ready, box } from './base';

/**
 * The app shell is a fixed-height column: header, one scrolling pane, then the
 * bottom tab bar. That only holds if the DOCUMENT itself never scrolls — a row
 * that runs past the right edge makes the whole page scrollable sideways, and
 * the tab bar (exactly one viewport wide) slides out of view with it, which is
 * how it stopped reading as a static footer on a phone.
 *
 * So this asserts the shell fits the viewport in both axes at the widths real
 * phones use, in the longer of the two languages as well. It caught two rows
 * that did not wrap: the app header's action group and the 2D/3D/Aero toggle.
 */

for (const w of [320, 360, 390, 414, 600, 768]) {
  test(`no sideways scroll at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 844 });
    await ready(page);
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      w: window.innerWidth,
      h: window.innerHeight,
    }));
    note(`${w}: scrollW=${m.sw} innerW=${m.w} scrollH=${m.sh} innerH=${m.h}`);
    expect(m.sw).toBeLessThanOrEqual(m.w);
    expect(m.sh).toBeLessThanOrEqual(m.h);
    // Every width here is under the lg breakpoint (1024), so the bottom tab
    // bar is present at all of them, and it has to sit exactly on the bottom
    // edge: a page that scrolls sideways slides it out of view.
    const bar = await box(page.getByRole('navigation').last());
    note(`${w}: bar bottom=${Math.round(bar.y + bar.height)}`);
    expect(Math.round(bar.y + bar.height)).toBe(m.h);
  });
}

test('no sideways scroll in Spanish at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await ready(page);
  await page.getByRole('combobox').first().selectOption('es');
  // "L/D" reads the same in both languages, so this is the strip having
  // re-rendered after the switch, not the engine having run (ready() covered that).
  await expect(page.getByText('L/D', { exact: true })).toBeVisible();
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  note('es 320:', m.sw, 'vs', m.w);
  expect(m.sw).toBeLessThanOrEqual(m.w);
});

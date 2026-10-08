import { test, expect, ready, type Page } from './base';
import { nsKey } from '../src/services/storage/storageKeys';

/**
 * 2D TreeSchematic render + interaction, in a real browser (jsdom can't lay out
 * SVG). Guards the schematic against regressions the unit tests can't see: the
 * geometry math is covered by TreeSchematic.test.ts; this covers that the
 * component actually draws and that a re-render (zoom) keeps it intact.
 *
 * The schematic svg is the one carrying per-component <title> labels (the header
 * logo svg has none), so `svg:has(title)` selects it unambiguously.
 */
test.describe('2D schematic', () => {
  const schematic = (page: Page) =>
    page
      .locator('svg')
      .filter({ has: page.locator('title') })
      .first();

  test('draws the default airframe with labeled components', async ({ page }) => {
    await ready(page);

    const svg = schematic(page);
    await expect(svg).toBeVisible();
    // The SVG is visible as soon as its container renders, but the shapes come
    // from the engine rebuild, so counting straight away can catch a partial
    // render and fail for a reason that has nothing to do with the schematic.
    // `toHaveCount`-style polling waits for the real thing instead.
    // Nose + body + fins + motor + inner tube… ⇒ several drawn outline/segment paths.
    await expect(async () => {
      expect(await svg.locator('path').count()).toBeGreaterThanOrEqual(5);
    }).toPass({ timeout: 20_000 });
    // Each component labels itself via an SVG <title> (name ?? DISPLAY_NAME).
    expect(await svg.locator('title').count()).toBeGreaterThan(0);
  });

  test('zooming re-renders the schematic without losing the geometry', async ({ page }) => {
    await ready(page);
    const svg = schematic(page);
    await expect(svg).toBeVisible();

    // The zoom/pan group carries a `scale(k)` transform; identity is k=1.
    const scaleOf = () =>
      page.evaluate(() => {
        const g = [...document.querySelectorAll('svg g')].find((el) =>
          /scale\(/.test(el.getAttribute('transform') || ''),
        );
        const m = g?.getAttribute('transform')?.match(/scale\(([\d.]+)\)/);
        return m?.[1] ? parseFloat(m[1]) : 1;
      });

    expect(await scaleOf()).toBe(1);
    await page.getByTitle(/Zoom in/i).click();
    await page.getByTitle(/Zoom in/i).click();

    // Zoom state applied (re-render happened) and the airframe is still drawn,
    // i.e. the memoized layout produced correct geometry across the re-render.
    await expect.poll(scaleOf).toBeGreaterThan(1);
    expect(await svg.locator('path').count()).toBeGreaterThanOrEqual(5);

    // …and the drawing keeps a margin under it. Without bottom padding on the
    // canvas box a zoomed-in schematic ends exactly on the pane's bottom edge, and
    // the bottom ruler and the roll slider's 360° label sit flush against
    // whatever comes next.
    const box = svg.locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]');
    const inner = (await svg.boundingBox())!;
    const outer = (await box.boundingBox())!;
    expect(outer.y + outer.height - (inner.y + inner.height)).toBeGreaterThanOrEqual(4);
  });
});

test('the roll slider reads in the angle unit the user chose', async ({ page }) => {
  await page.addInitScript((key: string) => {
    const was = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, unknown>;
    const units = { ...((was.units as Record<string, string>) ?? {}), angle: 'rad' };
    localStorage.setItem(key, JSON.stringify({ ...was, units }));
  }, nsKey('settings:v1'));
  await ready(page);
  const slider = page.getByRole('slider', { name: 'Roll angle (degrees)' });
  await expect(slider).toBeVisible();
  await expect(slider).toHaveAttribute('title', /rad$/);
  await expect(page.getByText('6.28 rad', { exact: true })).toBeVisible();
});

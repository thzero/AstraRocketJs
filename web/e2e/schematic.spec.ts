import { test, expect, type Page } from '@playwright/test';

// The pre-1.0 "work in progress" modal overlays the canvas and swallows clicks;
// dismiss it right after load (same helper as the other specs).
async function dismissWip(page: Page) {
  await page.getByRole('button', { name: 'I understand' }).click({ timeout: 10_000 }).catch(() => {});
}

/**
 * 2D TreeSchematic render + interaction, in a real browser (jsdom can't lay out
 * SVG). Guards the schematic against regressions the unit tests can't see — the
 * geometry MATH is covered by TreeSchematic.test.ts; this covers that the
 * component actually draws and that a re-render (zoom) keeps it intact. Together
 * they're the safety net for decomposing the 1300-line component.
 *
 * The schematic svg is the one carrying per-component <title> labels (the header
 * logo svg has none), so `svg:has(title)` selects it unambiguously.
 */
test.describe('2D schematic', () => {
  const schematic = (page: Page) => page.locator('svg').filter({ has: page.locator('title') }).first();

  test('draws the default airframe with labeled components', async ({ page }) => {
    await page.goto('/');
    await dismissWip(page);

    const svg = schematic(page);
    await expect(svg).toBeVisible();
    // Nose + body + fins + motor + inner tube… ⇒ several drawn outline/segment paths.
    expect(await svg.locator('path').count()).toBeGreaterThanOrEqual(5);
    // Each component labels itself via an SVG <title> (name ?? DISPLAY_NAME).
    expect(await svg.locator('title').count()).toBeGreaterThan(0);
  });

  test('zooming re-renders the schematic without losing the geometry', async ({ page }) => {
    await page.goto('/');
    await dismissWip(page);
    const svg = schematic(page);
    await expect(svg).toBeVisible();

    // The zoom/pan group carries a `scale(k)` transform; identity is k=1.
    const scaleOf = () => page.evaluate(() => {
      const g = [...document.querySelectorAll('svg g')].find((el) => /scale\(/.test(el.getAttribute('transform') || ''));
      const m = g?.getAttribute('transform')?.match(/scale\(([\d.]+)\)/);
      return m ? parseFloat(m[1]) : 1;
    });

    expect(await scaleOf()).toBe(1);
    await page.getByTitle(/Zoom in/i).click();
    await page.getByTitle(/Zoom in/i).click();

    // Zoom state applied (re-render happened) and the airframe is still drawn —
    // i.e. the memoized layout produced correct geometry across the re-render.
    await expect.poll(scaleOf).toBeGreaterThan(1);
    expect(await svg.locator('path').count()).toBeGreaterThanOrEqual(5);
  });
});

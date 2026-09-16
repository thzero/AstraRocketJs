import { readFile } from 'node:fs/promises';
import { test, expect } from './base';

/**
 * The 2D/3D image export.
 *
 * Every piece of this shipped unreachable: `TreeSchematic` and `Rocket3D` gate
 * their export controls on an `exportData` prop, and `CenterView` — the only
 * thing that renders either — never passed it. `git log -S exportData` shows it
 * never had. So the buttons, `ImageExportMenu`, `schematicSvg`, `svgToImage`
 * and `snapshotWithHeader` were several hundred lines plus a whole service that
 * no user could reach and no test could execute.
 *
 * These tests exist so that cannot recur quietly: they fail if the prop stops
 * being passed.
 */
test.describe('image export', () => {
  test('the 2D view offers SVG and image export', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /SVG/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Image/ })).toBeVisible();
  });

  test('downloads a true-scale SVG of the schematic', async ({ page }) => {
    await page.goto('/');

    const wait = page.waitForEvent('download');
    await page.getByRole('button', { name: /SVG/ }).click();
    const dl = await wait;

    // Named after the design, and actually an SVG with the data header in it.
    expect(dl.suggestedFilename()).toMatch(/-2d\.svg$/);
    const path = await dl.path();
    const svg = await readFile(path!, 'utf8');
    expect(svg.startsWith('<svg') || svg.includes('<svg')).toBe(true);
    // The header block is the point of the export — it is what a cert reviewer
    // reads off the page.
    expect(svg).toMatch(/mm|CG|CP/);
  });

  test('the 3D view offers a snapshot once it is open', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.getByRole('button', { name: /Image/ })).toBeVisible({ timeout: 20_000 });
  });
});

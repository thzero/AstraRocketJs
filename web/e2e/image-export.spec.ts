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

  /**
   * The 3D snapshot renders into an offscreen target and reads the pixels back;
   * nothing under vitest can execute WebGL, so this is the only place the path
   * runs. Three claims: a PNG of the requested width arrives, it is not a blank
   * or single-color frame (the readback produced a picture), and the offscreen
   * path itself was used, not the on-screen fallback it logs a warning for.
   */
  test('the 3D snapshot is a real picture from the offscreen path', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text());
    });
    await page.goto('/');
    await page.getByRole('button', { name: '3D', exact: true }).click();
    const imageBtn = page.getByRole('button', { name: /Image/ });
    await expect(imageBtn).toBeVisible({ timeout: 20_000 });

    // The first PNG preset (the menu lists PNG widths first, smallest first).
    await imageBtn.click();
    const wait = page.waitForEvent('download');
    await page.getByRole('menuitem').first().click();
    const dl = await wait;
    expect(dl.suggestedFilename()).toMatch(/.png$/);

    const sharp = (await import('sharp')).default;
    const img = sharp(await readFile((await dl.path())!));
    const meta = await img.metadata();
    expect(meta.width).toBeGreaterThanOrEqual(1920);
    expect(meta.height).toBeGreaterThan(0);
    // A blank readback is a flat frame: every channel has zero spread. The
    // rendered rocket over the white export background has plenty.
    const { channels } = await img.stats();
    expect(Math.max(...channels.map((c) => c.stdev))).toBeGreaterThan(10);

    expect(warnings.filter((w) => /offscreen capture failed/.test(w))).toEqual([]);
  });
});

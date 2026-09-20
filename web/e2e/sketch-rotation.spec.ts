import { test, expect, type Page, note, ready, box } from './base';

/**
 * The Sketch tab exists because the 2D side view is a LANDSCAPE drawing: a hobby
 * airframe is 15-25x longer than it is wide. Sharing a portrait phone with the
 * stats strip left it a couple of hundred pixels tall, and even alone it only
 * gets the screen's short edge. So on a portrait screen the drawing is turned a
 * quarter turn -- its short dimension along the device's short dimension, its
 * length down the screen -- and turned back once the device is landscape and
 * already the right shape.
 */
test.describe('sketch tab', () => {
  const stage = (page: Page) =>
    page.evaluate(() => {
      const el = document.querySelector('.sketch-rotate');
      const svg = document.querySelector('main svg')?.getBoundingClientRect();
      return {
        rotated: !!el && getComputedStyle(el).transform !== 'none',
        w: svg ? Math.round(svg.width) : 0,
        h: svg ? Math.round(svg.height) : 0,
      };
    });

  test('turns the drawing a quarter turn on a portrait screen, and back in landscape', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page);

    // Rocket tab shows the stats, not the drawing. The drawing stays MOUNTED
    // behind it so switching tabs never reinitializes the canvas -- so it has to
    // come back correctly sized, which the measurements below check.
    await expect(page.locator('main svg').first()).toBeHidden();
    await page.getByRole('button', { name: /Sketch/ }).click();
    await expect(page.locator('main svg').first()).toBeVisible();
    await expect(page.getByText('L/D', { exact: true })).toBeHidden();

    const portrait = await stage(page);
    note('portrait', JSON.stringify(portrait));
    expect(portrait.rotated).toBe(true);
    // The toolbar turns WITH the drawing, so it sits along the screen's long
    // edge at the top of the sheet it controls, not across the short edge.
    const toolbar = await box(page.getByRole('button', { name: 'Reset' }));
    note('toolbar', JSON.stringify({ x: Math.round(toolbar.x), y: Math.round(toolbar.y) }));
    expect(toolbar.x).toBeGreaterThan(390 * 0.75); // hard against the right edge
    expect(toolbar.height).toBeGreaterThan(toolbar.width); // stood on end
    // Taller than wide: the canvas took the device's LONG axis for the rocket's
    // length. Unrotated it would be 366x~200 and the rocket a dozen pixels tall.
    expect(portrait.h).toBeGreaterThan(portrait.w);

    await page.setViewportSize({ width: 844, height: 390 });
    const landscape = await stage(page);
    note('landscape', JSON.stringify(landscape));
    expect(landscape.rotated).toBe(false);
    expect(landscape.w).toBeGreaterThan(landscape.h);
    const flat = await box(page.getByRole('button', { name: 'Reset' }));
    expect(flat.width).toBeGreaterThan(flat.height); // back to a normal row

    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
    expect(m.sw).toBeLessThanOrEqual(m.w);
  });

  test('leaves the desktop workbench alone', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 950 });
    await ready(page);
    const desktop = await stage(page);
    note('desktop', JSON.stringify(desktop));
    expect(desktop.rotated).toBe(false);
    expect(desktop.w).toBeGreaterThan(desktop.h);
  });
});

test('frames the 3D model correctly inside the quarter turn', async ({ page }) => {
  // r3f measures its canvas to size the drawing buffer and the camera aspect.
  // Its default measurement is getBoundingClientRect, which on a ROTATED element
  // reports the axis-aligned screen box -- width and height swapped. That framed
  // a 658x325 host at aspect 0.49 and drew the rocket four times too big and
  // clipped. `resize={{ offsetSize: true }}` measures the layout box instead.
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.getByRole('button', { name: /Sketch/ }).click();
  await page.getByRole('button', { name: '3D', exact: true }).click();

  const canvas = page.locator('main canvas').first();
  await expect(canvas).toBeVisible();
  // Polled, not sampled once: r3f sizes the buffer from a ResizeObserver, so the
  // first frame after the view switch can still carry the previous dimensions.
  // Reading it once made this test flaky under a loaded parallel run.
  await expect
    .poll(
      async () =>
        canvas.evaluate((c: HTMLCanvasElement) => {
          const host = c.parentElement;
          if (!host) return false;
          // The buffer has to match the host's LAYOUT box -- landscape -- and
          // not the axis-aligned bbox the rotation gives it. Compared in CSS
          // pixels: r3f sizes the buffer at the layout box times the device
          // pixel ratio clamped to 2 (its default `dpr={[1, 2]}`; Rocket3D
          // sets none), so the Pixel 7 project (DPR 2.625) gets a 2x buffer
          // where the desktop project gets 1x. Comparing raw buffer pixels
          // to CSS pixels failed on the phone project for that reason alone.
          const k = Math.min(window.devicePixelRatio || 1, 2);
          return Math.abs(c.width / k - host.offsetWidth) < 3 && Math.abs(c.height / k - host.offsetHeight) < 3;
        }),
      { timeout: 10_000 },
    )
    .toBe(true);

  const [bufW, bufH] = await canvas.evaluate((c: HTMLCanvasElement): [number, number] => [c.width, c.height]);
  note('3d buffer', JSON.stringify([bufW, bufH]));
  expect(bufW).toBeGreaterThan(bufH); // landscape, as the layout box is
});

test('turns the Aero charts with the sketch, and leaves the flight views upright', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.getByRole('button', { name: /Sketch/ }).click();
  await expect(page.locator('.sketch-rotate')).toHaveCount(1); // 2D

  // Aero is a Mach sweep -- a flat, wide drawing like the schematic, so it turns
  // too and each chart gets the screen's long edge instead of its short one.
  await page.getByRole('button', { name: 'Aero', exact: true }).click();
  await expect(page.locator('.sketch-rotate')).toHaveCount(1);
  const chart = await box(page.locator('main svg').first());
  note('aero chart', `${Math.round(chart.width)}x${Math.round(chart.height)}`);
  expect(chart.height).toBeGreaterThan(chart.width); // on screen: stood on end
});

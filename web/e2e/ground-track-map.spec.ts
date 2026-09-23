import { test, expect, openTab, ready, runFlight, type Page } from './base';

/**
 * Map imagery under the ground track.
 *
 * The tile math is covered against hand-computed figures in
 * `services/slippyMap.test.ts`, and which tiles get asked for in
 * `components/canvas/GroundTrack.test.tsx`. What neither can check is the part
 * that only a real layout engine decides: whether the scaled tile layer
 * actually lands on the geometry drawn over it. A layer half a box out still
 * renders a plausible-looking map of the wrong ground.
 *
 * Tiles are answered locally with a 1x1 PNG by the shared fixture, so nothing
 * here touches Esri.
 */

/** The map box, and the absolutely-positioned tile layer inside it. */
async function rects(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector('svg[role="img"]');
    const box = svg?.parentElement;
    const layer = box?.querySelector('div[aria-hidden]');
    const of = (el: Element | null | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return { box: of(box), layer: of(layer), tiles: box?.querySelectorAll('img').length ?? 0 };
  });
}

/** A flight with a real drift, so the view is sized to a track rather than a dot. */
async function flyDownwind(page: Page): Promise<void> {
  await ready(page);
  await openTab(page, 'Simulations');
  await page.getByLabel('Speed', { exact: true }).fill('7');
  await page.getByLabel('Angle', { exact: true }).fill('12');
  await runFlight(page);
  await openTab(page, 'Results');
  await page.getByRole('button', { name: 'Ground track', exact: true }).click();
  await expect(page.getByRole('img', { name: /over the ground/i })).toBeVisible();
}

/**
 * Ask for the ground.
 *
 * Imagery is off until somebody wants it, so every check on where the tiles
 * land has to turn it on first. The default itself is asserted below.
 */
async function showGround(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Satellite', exact: true }).click();
}

/**
 * Nothing is fetched from anybody's tile servers until somebody asks to see the
 * ground: the plan view is a measurement that stands on its own.
 */
test('draws no imagery until the ground is asked for', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('arcgisonline.com')) asked.push(r.url());
  });

  await flyDownwind(page);
  expect((await rects(page)).tiles).toBe(0);
  expect(asked).toHaveLength(0);
  await expect(page.getByText(/Imagery: Esri/)).toHaveCount(0);

  await showGround(page);
  expect((await rects(page)).tiles).toBeGreaterThan(0);
  expect(asked.length).toBeGreaterThan(0);
});

test('the tile layer covers the plot it sits under, exactly', async ({ page }) => {
  await flyDownwind(page);
  await showGround(page);

  const { box, layer, tiles } = await rects(page);
  expect(box).not.toBeNull();
  expect(layer).not.toBeNull();
  expect(tiles).toBeGreaterThan(0);

  // The pad is the center of BOTH, which is the whole alignment claim: the
  // geometry is drawn in meters from the pad and the tiles are fetched around
  // the pad's coordinate, so if the two boxes are concentric and the same size,
  // a landing marker sits over the ground it landed on. A pixel of slack for
  // the fractional scale the layer is drawn at.
  expect(Math.abs(layer!.x - box!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(layer!.y - box!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(layer!.w - box!.w)).toBeLessThanOrEqual(1);
  expect(Math.abs(layer!.h - box!.h)).toBeLessThanOrEqual(1);

  // Square, because a plan view with different scales on its two axes is not a
  // map (services/groundTrack.ts).
  expect(Math.abs(box!.w - box!.h)).toBeLessThanOrEqual(1);
});

test('the layer buttons and the drift readout are not clipped by the square', async ({ page }) => {
  await flyDownwind(page);
  await showGround(page);

  // The square used to be sized to the whole pane, so the pane overflowed by
  // the height of the readout beneath it and the centered overflow was cut off
  // at both ends - taking the distance and bearing with it, which are the two
  // numbers this view exists to give you.
  await expect(page.getByText(/364 m · 270°/)).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Satellite', exact: true })).toBeInViewport();
  // The provider's attribution is a condition of using the tiles at all.
  await expect(page.getByText(/Imagery: Esri/)).toBeInViewport();
});

test('turns the imagery off and keeps the measurement', async ({ page }) => {
  await flyDownwind(page);
  await showGround(page);

  await page.getByRole('button', { name: 'None', exact: true }).click();
  expect((await rects(page)).tiles).toBe(0);
  // The rings and the readout are what the view was before imagery, and still is.
  await expect(page.getByRole('img', { name: /over the ground/i })).toBeVisible();
  await expect(page.getByText(/364 m · 270°/)).toBeInViewport();

  // And back on, which is the half of a toggle that is easy to leave broken.
  await page.getByRole('button', { name: 'Satellite', exact: true }).click();
  expect((await rects(page)).tiles).toBeGreaterThan(0);
});

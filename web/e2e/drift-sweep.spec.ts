import { test, expect, openTab, ready, runFlight, type Page } from './base';

/**
 * A drift sweep, flown for real.
 *
 * The grid math is covered in `services/windSweep.test.ts`, the region math in
 * `services/driftEllipse.test.ts`, the store's contract in
 * `state/driftSweep.test.ts` and the drawing in
 * `components/canvas/GroundTrack.test.tsx` — all against stubbed flights. What
 * none of them can check is the thing that decides whether the feature works at
 * all: that a few dozen real trajectories through the real kernel come back with
 * DIFFERENT landings, and that the region drawn around them is bigger than the
 * one flight the view was already showing.
 *
 * Deliberately a small grid. Sixteen flights is enough to have an envelope with
 * an area and to see the region reach past the single track, and it keeps this
 * inside the suite's normal patience.
 */

/** A flight with a real drift, so the plot is sized to a track rather than a dot. */
async function flyDownwind(page: Page): Promise<void> {
  await ready(page);
  await openTab(page, 'Simulations');
  await page.getByLabel('Speed', { exact: true }).fill('5');
  await page.getByLabel('Angle', { exact: true }).fill('10');
  await runFlight(page);
  await openTab(page, 'Results');
  await page.getByRole('button', { name: 'Ground track', exact: true }).click();
  await expect(page.getByRole('img', { name: /over the ground/i })).toBeVisible();
}

/** Open the sweep controls and set a small grid: 4 speeds x 4 headings. */
async function openSweep(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Drift', exact: true }).click();
  await page.getByLabel('Speeds', { exact: true }).fill('4');
  await page.getByLabel('Headings', { exact: true }).fill('4');
  await expect(page.getByText('16 flights')).toBeVisible();
}

/** The shapes the region is drawn as: the filled hull, then the dashed ellipse. */
async function shapes(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('svg[role="img"] polygon')).map((el) => ({
      points: (el.getAttribute('points') ?? '').split(' ').length,
      fillOpacity: el.getAttribute('fill-opacity'),
      dashed: !!el.getAttribute('stroke-dasharray'),
    })),
  );
}

/** The largest range-ring label, in meters — the frame's own measure of itself. */
async function widestRing(page: Page): Promise<number> {
  return page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('svg[role="img"] text')).map((el) => el.textContent ?? '');
    const m = labels.flatMap((x) => {
      const hit = /^([\d.]+) m$/.exec(x);
      return hit ? [Number(hit[1])] : [];
    });
    return m.length ? Math.max(...m) : 0;
  });
}

test('flies a grid of winds and draws the region they land in', async ({ page }) => {
  await flyDownwind(page);
  const before = await widestRing(page);
  expect(await shapes(page)).toHaveLength(0);

  await openSweep(page);
  await page.getByRole('button', { name: 'Run sweep', exact: true }).click();

  // Sixteen real trajectories over the worker pool. The count is what says the
  // sweep is actually flying rather than the button having done nothing.
  await expect(page.getByText('16 of 16 flights landed.')).toBeVisible({ timeout: 120_000 });

  // The envelope and the ellipse. A hull with three or more vertices is the
  // proof the landings are genuinely spread out: a kernel that ignored the
  // swept wind would put every flight in the same place and collapse it.
  const drawn = await shapes(page);
  expect(drawn).toHaveLength(2);
  expect(drawn[0]!.fillOpacity).toBe('0.14');
  expect(drawn[0]!.points).toBeGreaterThanOrEqual(3);
  expect(drawn[1]!.dashed).toBe(true);

  // One dot per landing.
  const dots = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll('svg[role="img"] circle')).filter((c) => c.getAttribute('r') === '1.6')
        .length,
  );
  expect(dots).toBe(16);

  // The region reaches past the single flight that was drawn before it, so the
  // frame had to widen to hold it.
  expect(await widestRing(page)).toBeGreaterThan(before);

  // And the readout gained a swept range band beside the flown distance.
  await expect(page.getByText(/\(\d[\d.]*–\d[\d.]* m\)/)).toBeVisible();
});

test('clears the region without re-running anything', async ({ page }) => {
  await flyDownwind(page);
  await openSweep(page);
  await page.getByLabel('Speeds', { exact: true }).fill('2');
  await page.getByLabel('Headings', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Run sweep', exact: true }).click();
  await expect(page.getByText('4 of 4 flights landed.')).toBeVisible({ timeout: 120_000 });
  expect(await shapes(page)).toHaveLength(2);

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  expect(await shapes(page)).toHaveLength(0);
  // The track it was drawn over is untouched.
  await expect(page.getByRole('img', { name: /over the ground/i })).toBeVisible();
});

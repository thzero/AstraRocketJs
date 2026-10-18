import { test, expect, ready, importOrk, note, type Locator } from './base';

/**
 * The 3D view's toggles: the cutaway, and the Figure and Finished view types.
 *
 * This holds two things a unit test cannot. The first is that the toggle is
 * reachable: the view-preset row is pinned top-right at z-index 2 and the
 * quick-glance info card top-left at z-20, and on a pane narrower than the two
 * of them together the card can cover the row and swallow its clicks. The
 * second is that clipping reaches the GPU: `localClippingEnabled` on the renderer and a plane on the
 * material are two separate switches, and with either one missing the button
 * still toggles, still highlights, and draws exactly the same picture.
 */

/** The canvas once it stops changing: two identical frames in a row. The view
 *  arrives over several frames (fit, then damped orbit), so a single early
 *  screenshot compares one animation frame against another and proves nothing. */
async function settled(canvas: Locator): Promise<string> {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = (await canvas.screenshot()).toString('base64');
        const same = now === last;
        last = now;
        return same;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return last;
}

test('cuts the airframe open, and the button can be pressed to do it', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await ready(page);
  // A design with internals to reveal: two centering rings, a mount and a
  // packed chute. The cut is only worth taking if something is behind it.
  await importOrk(page, 'e2e/fixtures/two-stage.ork');
  await page.getByRole('button', { name: '3D', exact: true }).click();

  const canvas = page.locator('main canvas').first();
  await expect(canvas).toBeVisible();
  const solid = await settled(canvas);

  const cut = page.getByRole('button', { name: 'Cutaway', exact: true });
  await expect(cut).toHaveAttribute('aria-pressed', 'false');
  // Not force-clicked: the point is that nothing is on top of it.
  await cut.click();
  await expect(cut).toHaveAttribute('aria-pressed', 'true');

  const sectioned = await settled(canvas);
  note('canvas bytes', solid.length, sectioned.length);
  expect(sectioned).not.toBe(solid);

  await cut.click();
  await expect(cut).toHaveAttribute('aria-pressed', 'false');
});

test('switches between the Figure and Finished views, and both buttons can be pressed', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await ready(page);
  await page.getByRole('button', { name: '3D', exact: true }).click();

  const canvas = page.locator('main canvas').first();
  await expect(canvas).toBeVisible();
  const figure = page.getByRole('button', { name: 'Figure', exact: true });
  const finished = page.getByRole('button', { name: 'Finished', exact: true });
  // Figure first, as desktop opens on it.
  await expect(figure).toHaveAttribute('aria-pressed', 'true');
  const seeThrough = await settled(canvas);

  // The default rocket has no appearance of its own, so the change is the
  // airframe turning solid.
  await finished.click();
  await expect(finished).toHaveAttribute('aria-pressed', 'true');
  await expect(figure).toHaveAttribute('aria-pressed', 'false');
  const solid = await settled(canvas);
  expect(solid).not.toBe(seeThrough);

  await figure.click();
  await expect(figure).toHaveAttribute('aria-pressed', 'true');
});

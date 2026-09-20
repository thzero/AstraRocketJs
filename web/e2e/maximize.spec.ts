import { test, expect, openTab, runFlight, ready, box } from './base';

/**
 * Maximize: the drawing takes the window and both side columns step aside.
 *
 * An airframe is 15-25x longer than it is wide, so the canvas runs out of
 * horizontal space long before vertical. Dropping the tree and the property
 * editor doubles what the drawing has to work with.
 */
test('the drawing can take the whole window, and come back', async ({ page }) => {
  await ready(page);

  const center = page.locator('main > section').nth(1);
  const width = async () => (await box(center)).width;
  const tree = page.getByRole('heading', { name: 'Components' });

  expect(await width()).toBe(750);
  await expect(tree).toBeVisible();

  const stats = page.getByText('Static statistics');
  await expect(stats).toBeVisible();

  await page.getByRole('button', { name: /whole window/ }).click();
  expect(await width()).toBe(1500);
  await expect(tree).toBeHidden();
  // The statistics strip is a footer ABOUT the design, not part of the drawing,
  // and at full width it was taking 175px off the top of the very thing the
  // expand exists to give room to.
  await expect(stats).toBeHidden();
  // The dividers go with the columns they divide - there is nothing left to
  // drag, and a divider against the window edge is a trap.
  await expect(page.getByRole('separator')).toHaveCount(0);

  // A layout preference like the two widths, so it survives the page. Waits on
  // the toolbar rather than the usual `L/D`, which is INSIDE the strip that is
  // now hidden.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Side', exact: true })).toBeVisible({ timeout: 20_000 });
  expect(await width()).toBe(1500);

  // Escape gets out, so the way back does not depend on finding one glyph.
  await page.keyboard.press('Escape');
  expect(await width()).toBe(750);
  await expect(tree).toBeVisible();
  await expect(stats).toBeVisible();
  await expect(page.getByRole('separator')).toHaveCount(2);
});

test('maximizing is a desktop mode and leaves a phone alone', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: /whole window/ }).click();

  // The flag persists, so a narrow window can meet it switched on. A phone has
  // no side columns to reclaim and reaches its statistics through the
  // Rocket/Sketch split instead, so the mode must not reach down here - it would
  // hide that half with no way back, since the toggle itself is desktop-only.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: /whole window/ })).toBeHidden();
  await expect(page.getByRole('button', { name: /Rocket/ })).toBeVisible();
  await page.getByRole('button', { name: /Rocket/ }).click();
  await expect(page.getByText('Static statistics')).toBeVisible();
});

test('maximizing does not strand the simulation editor', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: /whole window/ }).click();
  await runFlight(page);

  // Results shares the center pane, so it maximizes too.
  expect((await box(page.locator('main > section').nth(1))).width).toBe(1500);

  // Simulations does NOT: the toggle lives in the center pane's toolbar, which
  // is not on that tab, so honoring the flag there would hide the simulation
  // editor with no control left to bring it back.
  await openTab(page, 'Simulations');
  await expect(page.locator('main > section:visible')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /Run flight simulation/ })).toBeVisible();
});

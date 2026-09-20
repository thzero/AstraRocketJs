import { test, expect, type Locator, type Page, openTab, runFlight, ready, box } from './base';

/**
 * The two draggable dividers of the desktop workbench: between the component
 * tree and the canvas, and between the canvas and the right-hand column.
 */

/** Drag a divider to screen x, gripping it 200px down its length. */
const drag = async (page: Page, sep: Locator, toX: number) => {
  const b = await box(sep);
  await page.mouse.move(b.x + b.width / 2, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(toX, b.y + 200, { steps: 8 });
  await page.mouse.up();
};

/**
 * The divider between the component tree and the canvas.
 *
 * A fixed column is a guess about a tree nobody has built yet: a deep design
 * truncates names at any width that does not waste space on a shallow one. So
 * the guess is only a default, and the width is the user's, remembered.
 */
test('the tree column can be dragged, and keeps its width', async ({ page }) => {
  await ready(page);

  const pane = page.locator('main > section').first();
  const sep = page.getByRole('separator', { name: /components panel/ });
  const width = async () => (await box(pane)).width;

  expect(await width()).toBe(360);
  await drag(page, sep, 480);
  expect(await width()).toBe(480);

  // The width is a preference, so it survives the page.
  await page.reload();
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(await width()).toBe(480);

  // Clamped at both ends: the design actions stop fitting on one row below 300,
  // and past 640 the column is mostly gutter.
  await drag(page, sep, 5);
  expect(await width()).toBe(300);
  await drag(page, sep, 1495);
  expect(await width()).toBe(640);

  // Keyboard-reachable, because a pointer-only control is no control at all for
  // anyone driving this from the keyboard.
  await sep.focus();
  await page.keyboard.press('ArrowLeft');
  expect(await width()).toBe(624);
  await expect(sep).toHaveAttribute('aria-valuenow', '624');

  // Double-click puts it back, so a bad drag is one gesture to undo.
  await sep.dblclick();
  expect(await width()).toBe(360);
});

test('the divider leaves room for the other panes, and only shows where it applies', async ({ page }) => {
  // The narrowest desktop width. A width stored on a wide monitor must not crush
  // the canvas when the same browser profile opens here.
  await page.setViewportSize({ width: 1024, height: 900 });
  await ready(page);

  const sep = page.getByRole('separator', { name: /components panel/ });
  await drag(page, sep, 1000);

  const tree = await box(page.locator('main > section').first());
  const center = await box(page.locator('main > section').nth(1));
  expect(tree.width).toBeLessThan(640); // the flat maximum gave way to the window
  expect(center.width).toBeGreaterThan(250); // and the canvas is still a canvas

  // The tree column is a Design-tab thing, so its divider is too. (The side
  // divider is on every tab, which is its own test.)
  await runFlight(page);
  await expect(sep).toHaveCount(0);
  await openTab(page, 'Simulations');
  await expect(sep).toHaveCount(0);
  await openTab(page, 'Design');
  await expect(sep).toHaveCount(1);

  // And there are no side columns to divide on a phone, either of them.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('separator')).toHaveCount(0);
});

/**
 * The divider between the canvas and the right-hand column.
 *
 * ONE width for all three of those columns - the part editor, the simulation
 * editor and the run's numbers. They were a matching 380 on purpose, and that
 * only stays true if sizing one sizes them all.
 */
test('the side column can be dragged, and the width is shared by every tab', async ({ page }) => {
  await ready(page);

  const sep = page.getByRole('separator', { name: /side panel/ });
  const props = page.locator('main > section').nth(2);
  const width = async () => (await box(props)).width;

  expect(await width()).toBe(380);
  await drag(page, sep, 1000);
  expect(await width()).toBe(500);

  await page.reload();
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(await width()).toBe(500);

  // The pane is on the RIGHT of this divider, so the clamps are mirrored: drag
  // toward the edge it sits against to shrink it.
  await drag(page, sep, 1495);
  expect(await width()).toBe(300);
  await drag(page, sep, 100);
  expect(await width()).toBe(640);

  // And so are the arrow keys. Both read as "push the divider that way", which
  // means ArrowRight makes a right-hand pane smaller.
  await sep.focus();
  await page.keyboard.press('ArrowRight');
  expect(await width()).toBe(624);

  await sep.dblclick();
  expect(await width()).toBe(380);
});

test('every right-hand column is the same width, on whichever tab it appears', async ({ page }) => {
  await ready(page);
  await runFlight(page);

  // Sized once, on Results.
  const sep = page.getByRole('separator', { name: /side panel/ });
  await drag(page, sep, 1100);

  const visible = page.locator('main > section:visible').last();
  expect((await box(visible)).width).toBe(400);

  // …and the simulation editor and the part editor follow, because they are the
  // same setting rather than three that happen to match.
  await openTab(page, 'Simulations');
  expect((await box(visible)).width).toBe(400);
  await openTab(page, 'Design');
  expect((await box(page.locator('main > section').nth(2))).width).toBe(400);

  // Design is the only tab with columns on both sides, so the only one with two
  // dividers.
  await expect(page.getByRole('separator')).toHaveCount(2);
  await openTab(page, 'Simulations');
  await expect(page.getByRole('separator')).toHaveCount(1);
});

test('clicking a divider without moving it leaves the width alone', async ({ page }) => {
  await ready(page);

  // The pointer lands a pixel or two off the stored split, so committing its
  // position on a plain click nudged the pane every time it was clicked - and
  // did it again between the two clicks of a double-click, which ate the reset.
  for (const name of [/components panel/, /side panel/]) {
    const sep = page.getByRole('separator', { name });
    const before = (await box(sep)).x;
    await sep.click();
    expect((await box(sep)).x).toBe(before);
  }
});

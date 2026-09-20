import { test, expect, type Page, note, openTab, runFlight, ready, box } from './base';

/**
 * What the workbench does with a phone's screen: dialogs go edge to edge, short
 * prompts stay carded, and a finished run lands on its own Results tab. The
 * desktop contrasts kept here run at 1500 wide, well past the breakpoint.
 *
 * This file used to hold six features in 651 lines. The viewport-overflow,
 * sketch-rotation, pane-divider, maximize and header-tabs suites are their own
 * specs now (layout-overflow, sketch-rotation, pane-splitter, maximize,
 * workbench-header), and the app-open wait they all copied is `ready()` in
 * base.ts. This file is also run by the Pixel 7 project in playwright.config.ts,
 * so nothing in it may depend on a desktop-only element being rendered.
 */

/**
 * Below the desktop breakpoint a dialog takes the whole screen. A phone has no
 * room for a floating card inset from the edges, and a panel capped at 85vh
 * leaves strips of dimmed app above and below that look tappable and are not.
 *
 * The rule lives in ONE place (`.dialog-overlay` / `.dialog-panel` in
 * index.css), so this checks a dialog from each shape: a plain padded card, a
 * flex column with a footer, and one with its own fixed height.
 */
test.describe('dialogs on a phone', () => {
  const panel = (page: Page) => page.locator('.dialog-panel').first();

  test('fill the screen edge to edge', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page);

    // Settings carries `h-[560px] max-h-[85vh] max-w-lg` of its own, so it also
    // proves the override beats the panel's utilities without !important.
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    const set = await box(panel(page));
    expect({ w: set.width, h: set.height }).toEqual({ w: 390, h: 844 });
    await page.getByRole('button', { name: 'Close' }).first().click();

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'About' }).click();
    const about = await box(panel(page));
    expect({ w: about.width, h: about.height }).toEqual({ w: 390, h: 844 });
  });

  test('stay carded at the desktop breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 950 });
    await ready(page);
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    const set = await box(panel(page));
    note('desktop dialog', `${Math.round(set.width)}x${Math.round(set.height)}`);
    expect(set.width).toBeLessThan(1500);
    expect(set.height).toBeLessThan(950);
  });
});

/**
 * Short prompts stay as cards. Two or three lines and a button blown up to fill
 * a phone is all empty space, and the report's print-settings popover opens on
 * top of the already-full-screen report dialog, where full bleed would read as
 * that dialog being replaced rather than something opening over it.
 */
test.describe('short prompts', () => {
  // This one MEASURES the work-in-progress notice, so it is the one place that
  // opts out of the fixture's default of having it already acknowledged.
  test.use({ wip: 'shown' });

  test('leaves short prompts as centered cards on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // Not ready(): the notice is modal over the strip this would wait on.
    await page.goto('/');

    const wip = page.getByRole('button', { name: 'I understand' });
    await expect(wip).toBeVisible();
    const card = await box(wip.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]'));
    note('wip card', `${Math.round(card.width)}x${Math.round(card.height)} at y=${Math.round(card.y)}`);
    expect(card.width).toBeLessThan(390); // inset from the edges
    expect(card.height).toBeLessThan(844 / 2); // sized to its content, not the screen
    expect(card.y).toBeGreaterThan(0); // centered, not pinned to the top
    await expect(page.locator('.dialog-panel')).toHaveCount(0);
  });
});

/**
 * A finished run used to set the flight view while leaving you on Simulate --
 * so the chart appeared on the Sketch tab, which you were not looking at, and
 * your drawing was displaced by it. The flight views now have their own tab.
 */
test('a finished run lands on the Results tab', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);

  const resultsTab = page.getByRole('button', { name: /Results/ });
  await expect(resultsTab).toHaveCount(0); // nothing to show before a run

  await page.getByRole('button', { name: /Simulate/ }).click();
  await page.getByRole('button', { name: /Run flight simulation/ }).click();
  await expect(resultsTab).toBeVisible({ timeout: 30_000 });

  // The run put us there, and the flight chart is what is on screen.
  await expect(resultsTab).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Flight', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // The view switch offers only this tab's family: the flight views here…
  for (const v of ['Flight', '3D path']) {
    await expect(page.getByRole('button', { name: v, exact: true })).toBeVisible();
  }
  for (const v of ['2D', '3D', 'Aero']) {
    await expect(page.getByRole('button', { name: v, exact: true })).toBeHidden();
  }

  // Sketch still holds the drawing rather than having been taken over by it…
  await page.getByRole('button', { name: /Sketch/ }).click();
  await expect(page.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // …and there it offers the design views, and only those. Switching family is
  // the tab bar's job; a toolbar button that jumped you to another tab would be
  // a surprise.
  for (const v of ['2D', '3D', 'Aero']) {
    await expect(page.getByRole('button', { name: v, exact: true })).toBeVisible();
  }
  for (const v of ['Flight', '3D path']) {
    await expect(page.getByRole('button', { name: v, exact: true })).toBeHidden();
  }
});

test('the desktop workbench splits the view families across its tabs too', async ({ page }) => {
  // This used to assert the opposite — all five views in one switch — because
  // the desktop had no tabs and the families only split on a phone. Now the
  // workbench is tabbed at every width, so the same rule applies up here: the
  // tab picks the family, the switch moves within it.
  await page.setViewportSize({ width: 1500, height: 950 });
  await ready(page);
  await runFlight(page); // lands on Results

  for (const v of ['Flight', '3D path']) {
    await expect(page.getByRole('button', { name: v, exact: true })).toBeVisible();
  }
  for (const v of ['2D', '3D', 'Aero']) {
    await expect(page.getByRole('button', { name: v, exact: true })).toBeHidden();
  }

  await openTab(page, 'Design');
  for (const v of ['2D', '3D', 'Aero']) {
    await expect(page.getByRole('button', { name: v, exact: true })).toBeVisible();
  }
  for (const v of ['Flight', '3D path']) {
    await expect(page.getByRole('button', { name: v, exact: true })).toBeHidden();
  }
});

test('the Results tab leads with the run numbers, without starving the chart', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 }); // the smallest phone we target
  await ready(page);
  await page.getByRole('button', { name: /Simulate/ }).click();
  await page.getByRole('button', { name: /Run flight simulation/ }).click();
  await expect(page.getByRole('button', { name: /Results/ })).toBeVisible({ timeout: 30_000 });

  const m = await page.evaluate(() => {
    const grid = document.querySelector('main section[aria-label="Simulation results"]');
    const half = document.querySelector('main div.min-h-0.w-full.flex-1.flex-col');
    const pane = half?.parentElement;
    return {
      summaryTop: grid ? Math.round(grid.getBoundingClientRect().top) : null,
      chartHeight: half ? Math.round(half.getBoundingClientRect().height) : 0,
      paneHeight: pane ? Math.round(pane.getBoundingClientRect().height) : 0,
    };
  });
  note('results tab', JSON.stringify(m));

  // Apogee and the rest are the first thing on the tab. Scoped to the first one
  // in DOM order — the center pane's — because the sim editor keeps its own copy
  // mounted behind the Simulate tab.
  const summary = page.getByRole('region', { name: 'Simulation results' }).first();
  await expect(summary).toBeVisible();
  await expect(summary.getByText('Apogee', { exact: true })).toBeVisible();
  expect(m.summaryTop).toBeLessThan(m.chartHeight); // above the chart, not below
  // …but the tiles are a fixed ~300px, so they are capped and scroll rather than
  // squeezing the chart they describe down to nothing (it was 91px before).
  expect(m.chartHeight).toBeGreaterThan(200);
  expect(m.chartHeight).toBeGreaterThan(m.paneHeight * 0.5);
});

test('starting a new design does not strand you on an empty Results tab', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.getByRole('button', { name: /Simulate/ }).click();
  await page.getByRole('button', { name: /Run flight simulation/ }).click();
  const resultsTab = page.getByRole('button', { name: /Results/ });
  await expect(resultsTab).toBeVisible({ timeout: 30_000 });

  // New design straight from the Results tab. The result is gone with it, so
  // the tab has nothing left to show -- and every view button belongs to the
  // other family, which used to leave the switch completely empty.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'New' }).click();
  await page
    .getByRole('button', { name: /Discard/ })
    .click()
    .catch(() => {});

  await expect(resultsTab).toHaveCount(0);
  await expect(page.getByRole('button', { name: '2D', exact: true })).toBeVisible();
});

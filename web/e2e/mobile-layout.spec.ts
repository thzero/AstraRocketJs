import { test, expect, type Page, note, openTab, runFlight, ready, box } from './base';

/**
 * What the workbench does with a phone's screen: dialogs go edge to edge, short
 * prompts stay carded, and a finished run lands on its own Results tab. The
 * desktop contrasts kept here run at 1500 wide, well past the breakpoint.
 *
 * The viewport-overflow, sketch-rotation, pane-divider, maximize and header-tabs
 * suites are their own specs (layout-overflow, sketch-rotation, pane-splitter,
 * maximize, workbench-header), and the app-open wait they share is `ready()` in
 * base.ts. This file is also run by the Pixel 7 project in playwright.config.ts, so
 * nothing in it may depend on a desktop-only element being rendered.
 */

/**
 * Below the desktop breakpoint a dialog takes the whole screen. A phone has no
 * room for a floating card inset from the edges, and a panel capped at 85vh
 * leaves strips of dimmed app above and below that look tappable and are not.
 *
 * The rule lives in one place (`.dialog-overlay` / `.dialog-panel` in
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
  // This one measures the work-in-progress notice, so it is the one place that
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
 * A finished run moves to the tab that can show it. Setting the flight view while
 * leaving the user on Simulate puts the chart on the Sketch tab, which they are not
 * looking at, and displaces their drawing.
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
  // The workbench is tabbed at every width, so the same rule applies here as on a
  // phone: the tab picks the family, the switch moves within it, not all five views
  // in one switch.
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

/**
 * The Results tab on the smallest phone we target, where the summary column is
 * capped at 45% of the pane and scrolls inside that cap.
 *
 * The caution leads it and the numbers follow, which is the whole point of the
 * card being above the tiles rather than under them: what a reading is worth is
 * a thing to know before reading it. On a 320x568 phone that puts the tiles off
 * the bottom of the column until it is scrolled, so the thing worth pinning is
 * that they are reachable: a caution that cost you the numbers entirely would
 * defeat the purpose of the order.
 */
test('the Results tab leads with the safety card, and the numbers scroll up behind it', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 }); // the smallest phone we target
  await ready(page);
  await page.getByRole('button', { name: /Simulate/ }).click();
  await page.getByRole('button', { name: /Run flight simulation/ }).click();
  await expect(page.getByRole('button', { name: /Results/ })).toBeVisible({ timeout: 30_000 });

  const m = await page.evaluate(() => {
    const card = document.querySelector('main section[aria-label="Before you fly"]');
    const grid = document.querySelector('main section[aria-label="Simulation results"]');
    const half = document.querySelector('main div.min-h-0.w-full.flex-1.flex-col');
    const pane = half?.parentElement;
    // The summary column, found by what it does rather than by its classes: the
    // nearest ancestor that actually scrolls.
    let col: HTMLElement | null = card?.parentElement ?? null;
    while (col && !(col.scrollHeight > col.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(col).overflowY)))
      col = col.parentElement;
    const box = (el?: Element | null) => (el ? Math.round(el.getBoundingClientRect().top) : null);
    return {
      cardTop: box(card),
      cardBottom: card ? Math.round(card.getBoundingClientRect().bottom) : null,
      summaryTop: box(grid),
      // The column's content edge: it carries a pt-3, so its border box starts
      // 12px above anything inside it.
      colTop: col ? Math.round(col.getBoundingClientRect().top + parseFloat(getComputedStyle(col).paddingTop)) : null,
      colHolds: !!col && !!card && !!grid && col.contains(card) && col.contains(grid),
      colScrolls: col ? col.scrollHeight > col.clientHeight : false,
      chartHeight: half ? Math.round(half.getBoundingClientRect().height) : 0,
      paneHeight: pane ? Math.round(pane.getBoundingClientRect().height) : 0,
    };
  });
  note('results tab', JSON.stringify(m));

  // The card and the tiles are one scrolling column, card first and flush with
  // its top, so the caution is what the tab opens on.
  expect(m.colHolds).toBe(true);
  expect(m.colScrolls).toBe(true);
  expect(m.cardTop).toBe(m.colTop);
  expect(m.summaryTop).toBeGreaterThanOrEqual(m.cardBottom!);

  // And the numbers are a scroll away, not gone: Apogee reaches the viewport.
  // Scoped to the first region in DOM order (the center pane's), because the
  // sim editor keeps its own copy mounted behind the Simulate tab.
  const summary = page.getByRole('region', { name: 'Simulation results' }).first();
  await summary.getByText('Apogee', { exact: true }).scrollIntoViewIfNeeded();
  await expect(summary.getByText('Apogee', { exact: true })).toBeInViewport();

  // The column is capped rather than free to grow, so it scrolls instead of
  // squeezing the chart it describes down to nothing.
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

  // New design straight from the Results tab. The result is gone with it, so the
  // tab has nothing left to show, and every view button belongs to the other
  // family -- which must not leave the switch completely empty.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'New' }).click();
  await page
    .getByRole('button', { name: /Discard/ })
    .click()
    .catch(() => {});

  await expect(resultsTab).toHaveCount(0);
  await expect(page.getByRole('button', { name: '2D', exact: true })).toBeVisible();
});

import { test, expect, type Page, note, openTab, runFlight } from './base';

/**
 * The app shell is a fixed-height column: header, one scrolling pane, then the
 * bottom tab bar. That only holds if the DOCUMENT itself never scrolls — a row
 * that runs past the right edge makes the whole page scrollable sideways, and
 * the tab bar (exactly one viewport wide) slides out of view with it, which is
 * how it stopped reading as a static footer on a phone.
 *
 * So this asserts the shell fits the viewport in both axes at the widths real
 * phones use, in the longer of the two languages as well. It caught two rows
 * that did not wrap: the app header's action group and the 2D/3D/Aero toggle.
 */

for (const w of [320, 360, 390, 414, 600, 768]) {
  test(`no sideways scroll at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 844 });
    await page.goto('/');
    await expect(page.getByText('L/D', { exact: true })).toBeVisible();
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      w: window.innerWidth,
      h: window.innerHeight,
    }));
    note(`${w}: scrollW=${m.sw} innerW=${m.w} scrollH=${m.sh} innerH=${m.h}`);
    expect(m.sw).toBeLessThanOrEqual(m.w);
    expect(m.sh).toBeLessThanOrEqual(m.h);
    if (w < 1024) {
      const box = (await page.getByRole('navigation').last().boundingBox())!;
      note(`${w}: bar bottom=${Math.round(box.y + box.height)}`);
      expect(Math.round(box.y + box.height)).toBe(m.h);
    }
  });
}

test('no sideways scroll in Spanish at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  await page.getByRole('combobox').first().selectOption('es');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible();
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  note('es 320:', m.sw, 'vs', m.w);
  expect(m.sw).toBeLessThanOrEqual(m.w);
});

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
    await page.goto('/');
    await expect(page.getByText('L/D', { exact: true })).toBeVisible();

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
    const toolbar = (await page.getByRole('button', { name: 'Reset' }).boundingBox())!;
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
    const flat = (await page.getByRole('button', { name: 'Reset' }).boundingBox())!;
    expect(flat.width).toBeGreaterThan(flat.height); // back to a normal row

    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
    expect(m.sw).toBeLessThanOrEqual(m.w);
  });

  test('leaves the desktop workbench alone', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto('/');
    await expect(page.getByText('L/D', { exact: true })).toBeVisible();
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
  await page.goto('/');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible();
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
          const host = c.parentElement!;
          // The buffer has to match the host's LAYOUT box -- landscape -- and
          // not the axis-aligned bbox the rotation gives it.
          return Math.abs(c.width - host.offsetWidth) < 3 && Math.abs(c.height - host.offsetHeight) < 3;
        }),
      { timeout: 10_000 },
    )
    .toBe(true);

  const d = await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
  note('3d buffer', JSON.stringify(d));
  expect(d[0]!).toBeGreaterThan(d[1]!); // landscape, as the layout box is
});

test('turns the Aero charts with the sketch, and leaves the flight views upright', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Sketch/ }).click();
  await expect(page.locator('.sketch-rotate')).toHaveCount(1); // 2D

  // Aero is a Mach sweep -- a flat, wide drawing like the schematic, so it turns
  // too and each chart gets the screen's long edge instead of its short one.
  await page.getByRole('button', { name: 'Aero', exact: true }).click();
  await expect(page.locator('.sketch-rotate')).toHaveCount(1);
  const chart = (await page.locator('main svg').first().boundingBox())!;
  note('aero chart', `${Math.round(chart.width)}x${Math.round(chart.height)}`);
  expect(chart.height).toBeGreaterThan(chart.width); // on screen: stood on end
});

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
    await page.goto('/');

    // Settings carries `h-[560px] max-h-[85vh] max-w-lg` of its own, so it also
    // proves the override beats the panel's utilities without !important.
    await page.getByRole('button', { name: /Menu/ }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    const set = (await panel(page).boundingBox())!;
    expect({ w: set.width, h: set.height }).toEqual({ w: 390, h: 844 });
    await page.getByRole('button', { name: 'Close' }).first().click();

    await page.getByRole('button', { name: /Menu/ }).click();
    await page.getByRole('menuitem', { name: 'About' }).click();
    const about = (await panel(page).boundingBox())!;
    expect({ w: about.width, h: about.height }).toEqual({ w: 390, h: 844 });
  });

  test('stay carded at the desktop breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto('/');
    await page.getByRole('button', { name: /Menu/ }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    const set = (await panel(page).boundingBox())!;
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
    await page.goto('/');

    const wip = page.getByRole('button', { name: 'I understand' });
    await expect(wip).toBeVisible();
    const card = (await wip.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]').boundingBox())!;
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
  await page.goto('/');

  const resultsTab = page.getByRole('button', { name: /Results/ });
  await expect(resultsTab).toHaveCount(0); // nothing to show before a run

  await page.getByRole('button', { name: /Simulate/ }).click();
  await page.getByRole('button', { name: /Run flight simulation/ }).click();
  await expect(resultsTab).toBeVisible({ timeout: 30_000 });

  // The run put us there, and the flight chart is what is on screen.
  await expect(resultsTab).toHaveClass(/text-sky-400/);
  await expect(page.getByRole('button', { name: 'Flight', exact: true })).toHaveClass(/bg-sky-600/);

  // The view switch offers only this tab's family: the flight views here…
  for (const v of ['Flight', '3D path']) {
    await expect(page.getByRole('button', { name: v, exact: true })).toBeVisible();
  }
  for (const v of ['2D', '3D', 'Aero']) {
    await expect(page.getByRole('button', { name: v, exact: true })).toBeHidden();
  }

  // Sketch still holds the drawing rather than having been taken over by it…
  await page.getByRole('button', { name: /Sketch/ }).click();
  await expect(page.getByRole('button', { name: '2D', exact: true })).toHaveClass(/bg-sky-600/);

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
  await page.goto('/');
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
  await page.goto('/');
  await page.getByRole('button', { name: /Simulate/ }).click();
  await page.getByRole('button', { name: /Run flight simulation/ }).click();
  await expect(page.getByRole('button', { name: /Results/ })).toBeVisible({ timeout: 30_000 });

  const m = await page.evaluate(() => {
    const grid = document.querySelector('main section[aria-label="Simulation results"]');
    const half = document.querySelector('main div.min-h-0.w-full.flex-1.flex-col');
    return {
      summaryTop: grid ? Math.round(grid.getBoundingClientRect().top) : null,
      chartHeight: half ? Math.round(half.getBoundingClientRect().height) : 0,
      paneHeight: half ? Math.round(half.parentElement!.getBoundingClientRect().height) : 0,
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
  await page.goto('/');
  await page.getByRole('button', { name: /Simulate/ }).click();
  await page.getByRole('button', { name: /Run flight simulation/ }).click();
  const resultsTab = page.getByRole('button', { name: /Results/ });
  await expect(resultsTab).toBeVisible({ timeout: 30_000 });

  // New design straight from the Results tab. The result is gone with it, so
  // the tab has nothing left to show -- and every view button belongs to the
  // other family, which used to leave the switch completely empty.
  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('menuitem', { name: 'New' }).click();
  await page
    .getByRole('button', { name: /Discard/ })
    .click()
    .catch(() => {});

  await expect(resultsTab).toHaveCount(0);
  await expect(page.getByRole('button', { name: '2D', exact: true })).toBeVisible();
});

/**
 * The desktop workbench tabs sit IN the header, not in a strip below it.
 *
 * They used to own a full row of their own to hold two or three words, while the
 * header beside them ran empty from the WASM badge to the far-right controls.
 * Asserted geometrically rather than by class name: what matters is that the
 * tabs cost no vertical space, which is exactly "the nav is inside the header's
 * box", and that nothing wraps the header onto a second line.
 */
test('the workbench tabs live in the header rather than a row of their own', async ({ page }) => {
  // The narrowest desktop width (the lg breakpoint), in the longer of the two
  // languages, with all three tabs showing - the tightest the header ever gets
  // before the bottom bar takes over.
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
  await runFlight(page);
  await page.getByRole('combobox', { name: /language|idioma/i }).selectOption('es');

  const header = page.locator('header').first();
  const nav = page.getByRole('navigation', { name: /Workbench|Banco/i });
  await expect(nav.getByRole('button')).toHaveCount(3);

  const h = (await header.boundingBox())!;
  const n = (await nav.boundingBox())!;

  // Inside the header, horizontally and vertically.
  expect(n.x).toBeGreaterThan(h.x);
  expect(n.y).toBeGreaterThanOrEqual(h.y);
  expect(n.y + n.height).toBeLessThanOrEqual(h.y + h.height + 1);
  expect(n.x + n.width).toBeLessThan(h.x + h.width);

  // One row: the header is no taller than a single line of controls. It wraps by
  // design on a phone, and a wrap here would put back the row this removed.
  expect(h.height).toBeLessThan(70);

  // And the first pane starts immediately under it, with no strip in between.
  const main = page.locator('main');
  expect((await main.boundingBox())!.y).toBeLessThanOrEqual(h.y + h.height + 1);
});

/**
 * The divider between the component tree and the canvas.
 *
 * A fixed column is a guess about a tree nobody has built yet: a deep design
 * truncates names at any width that does not waste space on a shallow one. So
 * the guess is only a default, and the width is the user's, remembered.
 */
test('the tree column can be dragged, and keeps its width', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });

  const pane = page.locator('main > section').first();
  const sep = page.getByRole('separator', { name: /components panel/ });
  const width = async () => (await pane.boundingBox())!.width;
  const drag = async (toX: number) => {
    const b = (await sep.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + 200);
    await page.mouse.down();
    await page.mouse.move(toX, b.y + 200, { steps: 8 });
    await page.mouse.up();
  };

  expect(await width()).toBe(360);
  await drag(480);
  expect(await width()).toBe(480);

  // The width is a preference, so it survives the page.
  await page.reload();
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(await width()).toBe(480);

  // Clamped at both ends: the design actions stop fitting on one row below 300,
  // and past 640 the column is mostly gutter.
  await drag(5);
  expect(await width()).toBe(300);
  await drag(1495);
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
  await page.goto('/');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });

  const sep = page.getByRole('separator', { name: /components panel/ });
  const b = (await sep.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(1000, b.y + 200, { steps: 8 });
  await page.mouse.up();

  const tree = (await page.locator('main > section').first().boundingBox())!;
  const center = (await page.locator('main > section').nth(1).boundingBox())!;
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
  await page.goto('/');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });

  const sep = page.getByRole('separator', { name: /side panel/ });
  const props = page.locator('main > section').nth(2);
  const width = async () => (await props.boundingBox())!.width;
  const drag = async (toX: number) => {
    const b = (await sep.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + 200);
    await page.mouse.down();
    await page.mouse.move(toX, b.y + 200, { steps: 8 });
    await page.mouse.up();
  };

  expect(await width()).toBe(380);
  await drag(1000);
  expect(await width()).toBe(500);

  await page.reload();
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(await width()).toBe(500);

  // The pane is on the RIGHT of this divider, so the clamps are mirrored: drag
  // toward the edge it sits against to shrink it.
  await drag(1495);
  expect(await width()).toBe(300);
  await drag(100);
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
  await page.goto('/');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
  await runFlight(page);

  // Sized once, on Results.
  const sep = page.getByRole('separator', { name: /side panel/ });
  const b = (await sep.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(1100, b.y + 200, { steps: 8 });
  await page.mouse.up();

  const visible = page.locator('main > section:visible').last();
  expect((await visible.boundingBox())!.width).toBe(400);

  // …and the simulation editor and the part editor follow, because they are the
  // same setting rather than three that happen to match.
  await openTab(page, 'Simulations');
  expect((await visible.boundingBox())!.width).toBe(400);
  await openTab(page, 'Design');
  expect((await page.locator('main > section').nth(2).boundingBox())!.width).toBe(400);

  // Design is the only tab with columns on both sides, so the only one with two
  // dividers.
  await expect(page.getByRole('separator')).toHaveCount(2);
  await openTab(page, 'Simulations');
  await expect(page.getByRole('separator')).toHaveCount(1);
});

test('clicking a divider without moving it leaves the width alone', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });

  // The pointer lands a pixel or two off the stored split, so committing its
  // position on a plain click nudged the pane every time it was clicked - and
  // did it again between the two clicks of a double-click, which ate the reset.
  for (const name of [/components panel/, /side panel/]) {
    const sep = page.getByRole('separator', { name });
    const before = (await sep.boundingBox())!.x;
    await sep.click();
    expect((await sep.boundingBox())!.x).toBe(before);
  }
});

/**
 * Maximize: the drawing takes the window and both side columns step aside.
 *
 * An airframe is 15-25x longer than it is wide, so the canvas runs out of
 * horizontal space long before vertical. Dropping the tree and the property
 * editor doubles what the drawing has to work with.
 */
test('the drawing can take the whole window, and come back', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });

  const center = page.locator('main > section').nth(1);
  const width = async () => (await center.boundingBox())!.width;
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
  await page.goto('/');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
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
  await page.goto('/');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /whole window/ }).click();
  await runFlight(page);

  // Results shares the center pane, so it maximizes too.
  expect((await page.locator('main > section').nth(1).boundingBox())!.width).toBe(1500);

  // Simulations does NOT: the toggle lives in the center pane's toolbar, which
  // is not on that tab, so honoring the flag there would hide the simulation
  // editor with no control left to bring it back.
  await openTab(page, 'Simulations');
  await expect(page.locator('main > section:visible')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /Run flight simulation/ })).toBeVisible();
});

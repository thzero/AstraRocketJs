import { test, expect, type Page } from '@playwright/test';

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

const dismiss = (page: Page) =>
  page
    .getByRole('button', { name: 'I understand' })
    .click({ timeout: 10_000 })
    .catch(() => {});

for (const w of [320, 360, 390, 414, 600, 768]) {
  test(`no sideways scroll at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 844 });
    await page.goto('/');
    await dismiss(page);
    await expect(page.getByText('L/D', { exact: true })).toBeVisible();
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      w: window.innerWidth,
      h: window.innerHeight,
    }));
    console.log(`${w}: scrollW=${m.sw} innerW=${m.w} scrollH=${m.sh} innerH=${m.h}`);
    expect(m.sw).toBeLessThanOrEqual(m.w);
    expect(m.sh).toBeLessThanOrEqual(m.h);
    if (w < 1024) {
      const box = (await page.getByRole('navigation').last().boundingBox())!;
      console.log(`${w}: bar bottom=${Math.round(box.y + box.height)}`);
      expect(Math.round(box.y + box.height)).toBe(m.h);
    }
  });
}

test('no sideways scroll in Spanish at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  await dismiss(page);
  await page.getByRole('combobox').first().selectOption('es');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible();
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  console.log('es 320:', m.sw, 'vs', m.w);
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
    await dismiss(page);
    await expect(page.getByText('L/D', { exact: true })).toBeVisible();

    // Rocket tab shows the stats, not the drawing. The drawing stays MOUNTED
    // behind it so switching tabs never reinitialises the canvas -- so it has to
    // come back correctly sized, which the measurements below check.
    await expect(page.locator('main svg').first()).toBeHidden();
    await page.getByRole('button', { name: /Sketch/ }).click();
    await expect(page.locator('main svg').first()).toBeVisible();
    await expect(page.getByText('L/D', { exact: true })).toBeHidden();

    const portrait = await stage(page);
    console.log('portrait', JSON.stringify(portrait));
    expect(portrait.rotated).toBe(true);
    // The toolbar turns WITH the drawing, so it sits along the screen's long
    // edge at the top of the sheet it controls, not across the short edge.
    const toolbar = (await page.getByRole('button', { name: 'Reset' }).boundingBox())!;
    console.log('toolbar', JSON.stringify({ x: Math.round(toolbar.x), y: Math.round(toolbar.y) }));
    expect(toolbar.x).toBeGreaterThan(390 * 0.75); // hard against the right edge
    expect(toolbar.height).toBeGreaterThan(toolbar.width); // stood on end
    // Taller than wide: the canvas took the device's LONG axis for the rocket's
    // length. Unrotated it would be 366x~200 and the rocket a dozen pixels tall.
    expect(portrait.h).toBeGreaterThan(portrait.w);

    await page.setViewportSize({ width: 844, height: 390 });
    const landscape = await stage(page);
    console.log('landscape', JSON.stringify(landscape));
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
    await dismiss(page);
    await expect(page.getByText('L/D', { exact: true })).toBeVisible();
    const desktop = await stage(page);
    console.log('desktop', JSON.stringify(desktop));
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
  await dismiss(page);
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
  console.log('3d buffer', JSON.stringify(d));
  expect(d[0]).toBeGreaterThan(d[1]); // landscape, as the layout box is
});

test('turns the Aero charts with the sketch, and leaves the flight views upright', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await dismiss(page);
  await expect(page.getByText('L/D', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Sketch/ }).click();
  await expect(page.locator('.sketch-rotate')).toHaveCount(1); // 2D

  // Aero is a Mach sweep -- a flat, wide drawing like the schematic, so it turns
  // too and each chart gets the screen's long edge instead of its short one.
  await page.getByRole('button', { name: 'Aero', exact: true }).click();
  await expect(page.locator('.sketch-rotate')).toHaveCount(1);
  const chart = (await page.locator('main svg').first().boundingBox())!;
  console.log('aero chart', `${Math.round(chart.width)}x${Math.round(chart.height)}`);
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
    await dismiss(page);

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
    await dismiss(page);
    await page.getByRole('button', { name: /Menu/ }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    const set = (await panel(page).boundingBox())!;
    console.log('desktop dialog', `${Math.round(set.width)}x${Math.round(set.height)}`);
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
test('leaves short prompts as centred cards on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  // The work-in-progress notice is up before anything is dismissed.
  const wip = page.getByRole('button', { name: 'I understand' });
  await expect(wip).toBeVisible();
  const card = (await wip.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]').boundingBox())!;
  console.log('wip card', `${Math.round(card.width)}x${Math.round(card.height)} at y=${Math.round(card.y)}`);
  expect(card.width).toBeLessThan(390); // inset from the edges
  expect(card.height).toBeLessThan(844 / 2); // sized to its content, not the screen
  expect(card.y).toBeGreaterThan(0); // centred, not pinned to the top
  await expect(page.locator('.dialog-panel')).toHaveCount(0);
});

/**
 * A finished run used to set the flight view while leaving you on Simulate --
 * so the chart appeared on the Sketch tab, which you were not looking at, and
 * your drawing was displaced by it. The flight views now have their own tab.
 */
test('a finished run lands on the Results tab', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await dismiss(page);

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

test('the desktop workbench still offers all five views at once', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('/');
  await dismiss(page);
  await page.getByRole('button', { name: /Run flight simulation/ }).click();
  await expect(page.getByRole('button', { name: 'Flight', exact: true })).toBeVisible({ timeout: 30_000 });
  // No tabs up here, so nothing to split the families across.
  for (const v of ['2D', '3D', 'Aero', 'Flight', '3D path']) {
    await expect(page.getByRole('button', { name: v, exact: true })).toBeVisible();
  }
});

test('the Results tab leads with the run numbers, without starving the chart', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 }); // the smallest phone we target
  await page.goto('/');
  await dismiss(page);
  await page.getByRole('button', { name: /Simulate/ }).click();
  await page.getByRole('button', { name: /Run flight simulation/ }).click();
  await expect(page.getByRole('button', { name: /Results/ })).toBeVisible({ timeout: 30_000 });

  const m = await page.evaluate(() => {
    const grid = document.querySelector('main .grid.grid-cols-3');
    const half = document.querySelector('main div.min-h-0.w-full.flex-1.flex-col');
    return {
      summaryTop: grid ? Math.round(grid.getBoundingClientRect().top) : null,
      chartHeight: half ? Math.round(half.getBoundingClientRect().height) : 0,
      paneHeight: half ? Math.round(half.parentElement!.getBoundingClientRect().height) : 0,
    };
  });
  console.log('results tab', JSON.stringify(m));

  // Apogee and the rest are the first thing on the tab. Scoped to the first grid
  // in DOM order — the centre pane's — because the simulations pane keeps its
  // own copy mounted behind the Simulate tab.
  const summary = page.locator('main .grid.grid-cols-3').first();
  await expect(summary).toBeVisible();
  await expect(summary.getByText('Apogee', { exact: true })).toBeVisible();
  expect(m.summaryTop).toBeLessThan(m.chartHeight); // above the chart, not below
  // …but the tiles are a fixed ~300px, so they are capped and scroll rather than
  // squeezing the chart they describe down to nothing (it was 91px before).
  expect(m.chartHeight).toBeGreaterThan(200);
  expect(m.chartHeight).toBeGreaterThan(m.paneHeight * 0.5);
});

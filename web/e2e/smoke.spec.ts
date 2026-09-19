import { test, expect, autosaved, openTab } from './base';

/**
 * Behavioral smoke suite — asserts on DOM/behavior, not pixels, so an
 * intentional UI tweak doesn't break it. Covers the paths that only ever fail
 * at runtime (engine → store → canvas) and the regressions we've already fixed
 * (sim run unlocking result views, workspace persistence across reload).
 *
 * Selector notes: the caliper buttons expose their label through `title` (their
 * text is just the ⟺/⇕ glyph), so getByTitle.
 */

test.describe('AstraRocketJs smoke', () => {
  test('boots with an engine-computed design', async ({ page }) => {
    await page.goto('/');

    // The simulations table proves the sim pane + store mounted — it lives on
    // its own tab now, so go there and come back.
    await openTab(page, 'Simulations');
    await expect(page.getByRole('row').filter({ hasText: 'Simulation 1' })).toBeVisible();
    await openTab(page, 'Design');

    // The stats footer only populates from live StaticInfo — "L/D" is the
    // unique fineness-tile unit, so its presence means the engine ran and the
    // tiles rendered real numbers.
    await expect(page.getByText('L/D', { exact: true })).toBeVisible();

    // Design views are always available; result views are not yet. Exact match
    // so "Flight" doesn't substring-hit the "Run flight simulation" button.
    await expect(page.getByRole('button', { name: '2D', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aero', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Flight', exact: true })).toHaveCount(0);
  });

  test('running a sim unlocks the Flight view and clears "not run"', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Flight', exact: true })).toHaveCount(0);

    await openTab(page, 'Simulations');
    await page.getByRole('button', { name: /run flight simulation/i }).click();

    // Engine runs the RK4 flight; when it lands, the Flight/3D-path views
    // appear and the sim's summary replaces the "not run" placeholder.
    await expect(page.getByRole('button', { name: 'Flight', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('not run')).toHaveCount(0);
  });

  test('the sim runs off the main thread (UI stays responsive)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('L/D', { exact: true })).toBeVisible();
    // Before the heartbeat: switching tabs is its own React render, and folding
    // it into the measurement would blame the worker for a stall it did not cause.
    await openTab(page, 'Simulations');

    // Plant a requestAnimationFrame heartbeat; the largest gap between frames is
    // how long the main thread was blocked. A synchronous sim stalls it for the
    // full ~500 ms compute; the Web Worker keeps it to frame-scale. Guards
    // against regressing runSim back onto the main thread.
    await page.evaluate(() => {
      (window as unknown as { __g: number[] }).__g = [];
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        (window as unknown as { __g: number[] }).__g.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /run flight simulation/i }).click();
    await expect(page.getByRole('button', { name: 'Flight', exact: true })).toBeVisible({ timeout: 30_000 });

    const maxStall = await page.evaluate(() => Math.max(...(window as unknown as { __g: number[] }).__g));
    // Generous ceiling: observed ~30 ms on the worker path; a main-thread sim
    // would blow well past this (~480 ms).
    expect(maxStall).toBeLessThan(300);
  });

  test('a duplicated simulation survives a page reload', async ({ page }) => {
    await page.goto('/');

    // Duplicate the one default simulation from the toolbar.
    await openTab(page, 'Simulations');
    await page.getByRole('button', { name: 'Duplicate simulation' }).click();

    // The table is the count now: two rows, the copy named after the original.
    const rows = page.getByRole('row').filter({ hasText: /Simulation/ });
    await expect(rows).toHaveCount(2);

    // Wait for the autosave to actually land, rather than guessing at the
    // debounce plus the IndexedDB write. One "launch" block per simulation, so
    // two of them means the duplicate is persisted.
    await autosaved(page, '"launch":', 2);
    await page.reload();

    await openTab(page, 'Simulations');
    await expect(page.getByRole('row').filter({ hasText: /Simulation/ })).toHaveCount(2);
  });

  test('length calipers toggle on and off from the header controls', async ({ page }) => {
    await page.goto('/');

    const caliper = page.getByTitle(/Length calipers/i);
    await expect(caliper).toBeVisible();
    await expect(caliper).toHaveAttribute('aria-pressed', 'false');

    await caliper.click();
    await expect(caliper).toHaveAttribute('aria-pressed', 'true');

    await caliper.click();
    await expect(caliper).toHaveAttribute('aria-pressed', 'false');
  });
});

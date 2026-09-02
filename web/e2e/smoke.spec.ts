import { test, expect, type Page } from '@playwright/test';

// The pre-1.0 "work in progress" modal shows on a fresh context and its overlay
// swallows clicks, so every test dismisses it right after loading.
async function dismissWip(page: Page) {
  await page.getByRole('button', { name: 'I understand' }).click({ timeout: 10_000 }).catch(() => {});
}

/**
 * Behavioral smoke suite — asserts on DOM/behaviour, not pixels, so an
 * intentional UI tweak doesn't break it. Covers the paths that only ever fail
 * at runtime (engine → store → canvas) and the regressions we've already fixed
 * (sim run unlocking result views, workspace persistence across reload).
 *
 * Selector notes: the Simulations list toggle's accessible name is the chevron
 * glued to the title ("▸Simulations"), so it's matched by regex to avoid the
 * separate "Hide simulations" pane handle. The caliper buttons expose their
 * label through `title` (their text is just the ⟺/⇕ glyph), so getByTitle.
 */

// The list toggle button: "▸Simulations" collapsed, "▾Simulations" open.
const simsToggle = /[▸▾]\s*Simulations/;

test.describe('AstraRocketJs smoke', () => {
  test('boots with an engine-computed design', async ({ page }) => {
    await page.goto('/');
    await dismissWip(page);

    // The Simulations list toggle proves the right pane + store mounted.
    await expect(page.getByRole('button', { name: simsToggle })).toBeVisible();

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
    await dismissWip(page);

    await expect(page.getByRole('button', { name: 'Flight', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: /run flight simulation/i }).click();

    // Engine runs the RK4 flight; when it lands, the Flight/3D-path views
    // appear and the sim's summary replaces the "not run" placeholder.
    await expect(page.getByRole('button', { name: 'Flight', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('not run')).toHaveCount(0);
  });

  test('the sim runs off the main thread (UI stays responsive)', async ({ page }) => {
    await page.goto('/');
    await dismissWip(page);
    await expect(page.getByText('L/D', { exact: true })).toBeVisible();

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

    const maxStall = await page.evaluate(() =>
      Math.max(...(window as unknown as { __g: number[] }).__g));
    // Generous ceiling: observed ~30 ms on the worker path; a main-thread sim
    // would blow well past this (~480 ms).
    expect(maxStall).toBeLessThan(300);
  });

  test('a duplicated simulation survives a page reload', async ({ page }) => {
    await page.goto('/');
    await dismissWip(page);

    // Open the (collapsed) Simulations list, then duplicate the one default sim.
    await page.getByRole('button', { name: simsToggle }).click();
    await page.getByRole('button', { name: 'Duplicate simulation' }).first().click();

    // Duplicating collapses the list back down; the header then shows a "(2)"
    // count once there's more than one sim.
    await expect(page.getByText('(2)')).toBeVisible();

    // Give the debounced autosave a beat, then reload — the beforeunload flush
    // should also cover this, but the wait keeps the test from racing it.
    await page.waitForTimeout(700);
    await page.reload();

    await expect(page.getByText('(2)')).toBeVisible();
  });

  test('length calipers toggle on and off from the header controls', async ({ page }) => {
    await page.goto('/');
    await dismissWip(page);

    const caliper = page.getByTitle(/Length calipers/i);
    await expect(caliper).toBeVisible();
    await expect(caliper).toHaveAttribute('aria-pressed', 'false');

    await caliper.click();
    await expect(caliper).toHaveAttribute('aria-pressed', 'true');

    await caliper.click();
    await expect(caliper).toHaveAttribute('aria-pressed', 'false');
  });
});

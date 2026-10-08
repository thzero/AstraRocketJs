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

  /**
   * The header's save status, end to end: the autosave actually landing is
   * what puts it on screen. It replaced the File menu's Save item, so this is
   * now the only thing in the app that tells anyone their work is being kept -
   * and it is wired through three places (the write's success path, the store,
   * the header) that no unit test crosses.
   */
  test('says when the rocket was last saved, once a save has landed', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
    // Nothing has been written yet, and a "Saved" over a design that has never
    // reached storage is the one thing this must not say.
    await expect(page.getByText(/^Saved/)).toHaveCount(0);

    // Any edit starts the debounced autosave; this is the cheapest one.
    await openTab(page, 'Simulations');
    await page.getByRole('button', { name: 'Duplicate simulation' }).click();
    await autosaved(page, '"launch":', 2);

    await expect(page.getByText(/^Saved/)).toHaveText('Saved just now');

    // And the File menu no longer offers a Save of its own.
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'Save As…' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Save', exact: true })).toHaveCount(0);
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

  test('the sim runs off the main thread', async ({ page }) => {
    // Before the app loads, so the sim pool's workers are wrapped as they spawn.
    // A sim run on the main thread posts nothing to a worker, so this fails on
    // any machine. Not a frame-gap ceiling: rendering the click and the results
    // is main-thread work by design, and its length depends on the machine.
    await page.addInitScript(() => {
      const probe: { id?: number; posted: boolean; replied: boolean } = { posted: false, replied: false };
      (window as unknown as { __sim: typeof probe }).__sim = probe;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- saved to patch the prototype; called back with .call(this, ...)
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (this: Worker, msg: unknown, ...rest: unknown[]) {
        const m = msg as { id?: number; method?: string } | null;
        if (m?.method === 'simulate' && !probe.posted) {
          probe.posted = true;
          probe.id = m.id;
          this.addEventListener('message', (e: MessageEvent<{ id?: number }>) => {
            if (e.data?.id === probe.id) probe.replied = true;
          });
        }
        return (post as (...a: unknown[]) => void).call(this, msg, ...rest);
      } as typeof Worker.prototype.postMessage;
    });
    await page.goto('/');
    await expect(page.getByText('L/D', { exact: true })).toBeVisible();
    await openTab(page, 'Simulations');

    await page.getByRole('button', { name: /run flight simulation/i }).click();
    await expect(page.getByRole('button', { name: 'Flight', exact: true })).toBeVisible({ timeout: 30_000 });

    const sim = await page.evaluate(
      () => (window as unknown as { __sim: { posted: boolean; replied: boolean } }).__sim,
    );
    expect(sim.posted, 'the flight was posted to a worker').toBe(true);
    expect(sim.replied, 'and its result came back from that worker').toBe(true);
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

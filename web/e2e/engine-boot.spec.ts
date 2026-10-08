import { test, expect } from './base';

/**
 * The app comes up without the physics kernel, and can get one later.
 *
 * The React mount does not wait on `initEngine()`. If it did, every way a
 * multi-megabyte download can go wrong would keep the whole app from appearing,
 * and the worst of them is silent: a stalled fetch neither resolves nor rejects,
 * so the splash would stay up with nothing on screen and no way out.
 *
 * Both tests here stall the engine the way the network does it (the route is
 * never fulfilled and never aborted), because a stall is the case that reports
 * nothing, where an abort raises an error. `waitUntil: 'domcontentloaded'`, not the default `load`, for the same
 * reason: a pending subresource holds the load event open, which is exactly the
 * condition under test rather than a problem with it.
 */
const stall = async (page: import('@playwright/test').Page, blocked: () => boolean) => {
  await page.route(/openrocket-engine|\.wasm/, async (route) => {
    if (blocked()) return;
    await route.continue();
  });
};

test('comes up and stays usable while the engine hangs', async ({ page }) => {
  await stall(page, () => true);
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // The shell is on screen with no kernel at all...
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible({ timeout: 20_000 });
  // ...and the parts of the app that never needed one work: the tree is built
  // from the design, not from the engine, so a component still selects.
  await page.locator('div[title="Nose cone"]').first().click();
  await expect(page.getByRole('button', { name: /Select part/ })).toBeVisible();

  // What is missing is only the numbers, and something on screen says why
  // rather than leaving a blank where the statistics belong.
  await expect(page.getByText('L/D', { exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /engine/i })
      .first(),
  ).toBeVisible();
});

test('a hung engine can be retried without reloading the page', async ({ page }) => {
  // The retry is offered on a timer, because a stall reports nothing: no error,
  // no progress, no end. Elapsed time is the only thing that separates it from a
  // slow link, so this test has to outwait that threshold.
  test.setTimeout(120_000);
  let blocked = true;
  await stall(page, () => blocked);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('L/D', { exact: true })).toHaveCount(0);

  const retry = page.getByRole('button', { name: /Retry/i });
  await expect(retry).toBeVisible({ timeout: 60_000 });

  // Let the engine through and take the way out. The numbers arriving is the
  // whole point: the retry has to issue a new request rather than joining the
  // stalled one, which is what the `?retry=` url in openRocketEngine is for.
  blocked = false;
  await retry.click();
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('status').filter({ hasText: /engine/i })).toHaveCount(0);
});

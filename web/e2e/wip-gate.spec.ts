import { test, expect } from './base';

/**
 * The pre-1.0 work-in-progress gate.
 *
 * Twenty specs opened by clicking this away inside a `.catch(() => {})`, so
 * seventy-six times a run the app asserted nothing whatsoever about it: had the
 * notice stopped appearing, stopped blocking, or stopped staying dismissed,
 * every one of those calls would have carried on silently. The fixture now sets
 * the stored flag instead of clicking, which makes this file the only place the
 * gate is exercised at all — so it asserts the three things the gate is for.
 */
test.describe('work-in-progress gate', () => {
  test.use({ wip: 'shown' });

  test('blocks the app on a first visit and lets go once acknowledged', async ({ page }) => {
    await page.goto('/');

    const accept = page.getByRole('button', { name: 'I understand' });
    await expect(accept).toBeVisible();

    // "Blocked" is not "hidden": the app renders behind a dimmed backdrop, so
    // the Menu button is perfectly visible to `toBeVisible` and completely
    // unclickable. What matters is which element is actually on top at its
    // center — that backdrop absorbing a click is the whole reason a failed
    // dismissal used to surface against some innocent control twenty steps later.
    const menu = page.getByRole('button', { name: 'Menu' });
    const topmostIsMenu = () =>
      menu.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      });
    expect(await topmostIsMenu()).toBe(false);

    await accept.click();
    await expect(accept).toBeHidden();
    expect(await topmostIsMenu()).toBe(true);
  });

  test('stays acknowledged across a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'I understand' }).click();
    await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });

    // The acknowledgment rides in the settings blob, so it has to survive the
    // round trip through localStorage — not just the current page's state.
    await page.reload();
    await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'I understand' })).toHaveCount(0);
  });
});

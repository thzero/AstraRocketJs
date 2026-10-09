import { test, expect, openTab, runFlight, type Page } from './base';

/**
 * Settings > Simulation > "Run outdated simulations automatically": opening a
 * results view flies the active simulation when its result is missing or out of
 * date, with no press of Run.
 */

async function setAutoRun(page: Page, on: boolean): Promise<void> {
  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Simulation' }).click();
  const box = dialog.getByRole('checkbox', { name: 'Run outdated simulations automatically' });
  await box.setChecked(on);
  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await expect(dialog).toBeHidden();
}

/** Fly once, then age the result by moving the launch angle. */
async function outdatedResult(page: Page): Promise<void> {
  await runFlight(page);
  await openTab(page, 'Simulations');
  const angle = page.getByLabel('Angle', { exact: true });
  await angle.fill('5');
  await angle.blur();
  await expect(page.getByRole('row').filter({ hasText: 'Simulation 1' })).toContainText('Outdated');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opening Results re-flies an outdated simulation when the setting is on', async ({ page }) => {
  await setAutoRun(page, true);
  await outdatedResult(page);

  await openTab(page, 'Results');
  // The amber marker gives way to Running when the re-flight starts, and
  // Running goes once the result lands. Both are waited for here: a run that
  // lands while another tab is open brings the user back to Results.
  await expect(page.getByText('Outdated', { exact: true })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Running' })).toHaveCount(0, { timeout: 30_000 });
  await openTab(page, 'Simulations');
  await expect(page.getByRole('row').filter({ hasText: 'Simulation 1' })).toContainText('Up to date');
});

test('leaves an outdated simulation alone when the setting is off', async ({ page }) => {
  await setAutoRun(page, false);
  await outdatedResult(page);

  await openTab(page, 'Results');
  // The Results view is up with its amber marker. An auto-run would have queued
  // the row by now: `runSims` marks it before its first await.
  await expect(page.getByText('Outdated', { exact: true }).first()).toBeVisible();
  await openTab(page, 'Simulations');
  await expect(page.getByRole('row').filter({ hasText: 'Simulation 1' })).toContainText('Outdated');
});

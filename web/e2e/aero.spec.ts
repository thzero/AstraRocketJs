import { test, expect, type Page } from '@playwright/test';

const dismiss = (page: Page) =>
  page
    .getByRole('button', { name: 'I understand' })
    .click({ timeout: 10_000 })
    .catch(() => {});

const xTicks = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('text')]
      .map((t) => (t.textContent || '').trim())
      .filter((t) => /^M [0-9.]+$/.test(t) || /^[0-9]+(\.[0-9])?$/.test(t)),
  );

/**
 * The Mach sweep defaults to M1 because the overwhelming majority of hobby
 * flights never reach it — sweeping to M3 spent two thirds of the x axis on
 * speeds the rocket will not see.
 */
test.describe('aero drag sweep', () => {
  test('defaults to M1 and labels its axis in fifths', async ({ page }) => {
    await page.goto('/');
    await dismiss(page);
    await page.getByRole('button', { name: 'Aero', exact: true }).click();

    // Charts, not the tables: the curves are what you come to Aero to see, and
    // the tables are the follow-up question.
    await expect(page.getByRole('button', { name: 'Charts', exact: true })).toHaveClass(/bg-sky-600/);
    await expect(page.locator('main table')).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'M1', exact: true })).toHaveClass(/bg-sky-600/);
    for (const m of ['M1', 'M2', 'M3', 'M5']) {
      await expect(page.getByRole('button', { name: m, exact: true })).toBeVisible();
    }

    // A sub-Mach-1 sweep ticked in whole numbers would read "M 0 … 1" and
    // nothing between, so it gets a decimal place.
    const ticks = await xTicks(page);
    expect(ticks).toContain('0.2');
    expect(ticks).toContain('0.8');
  });

  test('keeps whole-number labels on the wider sweeps', async ({ page }) => {
    await page.goto('/');
    await dismiss(page);
    await page.getByRole('button', { name: 'Aero', exact: true }).click();
    await page.getByRole('button', { name: 'M3', exact: true }).click();

    const ticks = await xTicks(page);
    expect(ticks).toContain('1');
    expect(ticks).toContain('3');
    expect(ticks).not.toContain('0.2'); // the decimals belong to M1 alone
  });
});

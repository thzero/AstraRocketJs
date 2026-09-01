import { test, expect, type Page } from '@playwright/test';

/**
 * Guards the newly-exposed component-editor options render (and the new boolean
 * field kind doesn't crash the panel). Data round-trips are unit-tested in
 * orkFile.test.ts; this just drives the editor for a few types on the default
 * rocket. Tree rows carry title="<part label>", so clicking selects the part.
 */

async function dismissWip(page: Page) {
  await page.getByRole('button', { name: 'I understand' }).click({ timeout: 10_000 }).catch(() => {});
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await dismissWip(page);
});

test('nose-cone editor exposes shoulder fields incl. the capped toggle', async ({ page }) => {
  await page.locator('div[title="Nose cone"]').click();
  await expect(page.getByLabel('Shoulder length')).toBeVisible();
  await expect(page.getByLabel('Shoulder radius')).toBeVisible();
  await expect(page.getByLabel('Shoulder capped')).toBeVisible(); // boolean field kind
});

test('body-tube editor exposes the motor-mount toggle + overhang', async ({ page }) => {
  await page.locator('div[title="Body tube"]').click();
  const mount = page.getByLabel('Motor mount');
  await expect(mount).toBeVisible();
  await expect(page.getByLabel('Motor overhang')).toBeVisible();
});

test('fin editor exposes fin-tab fields', async ({ page }) => {
  await page.locator('div[title="Trapezoidal fin set"]').click();
  await expect(page.getByLabel('Fin tab length')).toBeVisible();
  await expect(page.getByLabel('Fin tab height')).toBeVisible();
});

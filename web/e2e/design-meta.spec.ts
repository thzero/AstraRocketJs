import { test, expect, type Page } from '@playwright/test';

const dismiss = (page: Page) =>
  page
    .getByRole('button', { name: 'I understand' })
    .click({ timeout: 10_000 })
    .catch(() => {});

/**
 * The Rocket-configuration dialog edits `name`, `designer`, `comments`,
 * `revision` and `designType` — all round-tripped to the `.ork`, none of them
 * physics.
 *
 * The store replaces the whole tree object for these edits, and both the engine
 * rebuild and the result-invalidation used to key on the tree's object identity.
 * So typing a designer name ran a full engine rebuild + aero sweep and threw
 * away every simulation result the user had.
 */
test('editing the design metadata keeps the flight results', async ({ page }) => {
  await page.goto('/');
  await dismiss(page);

  await page.getByRole('button', { name: /Run flight simulation/ }).click();
  // The Flight view only exists once a result does.
  const flight = page.getByRole('button', { name: 'Flight', exact: true });
  await expect(flight).toBeVisible({ timeout: 30_000 });

  // Pin the actual number, so a silently re-run simulation would still be caught
  // if it landed on a different value.
  const apogeeTile = page.locator('text=Apogee').first().locator('..');
  const apogee = (await apogeeTile.textContent())?.trim();
  expect(apogee).toBeTruthy();

  await page.getByRole('button', { name: 'Edit rocket configuration' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rocket configuration' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Designer' }).fill('Ada Lovelace');
  await dialog.getByRole('textbox', { name: 'Revision history' }).fill('rev 2');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();

  // The result is still there, and still the same result.
  await expect(flight).toBeVisible();
  expect((await apogeeTile.textContent())?.trim()).toBe(apogee);
});

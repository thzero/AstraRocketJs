import { test, expect, autosaved, runFlight } from './base';

/**
 * Recovery-device deployment overrides. The default rocket carries a parachute,
 * so selecting it in the component tree opens its editor. Asserts the deploy
 * event / altitude / delay controls are present, that a changed override
 * survives a reload (workspace autosave), and that it flows through the
 * build → worker → engine path (the sim runs cleanly with a non-default event).
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('the parachute editor exposes deployment overrides, simulates, and persists', async ({ page }) => {
  // The tree row carries title="Parachute"; clicking it selects the device.
  await page.locator('div[title="Parachute"]').click();

  // Recovery-specific editors: shroud lines + surface/line material pickers.
  await expect(page.getByLabel('Shroud lines')).toBeVisible();
  await expect(page.getByLabel('Line length')).toBeVisible();
  await expect(page.getByText('Canopy material')).toBeVisible();
  await expect(page.getByText('Shroud line material')).toBeVisible();

  const deploy = page.getByLabel('Deploy at');
  await expect(deploy).toBeVisible();
  await expect(deploy).toHaveValue('apogee'); // default

  // Switch to altitude-triggered deployment and configure it.
  await deploy.selectOption('altitude');
  await page.getByLabel('Deploy altitude (AGL)').fill('150');
  await page.getByLabel('Deploy delay').fill('1');

  // The override reaches the engine — a flight runs cleanly with it applied.
  // (A tab away now: running lives on the Simulations tab.)
  await runFlight(page);

  // It rides on the design, so the workspace autosave restores it after reload
  // — once the write has landed. The 700 ms guess here failed twice in one
  // afternoon on a loaded machine while passing in isolation.
  await autosaved(page, '"deployAltitude":150');
  await page.reload();
  await page.locator('div[title="Parachute"]').click();
  await expect(page.getByLabel('Deploy at')).toHaveValue('altitude');
});

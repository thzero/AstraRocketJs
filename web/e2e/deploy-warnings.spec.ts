import { test, expect, openTab, runFlight } from './base';

/**
 * Recovery-deployment warnings, end to end: the setting reaches the kernel, the
 * kernel decides, and the Results tab shows what it decided.
 *
 * Both halves were missing. The threshold never left the browser — the engine
 * ran on its own hard-coded 20 m/s, so moving the setting repainted a summary
 * tile and changed nothing about the flight — and the warnings the engine did
 * export were parsed into `FlightResult.warnings` and never rendered.
 */

async function setDeploySpeedWarn(page: import('@playwright/test').Page, ms: string) {
  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Simulation' }).click();
  await dialog.getByLabel('Deploy-speed warning above', { exact: true }).fill(ms);
  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await expect(dialog).toBeHidden();
}

test('the deployment-speed threshold reaches the engine and its warning is shown', async ({ page }) => {
  await page.goto('/');

  // Absurdly low: the default rocket's chute cannot come out this slowly, so the
  // kernel must flag it.
  await setDeploySpeedWarn(page, '0.1');
  await runFlight(page);
  const warnings = page.getByText(/Flight warnings/);
  await expect(warnings).toBeVisible();

  // Absurdly high: same flight, same everything, no warning. If the threshold
  // were still stuck at the kernel default, both runs would read the same.
  await setDeploySpeedWarn(page, '900');
  await openTab(page, 'Simulations');
  await runFlight(page);
  await expect(warnings).toHaveCount(0);
});

test('a per-simulation threshold overrides the global one', async ({ page }) => {
  await page.goto('/');
  await openTab(page, 'Simulations');

  // Empty means "follow the global", shown as the placeholder -- so the field
  // reads as the number that will actually be used.
  const perSim = page.getByLabel('Deploy-speed warning above', { exact: true });
  await expect(perSim).toHaveValue('');
  await expect(perSim).toHaveAttribute('placeholder', '20.0');

  // The global stays at 20 m/s, which this flight does not trip. Only the
  // simulation's own value does.
  await perSim.fill('0.1');
  await runFlight(page);
  await expect(page.getByText(/Flight warnings/)).toBeVisible();

  // Clearing it hands the setting back to the global, and the warning goes.
  await openTab(page, 'Simulations');
  await perSim.fill('');
  await runFlight(page);
  await expect(page.getByText(/Flight warnings/)).toHaveCount(0);
});

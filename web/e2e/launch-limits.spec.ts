import { test, expect, openTab } from './base';

/**
 * The NAR / Tripoli flying limits, on the path that can get around the fields.
 *
 * Launch conditions are simulation SETTINGS, not design, so a `.ork` carrying
 * conditions outside the codes is not something to preserve as authored: the
 * import says so, and the run refuses until they are brought back inside. The
 * entry fields cap what you can type (see simulations-tab.spec.ts); this is the
 * case they cannot cover.
 *
 * `out-of-limits.ork` is `two-stage.ork` with a 35° rod angle and 15 m/s
 * (~34 mph) of wind.
 */
test('an imported .ork outside the limits is flagged and refused', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.setInputFiles('input[type=file]', 'e2e/fixtures/out-of-limits.ork');
  await expect(page.getByText('Booster').first()).toBeVisible({ timeout: 20_000 });

  // The loaded banner lists what is wrong, with the numbers and the rule.
  const banner = page.getByText(/Launch rod angle is 35/);
  await expect(banner).toBeVisible();
  await expect(page.getByText(/Wind speed is 33.6 mph/)).toBeVisible();

  // And the run is off the table until it is fixed.
  await openTab(page, 'Simulations');
  const run = page.getByRole('button', { name: /^Run/ });
  await expect(run).toBeDisabled();
  await expect(page.getByText(/outside the NAR\/Tripoli safety codes/)).toBeVisible();

  // Bring both back inside and it flies. The fields clamp, so typing anything
  // over the cap lands exactly on it.
  await page.getByLabel('Angle', { exact: true }).fill('5');
  await page.getByLabel('Speed', { exact: true }).fill('3');
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page.getByRole('button', { name: 'Flight', exact: true })).toBeVisible({ timeout: 30_000 });
});

import { test, expect, type Page, importOrk } from './base';

const openAero = async (page: Page) => {
  await page.getByRole('button', { name: 'Aero', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Charts', exact: true })).toBeVisible();
};

/**
 * The power-on drag curve.
 *
 * This is the ONE figure in the Aero panel that depends on the motor. Everything
 * else — power-off Cd, the friction/pressure/base split, CP, CNα, the roll
 * coefficients — is geometry.
 *
 * And it reaches the sweep by an indirect route worth pinning: `nozzleExitDiameter`
 * is a STAGE property in our tree, captured by `applySeparationConfig` into
 * `ctx.nozzleDia` and then applied to the seated motor's `MotorConfiguration` in
 * `applyMotor`. The sweep reads it back off the mounts by fcid — deliberately,
 * because the FlightConfiguration's own motors map is stale under our
 * `setMotorById` flow (a comment at OpenRocketEngine.java:698 says so). So the
 * curve needs a stage nozzle AND a seated motor, and a future change to either
 * half can silently drop it.
 *
 * There is no UI for `nozzleExitDiameter`; it is import/export only, so this
 * starts from a fixture.
 */
test.describe('power-on drag curve', () => {
  test('appears for an .ork with a stage nozzle exit diameter, and names its motor', async ({ page }) => {
    await page.goto('/');
    await importOrk(page, 'e2e/fixtures/nozzle.ork');
    await openAero(page);

    // The second Cd series only exists when the kernel reports hasNozzle.
    await expect(page.getByText('Power-on', { exact: true })).toBeVisible({ timeout: 15_000 });

    // …and the panel says which motor it belongs to, since there is no motor
    // selector here — the active simulation's motor is what gets analyzed.
    await expect(page.getByText(/^Power-on: /)).toBeVisible();
  });

  test('is absent for the same design without the nozzle element', async ({ page }) => {
    await page.goto('/');
    // two-stage.ork is byte-identical to nozzle.ork but for the one element, so
    // this pins that the curve tracks the nozzle and nothing else about the file.
    await importOrk(page, 'e2e/fixtures/two-stage.ork');
    await openAero(page);

    await expect(page.getByText('Cd vs Mach')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Power-on', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/^Power-on: /)).toHaveCount(0);
  });
});

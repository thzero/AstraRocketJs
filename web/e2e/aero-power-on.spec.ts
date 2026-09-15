import { test, expect, type Page } from '@playwright/test';

const dismiss = (page: Page) =>
  page
    .getByRole('button', { name: 'I understand' })
    .click({ timeout: 10_000 })
    .catch(() => {});

const openAero = async (page: Page) => {
  await page.getByRole('button', { name: 'Aero', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Charts', exact: true })).toBeVisible();
};

/**
 * Import and WAIT for the design to land.
 *
 * `setInputFiles` returns as soon as the file is handed over; the parse, the
 * tree swap and the engine rebuild are all async after that. Without a
 * synchronisation point the next click can run against the default rocket, and
 * the assertion then fails for a reason that has nothing to do with the feature.
 * The Booster stage is unique to these fixtures, so its appearance in the tree
 * means the import has actually been applied.
 */
const importOrk = async (page: Page, fixture: string) => {
  // The engine has run on the default design before we replace it.
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.setInputFiles('input[type=file]', fixture);
  await expect(page.getByText('Booster').first()).toBeVisible({ timeout: 20_000 });
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
    await dismiss(page);
    await importOrk(page, 'e2e/fixtures/nozzle.ork');
    await openAero(page);

    // The second Cd series only exists when the kernel reports hasNozzle.
    await expect(page.getByText('Power-on', { exact: true })).toBeVisible({ timeout: 15_000 });

    // …and the panel says which motor it belongs to, since there is no motor
    // selector here — the active simulation's motor is what gets analysed.
    await expect(page.getByText(/^Power-on: /)).toBeVisible();
  });

  test('is absent for the same design without the nozzle element', async ({ page }) => {
    await page.goto('/');
    await dismiss(page);
    // two-stage.ork is byte-identical to nozzle.ork but for the one element, so
    // this pins that the curve tracks the nozzle and nothing else about the file.
    await importOrk(page, 'e2e/fixtures/two-stage.ork');
    await openAero(page);

    await expect(page.getByText('Cd vs Mach')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Power-on', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/^Power-on: /)).toHaveCount(0);
  });
});

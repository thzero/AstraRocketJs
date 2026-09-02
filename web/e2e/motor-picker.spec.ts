import { test, expect, type Page } from '@playwright/test';

/**
 * Motor-picker behavioral suite. Every flow here runs against the default
 * single-mount rocket (seated C6) and asserts on DOM/behaviour, not pixels, so
 * a styling tweak won't break it. All motor data is bundled, so these run fully
 * offline — no thrustcurve.org round-trips.
 *
 * The multi-mount "one card per motor tube" path (findMounts + setExtraMotor) is
 * covered by unit tests (treeEdit.test.ts, store); building a two-mount rocket
 * through the component-tree UI would be brittle here, so it's intentionally not
 * re-exercised end-to-end.
 *
 * Selector notes: the picker's Select button only mounts once a row is
 * highlighted (before that the right pane shows the "pick a motor" hint), so its
 * absence is itself a meaningful assertion. The diameter range is two native
 * <input type=range> thumbs whose values ARE the slider indices — asserting on
 * `toHaveValue` is unambiguous where the "…mm" readout text collides with row
 * diameters.
 */

// Fresh Playwright contexts start with empty storage, so the pre-1.0 "work in
// progress" modal blocks the UI on every test until acknowledged.
async function dismissWip(page: Page) {
  await page.getByRole('button', { name: 'I understand' }).click({ timeout: 10_000 }).catch(() => {});
}

async function openPicker(page: Page) {
  await page.getByRole('button', { name: /change/i }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await dismissWip(page);
});

test('opens with the seated motor already selected', async ({ page }) => {
  const dialog = await openPicker(page);

  // The default rocket carries a C6, so the picker opens with it highlighted and
  // its detail (not the "pick a motor" hint) showing.
  const seeded = dialog.locator('ul li button[aria-pressed="true"]');
  await expect(seeded).toHaveCount(1);
  await expect(seeded).toContainText('C6');
  await expect(dialog.getByRole('button', { name: 'Select', exact: true })).toBeVisible();
  await expect(dialog.getByText(/Select a motor to see/i)).toHaveCount(0);
});

test('select-then-confirm applies the chosen motor and closes the dialog', async ({ page }) => {
  const dialog = await openPicker(page);
  const select = dialog.getByRole('button', { name: 'Select', exact: true });

  // Changing the filter drops the pre-selection, so nothing is applied yet and
  // the Select button is gone until a new row is highlighted.
  await dialog.getByPlaceholder(/Search by code/i).fill('A8');
  await expect(select).toHaveCount(0);

  const row = dialog.locator('ul li button[aria-pressed]').first();
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  const designation = (await row.locator('.font-medium').first().innerText()).trim();

  // Now the Select button exists and is enabled; clicking it applies + closes.
  await expect(select).toBeEnabled();
  await select.click();
  await expect(dialog).toBeHidden();

  // The motor card reflects the newly seated motor.
  await expect(page.getByText(designation, { exact: false }).first()).toBeVisible();
});

test('predetermined delays show as chips and any motor can be flown plugged', async ({ page }) => {
  const dialog = await openPicker(page);

  await dialog.getByPlaceholder(/Search by code/i).fill('C6');
  await dialog.locator('ul li button[aria-pressed]').first().click();

  // The C6 exposes its own delay charges as quick chips, plus a Plugged option.
  const plugged = dialog.getByRole('button', { name: 'plugged', exact: true });
  await expect(plugged).toBeVisible();
  await expect(dialog.getByRole('button', { name: '5', exact: true })).toBeVisible();

  await plugged.click();
  await dialog.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(dialog).toBeHidden();

  // A plugged motor shows "plugged" in place of a delay time on the card.
  await expect(page.getByText('plugged', { exact: false }).first()).toBeVisible();
});

test('diameter range defaults to the mount fit and persists across reloads', async ({ page }) => {
  let dialog = await openPicker(page);
  const maxThumb = dialog.getByLabel('Diameter max');

  // Default rocket's 18 mm mount → the top thumb sits on the 18 mm stop (index 2).
  await expect(maxThumb).toHaveValue('2');

  // Widen the ceiling one stop (→ 24 mm, index 3) via the keyboard.
  await maxThumb.focus();
  await maxThumb.press('ArrowRight');
  await expect(maxThumb).toHaveValue('3');

  await page.reload();
  await dismissWip(page);
  dialog = await openPicker(page);
  await expect(dialog.getByLabel('Diameter max')).toHaveValue('3');
});

test('the manufacturer selection persists across reloads', async ({ page }) => {
  let dialog = await openPicker(page);
  const summary = dialog.locator('summary');
  await expect(summary).toHaveText(/All manufacturers/i);

  // Open the manufacturer dropdown and tick the first one; the summary collapses
  // to that single name.
  await summary.click();
  const firstMfr = dialog.getByRole('checkbox').first();
  const name = (await firstMfr.evaluate((el) => el.closest('label')?.textContent?.trim() ?? '')) as string;
  await firstMfr.check();
  await expect(summary).toHaveText(name);

  await page.reload();
  await dismissWip(page);
  dialog = await openPicker(page);
  await expect(dialog.locator('summary')).toHaveText(name);
});

test('the motor card exposes an ignition event that persists across reloads', async ({ page }) => {
  const ignition = page.getByLabel('Ignition', { exact: true });
  await expect(ignition).toBeVisible();
  await expect(ignition).toHaveValue('automatic'); // default: at launch

  // The default rocket is single-stage, so only the events that can actually
  // fire are offered: automatic + launch. The sustainer triggers and "never"
  // (which would strand it on the pad) are hidden.
  await expect(ignition.locator('option')).toHaveCount(2);
  await expect(ignition.locator('option[value="burnout"]')).toHaveCount(0);
  await expect(ignition.locator('option[value="ejectioncharge"]')).toHaveCount(0);
  await expect(ignition.locator('option[value="never"]')).toHaveCount(0);

  await ignition.selectOption('launch');
  await expect(page.getByLabel('Ignition delay (s)')).toBeVisible();

  // The setting rides on the simulation, so the workspace autosave restores it.
  await page.waitForTimeout(700);
  await page.reload();
  await dismissWip(page);
  await expect(page.getByLabel('Ignition', { exact: true })).toHaveValue('launch');
});

test('a launch-delayed primary ignition still simulates end-to-end', async ({ page }) => {
  // Exercises the primaryIgnition path through the sim worker + engine.
  await page.getByLabel('Ignition', { exact: true }).selectOption('launch');
  await page.getByLabel('Ignition delay (s)').fill('3');

  await page.getByRole('button', { name: /run flight simulation/i }).click();
  await expect(page.getByRole('button', { name: 'Flight', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('not run')).toHaveCount(0);
});

test('the motor card opens a read-only thrust-curve popup', async ({ page }) => {
  // The seated C6 gives the card its 📈 thrust-curve button.
  await page.getByRole('button', { name: 'Thrust curve' }).first().click();

  const popup = page.getByRole('dialog');
  await expect(popup).toBeVisible();
  await expect(popup.getByText('C6', { exact: false }).first()).toBeVisible();
  // It renders the curve as an SVG, not the picker's list.
  await expect(popup.locator('svg').first()).toBeVisible();
});

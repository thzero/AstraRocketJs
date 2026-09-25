import { test, expect, type Page, autosaved, openTab, runFlight } from './base';

/**
 * Motor-picker behavioral suite. Every flow here runs against the default
 * single-mount rocket (seated C6) and asserts on DOM/behavior, not pixels, so
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

async function openPicker(page: Page) {
  // The motor cards live on the Simulations tab (one per mount), not beside the
  // design any more.
  await openTab(page, 'Simulations');
  await page
    .getByRole('button', { name: /change/i })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Every flow here drives a motor card, and those live on the Simulations tab.
  await openTab(page, 'Simulations');
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

  // The filter hides the pre-selected C6 (no A8 row is it), and a motor that
  // is not on screen cannot be confirmed: the Select button goes with the row
  // until a visible one is highlighted. Deterministic whether or not the
  // catalog had seeded the C6 before the filter was typed, which is the race
  // that made this flaky under CI.
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

  // The motor card reflects the newly seated motor. Scoped to the card: the 2D
  // schematic letters the same designation onto the motor it draws, and that
  // drawing is a tab away now.
  await expect(page.getByRole('region', { name: /Motor/ }).first().getByText(designation)).toBeVisible();
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

test('"fits the mount" pulls the diameter ceiling down to the mount, and gives it back', async ({ page }) => {
  const dialog = await openPicker(page);
  const maxThumb = dialog.getByLabel('Diameter max');
  const fits = dialog.getByRole('checkbox', { name: /Fits the mount/ });

  // On by default, and naming the bore it measures against. A measurement, not
  // a hardcoded 18: the default mount's BORE is its 18 mm outer size less two
  // walls, and what matters is that the filter names what it judges against.
  await expect(fits).toBeChecked();
  await expect(dialog.getByText(/Fits the mount \(\d+(\.\d+)? mm\)/)).toBeVisible();

  /*
   * The restriction is VISIBLE on the slider. Two earlier designs hid it: one
   * seeded the ceiling from the mount on first open and then saved it as though
   * the user had chosen it, so a range picked for an 18 mm mount followed them
   * to a 54 mm one; the other capped the slider's TRACK while the box was
   * ticked, and since the readout calls a thumb at the end of its track "Any",
   * that made the box read "Any-Any" ticked and "Any-18 mm" clear - the exact
   * opposite of what it says.
   */
  await expect(maxThumb).toHaveValue('2'); // STD_DIAMS [6, 13, 18, …] → 18 mm
  await expect(dialog.getByText(/Any–18\.0 mm/)).toBeVisible();
  // The whole track is still there to drag along.
  await expect(maxThumb).toHaveAttribute('max', '9');

  await fits.uncheck();
  await expect(maxThumb).toHaveValue('9');
  await expect(dialog.getByText(/Any–Any/)).toBeVisible();

  await fits.check();
  await expect(maxThumb).toHaveValue('2');
  await expect(dialog.getByText(/Any–18\.0 mm/)).toBeVisible();

  // Dragging the ceiling past what the mount takes is asking to see past the
  // mount, so the box lets go rather than sitting there ticked and ignored.
  await maxThumb.focus();
  await maxThumb.press('ArrowRight');
  await expect(maxThumb).toHaveValue('3');
  await expect(fits).not.toBeChecked();
});

test('the diameter range persists across reloads', async ({ page }) => {
  let dialog = await openPicker(page);
  // The fit box starts ticked, so the ceiling starts on the mount's stop (2).
  // Narrow it one more, to 13 mm, which is the user's own choice and so the one
  // that gets remembered - the mount's cap never is.
  const maxThumb = dialog.getByLabel('Diameter max');
  await maxThumb.focus();
  await maxThumb.press('ArrowLeft');
  await expect(maxThumb).toHaveValue('1');

  await page.reload();
  dialog = await openPicker(page);
  await expect(dialog.getByLabel('Diameter max')).toHaveValue('1');
});

test('the picker filters by total impulse', async ({ page }) => {
  const dialog = await openPicker(page);
  // The default rocket's 18 mm mount, so the list is 18 mm motors: A through D.
  // Waited for, not just counted: the catalog is a ~1.6 MB fetch and `count()`
  // does not retry, so an immediate count is only ever the empty loading list.
  const rows = dialog.locator('ul li button[aria-pressed]');
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();
  expect(before).toBeGreaterThan(1);

  // A floor no small motor clears. It is the question a class chip cannot ask:
  // a class is a doubling bucket, so this lands between two letters.
  await dialog.getByLabel('Total impulse min').fill('15');
  await expect(rows).not.toHaveCount(before);
  expect(await rows.count()).toBeGreaterThan(0);

  // Past every 18 mm motor in the catalog: the list says so, and names the fit
  // filter as the other reason a list can come up short.
  await dialog.getByLabel('Total impulse min').fill('100000');
  await expect(dialog.getByText('No matching motors.')).toBeVisible();
  await expect(dialog.getByText(/Only motors that go in this mount/)).toBeVisible();
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

  // The setting rides on the simulation, so the workspace autosave restores it
  // — once it has actually been written, which is what this waits for.
  await autosaved(page, '"ignitionEvent":"launch"');
  await page.reload();
  await openTab(page, 'Simulations'); // a reload lands on Design
  await expect(page.getByLabel('Ignition', { exact: true })).toHaveValue('launch');
});

test('a launch-delayed primary ignition still simulates end-to-end', async ({ page }) => {
  // Exercises the primaryIgnition path through the sim worker + engine.
  await page.getByLabel('Ignition', { exact: true }).selectOption('launch');
  await page.getByLabel('Ignition delay (s)').fill('3');

  await runFlight(page);
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

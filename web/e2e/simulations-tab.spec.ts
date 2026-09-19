import { test, expect, autosaved, openTab, runButton, runFlight } from './base';

/**
 * The Simulations tab: a table of runs over the shared design, with the selected
 * one's editor beside it.
 *
 * The behavior worth pinning is what a design edit does to a result. It used to
 * DELETE every cached result, which is why the Results tab came and went on each
 * keystroke and why you could never compare a change against the run before it.
 * OpenRocket keeps the numbers and flags them, and so do we.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('an edited design ages the results instead of destroying them', async ({ page }) => {
  await runFlight(page);
  await openTab(page, 'Simulations');

  const row = page.getByRole('row').filter({ hasText: 'Simulation 1' });
  await expect(row).toContainText('Up to date');
  const apogee = (await row.textContent())!;

  // Change the airframe. The result now describes a rocket that no longer
  // exists — but it is still the last thing this design flew, so it stays.
  await openTab(page, 'Design');
  await page.locator('div[title="Body tube"]').click();
  await page.getByLabel('Length', { exact: true }).first().fill('45');
  await openTab(page, 'Simulations');

  await expect(row).toContainText('Outdated');
  expect(await row.textContent()).toBe(apogee.replace('Up to date', 'Outdated'));

  // And the Results tab is still there, still holding the flight. It used to
  // disappear the moment the edit landed.
  await expect(
    page.getByRole('navigation', { name: 'Workbench' }).getByRole('button', { name: 'Results' }),
  ).toBeVisible();

  // Re-running makes it current again. (`runFlight` waits for the result rather
  // than reading the row back while it still says "Running".)
  await runFlight(page);
  await openTab(page, 'Simulations');
  await expect(row).toContainText('Up to date');
});

test('a second simulation is its own row, with its own motor', async ({ page }) => {
  await openTab(page, 'Simulations');
  await page.getByRole('button', { name: 'Duplicate simulation' }).click();

  const rows = page.getByRole('row').filter({ hasText: /Simulation/ });
  await expect(rows).toHaveCount(2);

  // The copy is selected, so the editor beside the table is editing IT — the
  // point of the split, since the old accordion could show the list or the
  // configuration but never both.
  await expect(page.getByRole('textbox', { name: 'Rename simulation' })).toHaveValue('Simulation 1 copy');

  // Running affects only the selected row.
  await runFlight(page);
  await openTab(page, 'Simulations');
  // By position: "Simulation 1" is a substring of "Simulation 1 copy", and a
  // row's text is every cell run together, so neither name can be matched by
  // text alone. The copy is inserted directly after its original.
  await expect(rows.nth(0)).toContainText('not run');
  await expect(rows.nth(1)).toContainText('Up to date');
});

test('a per-simulation option overrides the global one', async ({ page }) => {
  await openTab(page, 'Simulations');

  // Empty means "follow the global value", which is the placeholder — so the
  // field reads as the number that will actually be used.
  //
  // By ROLE: the editor pairs the number box with a range slider carrying the
  // same label, so `getByLabel` alone matches two controls and fails strict mode.
  const step = page.getByRole('spinbutton', { name: 'Time step' });
  await expect(step).toHaveValue('');
  await expect(step).toHaveAttribute('placeholder', '0.05');

  await step.fill('0.01');
  await runFlight(page);

  // It rides on the simulation, so the workspace autosave restores it.
  await openTab(page, 'Simulations');
  await expect(step).toHaveValue('0.01');
});

test('the run button flies the ticked rows, and says how many', async ({ page }) => {
  await openTab(page, 'Simulations');
  await page.getByRole('button', { name: 'Duplicate simulation' }).click();

  // Nothing ticked: Run means the active simulation, singular.
  const run = runButton(page);
  await expect(run).toHaveText('Run flight simulation');

  // Tick both. The label counts them, because "Run flight simulation" over a
  // batch of two is a lie about what the click does.
  await page.getByRole('checkbox', { name: 'Select all simulations' }).check();
  await expect(run).toHaveText('Run 2 simulations');

  await run.click();
  // Running lands on Results, so come back to read the rows.
  await expect(page.getByRole('button', { name: /Choose which flight/ })).toBeVisible({ timeout: 30_000 });
  await openTab(page, 'Simulations');
  const rows = page.getByRole('row').filter({ hasText: /Simulation/ });
  await expect(rows.nth(0)).toContainText('Up to date');
  await expect(rows.nth(1)).toContainText('Up to date');
});

test('ticking a row to fly it does not move the editor to it', async ({ page }) => {
  await openTab(page, 'Simulations');
  await page.getByRole('button', { name: 'Duplicate simulation' }).click();
  // The copy is active, so the editor is on it.
  const name = page.getByRole('textbox', { name: 'Rename simulation' });
  await expect(name).toHaveValue('Simulation 1 copy');

  // Tick the OTHER row: a tick says "fly this", not "edit this". `exact`,
  // because "Select Simulation 1" is a substring of "Select Simulation 1 copy".
  await page.getByRole('checkbox', { name: 'Select Simulation 1', exact: true }).check();
  await expect(name).toHaveValue('Simulation 1 copy');
  await expect(runButton(page)).toHaveText('Run flight simulation');
});

test('the results header names the simulation it is showing', async ({ page }) => {
  await openTab(page, 'Simulations');
  await page.getByRole('textbox', { name: 'Rename simulation' }).fill('D12 sustainer');
  await runFlight(page); // lands on Results

  // A design view is about the one rocket on screen; a RESULT belongs to a named
  // simulation, and with several of them the charts are otherwise unattributed.
  const header = page.getByRole('heading', { name: 'D12 sustainer' });
  await expect(header).toBeVisible();

  // Results now survive a design edit, so the header has to say when the numbers
  // no longer describe the rocket.
  await expect(page.getByText('Outdated', { exact: true })).toHaveCount(0);
  await openTab(page, 'Design');
  await page.locator('div[title="Body tube"]').first().click();
  await page.getByLabel('Length', { exact: true }).fill('45');
  await openTab(page, 'Results');
  await expect(header).toBeVisible();
  await expect(page.getByText('Outdated', { exact: true }).first()).toBeVisible();
});

test('a flown row opens its own results', async ({ page }) => {
  await openTab(page, 'Simulations');
  await page.getByRole('button', { name: 'Duplicate simulation' }).click();
  await page.getByRole('textbox', { name: 'Rename simulation' }).fill('Second');

  // Nothing has flown, so there is nothing to open.
  await expect(page.getByRole('button', { name: /^View results/ })).toHaveCount(0);

  // Fly both, then come back: running lands on Results, and the per-row way in
  // is still how you open a row other than the one being shown.
  await page.getByRole('checkbox', { name: 'Select all simulations' }).check();
  await runButton(page).click();
  await expect(page.getByRole('button', { name: /Choose which flight/ })).toBeVisible({ timeout: 30_000 });
  await openTab(page, 'Simulations');
  await expect(page.getByRole('button', { name: /^View results/ })).toHaveCount(2);

  // Open the SECOND row's flight: it becomes the active simulation AND what the
  // results views show. Two simulations flew, so the heading is the picker, and
  // its visible text is the flight being shown.
  await page.getByRole('button', { name: 'View results for Second' }).click();
  await expect(page.getByRole('button', { name: /Choose which flight/ })).toHaveText(/^Second/);
});

test('a flight warning reads above the numbers it qualifies', async ({ page }) => {
  await openTab(page, 'Simulations');
  // Drop this simulation's deploy-speed threshold below anything a real
  // deployment can manage, so the kernel is certain to flag it. (A small chute
  // is not enough: deployment happens at apogee, where the speed is near zero.)
  await page.getByLabel('Deploy-speed warning above', { exact: true }).fill('0.01');
  await runFlight(page);

  // Scoped to the Results column: the phone's copy of this block is mounted too,
  // and a display:none element has no box to measure.
  const column = page.getByRole('region', { name: 'Results' });
  const warnings = column.getByText(/Flight warnings/);
  await expect(warnings).toBeVisible();

  // Above the measurements: a warning changes how you read them.
  const warnTop = (await warnings.boundingBox())!.y;
  const statTop = (await column.getByText('Rod exit').first().boundingBox())!.y;
  expect(warnTop).toBeLessThan(statTop);
});

test('a flight survives a reload', async ({ page }) => {
  await openTab(page, 'Simulations');
  await page.getByRole('textbox', { name: 'Rename simulation' }).fill('Kept');
  await runFlight(page);

  const row = page.getByRole('row').filter({ hasText: 'Kept' });
  await openTab(page, 'Simulations');
  const before = (await row.textContent())!;
  expect(before).toContain('Up to date');

  // The flights live under their own IndexedDB key, written once the run lands.
  await autosaved(page, '"maxAltitude"');
  await page.reload();
  await openTab(page, 'Simulations');

  // Same numbers, still current — not "not run", which is what a reload used to
  // give you because the results were never written at all.
  await expect(row).toContainText('Up to date');
  expect(await row.textContent()).toBe(before);

  // And the charts are there to open, without re-running.
  await page.getByRole('button', { name: 'View results for Kept' }).click();
  await expect(page.getByRole('heading', { name: 'Kept' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Flight', exact: true })).toBeVisible();
});

test('launch conditions stop at the NAR/Tripoli limits', async ({ page }) => {
  await openTab(page, 'Simulations');

  // Launcher within 20 degrees of vertical.
  const angle = page.getByLabel('Angle', { exact: true });
  await angle.fill('45');
  await angle.blur();
  expect(Number(await angle.inputValue())).toBeCloseTo(20, 6);

  // No flying in winds above 20 mph. Metric by default, so 8.94 m/s.
  const wind = page.getByLabel('Speed', { exact: true });
  await wind.fill('50');
  await wind.blur();
  expect(Number(await wind.inputValue())).toBeCloseTo(8.9408, 3);

  // A value inside the limits is untouched.
  await angle.fill('7');
  await angle.blur();
  expect(Number(await angle.inputValue())).toBeCloseTo(7, 6);
});

test('Run outdated flies only the rows that are not current', async ({ page }) => {
  await runFlight(page);
  await openTab(page, 'Simulations');
  await expect(page.getByRole('row').filter({ hasText: 'Simulation 1' })).toContainText('Up to date');

  // A second simulation that has never flown. The button counts what it will
  // do, so it says one even though there are two rows.
  await page.getByRole('button', { name: '＋ New' }).click();
  const outdated = page.getByRole('button', { name: /^Run outdated/ });
  await expect(outdated).toHaveText('Run outdated (1)');

  await outdated.click();
  // Running lands on Results; come back to read the toolbar.
  await expect(page.getByRole('button', { name: 'Flight', exact: true })).toBeVisible({ timeout: 30_000 });
  await openTab(page, 'Simulations');
  await expect(outdated).toHaveText('Run outdated (0)');
  // Both current now, and the first was never re-flown to get there.
  await expect(outdated).toBeDisabled();
  const rows = page.getByRole('row').filter({ hasText: /Simulation/ });
  await expect(rows.nth(0)).toContainText('Up to date');
  await expect(rows.nth(1)).toContainText('Up to date');
});

test('a run leaves the design editor unblocked', async ({ page }) => {
  await openTab(page, 'Simulations');
  await page.getByRole('button', { name: 'Duplicate simulation' }).click();
  await page.getByRole('checkbox', { name: 'Select all simulations' }).check();
  await runButton(page).click();
  await expect(page.getByRole('button', { name: 'Flight', exact: true })).toBeVisible({ timeout: 30_000 });

  // The design editors used to be covered by a full-pane overlay while a run was
  // in flight. That overlay is gone entirely - an edit during a run costs the
  // run instead, since `runSims` discards any answer flown against a tree or a
  // simulation that has since changed. That half is pinned in
  // `state/batchParallel.test.ts`, which holds the sim call open by hand rather
  // than racing the real engine; this checks the editor is left usable.
  await openTab(page, 'Design');
  await page.locator('div[title="Body tube"]').click();
  const length = page.getByLabel('Length', { exact: true }).first();
  await expect(length).toBeEditable();
  await length.fill('42');
  await expect(length).toHaveValue('42');
});

test('a simulation stays editable while it flies', async ({ page }) => {
  await openTab(page, 'Simulations');
  // A batch rather than one flight, so the pool is still busy while the edit is
  // typed. A single sim can finish inside the same tick on a fast machine, and
  // a test that races the engine is a test that fails for the wrong reason.
  await page.getByRole('button', { name: 'Duplicate simulation' }).click();
  await page.getByRole('checkbox', { name: 'Select all simulations' }).check();
  await runButton(page).click();

  // The editor used to be covered by an overlay for the whole run, so none of
  // this was reachable until the flight finished.
  const angle = page.getByRole('spinbutton', { name: 'Angle', exact: true });
  await expect(angle).toBeEditable();
  await angle.fill('12');
  await expect(angle).toHaveValue('12');

  // What happens to the ANSWER of a run whose inputs changed underneath it is
  // pinned in `state/batchParallel.test.ts`, where the sim call is held open by
  // hand: it is dropped rather than installed over the edit. Racing the real
  // engine for that here would only make this flaky.
});

test('the results picker chooses which flight every results view shows', async ({ page }) => {
  await openTab(page, 'Simulations');
  await page.getByRole('button', { name: 'Duplicate simulation' }).click();
  await page.getByRole('textbox', { name: 'Rename simulation' }).fill('D12');
  await page.getByRole('checkbox', { name: 'Select all simulations' }).check();
  await runButton(page).click();

  // Running lands on Results by itself. The picker IS the pane heading — a title
  // naming the flight plus a dropdown showing the same name beside it said one
  // thing twice — and it appears because THIS run flew two simulations.
  const picker = page.getByRole('button', { name: /Choose which flight/ });
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await expect(picker).toHaveText(/^D12/); // the active row, until told otherwise

  // Switching shows the other flight, and closes the menu: one at a time.
  await picker.click();
  await page.getByRole('menuitemradio', { name: 'Simulation 1' }).click();
  await expect(picker).toHaveText(/^Simulation 1/);
  await expect(page.getByRole('menu')).toHaveCount(0);

  // The same choice governs the ground track, not just the charts. Scoped to the
  // view's own wrapper: the names also appear in the table behind it.
  await page.getByRole('button', { name: 'Ground track', exact: true }).click();
  const track = page.getByRole('img', { name: /north up/ }).locator('..');
  await expect(track.getByText('Stage 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Choose which flight/ })).toHaveText(/^Simulation 1/);
});

test('one flown simulation gets a plain heading, not a picker', async ({ page }) => {
  await runFlight(page); // lands on Results
  // Nothing to choose between, so the heading is just a heading.
  await expect(page.getByRole('heading', { name: 'Simulation 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Choose which flight/ })).toHaveCount(0);
});

test('the chart panels you pick are still there after a reload', async ({ page }) => {
  await runFlight(page); // lands on Results

  const thrust = page.getByRole('button', { name: 'Thrust', exact: true });
  await expect(thrust).toHaveAttribute('aria-pressed', 'false');
  await thrust.click();
  await expect(thrust).toHaveAttribute('aria-pressed', 'true');

  // Which panels you read is a working habit, not a property of one flight, so
  // it is a preference rather than component state.
  //
  // Wait for the flight to reach IndexedDB first: the Results tab only exists
  // while there is a result to show, so reloading before the write lands leaves
  // nowhere to check (the same reason `a flight survives a reload` waits here).
  await autosaved(page, '"maxAltitude"');
  await page.reload();
  await openTab(page, 'Results');
  await expect(page.getByRole('button', { name: 'Thrust', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('the ground track shows where the flight lands, and how far', async ({ page }) => {
  await openTab(page, 'Simulations');
  // Wind, so there is a drift worth drawing: straight up in still air lands on
  // the pad and the track is a dot.
  await page.getByRole('spinbutton', { name: 'Speed', exact: true }).fill('4');
  await runFlight(page); // lands on Results

  await page.getByRole('button', { name: 'Ground track', exact: true }).click();
  const plan = page.getByRole('img', { name: /north up, pad at the center/ });
  await expect(plan).toBeVisible();

  // The readout under the drawing is the pair you act on: how far to walk, and
  // which way. Both must be real numbers rather than the empty-track message.
  await expect(page.getByText(/\d+(\.\d+)?\s*(m|ft)\s*·\s*\d+°/)).toBeVisible();
  await expect(page.getByText('This flight has no horizontal track to draw.')).toHaveCount(0);
});

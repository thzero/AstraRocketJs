import { test, expect, openTab, runButton } from './base';

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
  const run = runButton(page);
  await expect(run).toBeDisabled();
  // Names the row and gives BOTH reasons with the rule behind each, rather than
  // a bare "cannot run". The regex used to look for wording this path never
  // produced, and the assertion was masked by a different refusal entirely:
  // every centering ring in the file imported with no radius, so the design was
  // rejected for a zero dimension before the launch check was ever reached.
  const notice = page.getByText(/was not run .* launch conditions are outside the safety codes/);
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('above the 20° the NAR and Tripoli safety codes allow');
  await expect(notice).toContainText('above the 20 mph the NAR and Tripoli safety codes allow');

  // Bring both back inside and it flies. The fields clamp, so typing anything
  // over the cap lands exactly on it.
  await page.getByLabel('Angle', { exact: true }).fill('5');
  await page.getByLabel('Speed', { exact: true }).fill('3');
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page.getByRole('button', { name: 'Flight', exact: true })).toBeVisible({ timeout: 30_000 });
});

test('the import notes fold away, and the name is not repeated', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.setInputFiles('input[type=file]', 'e2e/fixtures/out-of-limits.ork');
  await expect(page.getByText('Booster').first()).toBeVisible({ timeout: 20_000 });

  // The notes are open on the import that raised them.
  const note = page.getByText(/Launch rod angle is 35/);
  await expect(note).toBeVisible();

  // And fold away without dismissing the banner, which is the only record of them.
  const toggle = page.getByRole('button', { name: /import note/ });
  await toggle.click();
  await expect(note).toHaveCount(0);
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(note).toBeVisible();

  // The design name lives HERE now, with the ✎ that opens its configuration,
  // and no longer in the component tree's header as well.
  const card = toggle.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
  const title = card.getByRole('button', { name: 'Edit rocket configuration' });
  await expect(title).toBeVisible();
  await expect(title).toContainText('Two Stage');
  // And exactly once on the page: the component tree's header no longer repeats it.
  await expect(page.getByRole('button', { name: 'Edit rocket configuration' })).toHaveCount(1);
});

test('folded notes are remembered, across a reload and across designs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.setInputFiles('input[type=file]', 'e2e/fixtures/out-of-limits.ork');
  await expect(page.getByText('Booster').first()).toBeVisible({ timeout: 20_000 });

  const note = page.getByText(/Launch rod angle is 35/);
  const toggle = page.getByRole('button', { name: /import note/ });
  await expect(note).toBeVisible();
  await toggle.click();
  await expect(note).toHaveCount(0);

  // Folded is a PREFERENCE, so it outlives the card. It was local state, which
  // the card drops every time it unmounts - and it unmounts on every tab change,
  // every Close and every reload, so the fold had to be repeated forever.
  //
  // Asserted by importing AGAIN rather than by leaning on the reloaded design:
  // a fresh import is the case that matters (the notes must not spring open for
  // the next file either, which is what "not per rocket" means), and it does not
  // depend on the autosave debounce having beaten the reload.
  await page.reload();
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.setInputFiles('input[type=file]', 'e2e/fixtures/out-of-limits.ork');
  await expect(page.getByText('Booster').first()).toBeVisible({ timeout: 20_000 });

  await expect(toggle).toBeVisible();
  await expect(note).toHaveCount(0);

  // Still a toggle, not a one-way door.
  await toggle.click();
  await expect(note).toBeVisible();
});

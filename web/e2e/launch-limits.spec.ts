import { test, expect, openTab, ready, runButton, runFlight, importOrk } from './base';

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
  await importOrk(page, 'e2e/fixtures/out-of-limits.ork');

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
  await importOrk(page, 'e2e/fixtures/out-of-limits.ork');

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
  await importOrk(page, 'e2e/fixtures/out-of-limits.ork');

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
  // The first import is saved by now (debounce or unload journal), so the same
  // file's name clashes with it; overwrite, which keeps this about the notes.
  await importOrk(page, 'e2e/fixtures/out-of-limits.ork', 'overwrite');

  await expect(toggle).toBeVisible();
  await expect(note).toHaveCount(0);

  // Still a toggle, not a one-way door.
  await toggle.click();
  await expect(note).toBeVisible();
});

/**
 * The "Before you fly" card under the run's numbers.
 *
 * Every other safety behavior in this file is a REFUSAL: conditions outside the
 * codes, and no flight. This is the other half, and the one that applies to
 * every flight that does happen - the numbers are real and the launch is legal,
 * and they are still a model's answer rather than a flight card. It has to sit
 * with the measurements, because the moment it matters is the moment they are
 * being read.
 */
test('the run summary carries a safety card linking to the docs', async ({ page }) => {
  await ready(page);
  await runFlight(page);

  // The desktop right column and the phone's Results tab each mount a copy of
  // the summary, so one of the two is always in the document but hidden.
  const card = page.getByRole('region', { name: 'Before you fly' }).filter({ visible: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText('not a flight card');

  // The gaps are NAMED. "Results are approximate" tells a reader nothing they
  // can act on; "fin flutter" sends them to look at their fin attachment.
  await expect(card).toContainText("RSO's call");

  await expect(card.getByRole('listitem').filter({ hasText: 'Not modeled at all' })).toContainText('Fin flutter');

  // The whole card is a WARNING, not a note: it carries the shared amber tone
  // and the ⚠ glyph, because the failures it lists are the ones no number above
  // will ever mention. Pinned on both, since the glyph is the half that still
  // works for a reader who cannot use the color.
  await expect(card).toHaveClass(/amber/);
  await expect(card).toContainText('⚠');

  // BELOW the tiles, not above them: a caveat read before the numbers exist is
  // a caveat about nothing.
  const tiles = page.locator('section[aria-label="Simulation results"]').filter({ visible: true });
  const cardBox = (await card.boundingBox())!;
  const tileBox = (await tiles.boundingBox())!;
  expect(cardBox.y).toBeGreaterThanOrEqual(tileBox.y + tileBox.height);

  /**
   * And it still takes you to the safety notes - now in the in-app Help rather
   * than a new tab.
   *
   * This asserted an `<a href>` with `target="_blank"` until Help moved inside
   * the app (SimSummary.tsx calls `openHelp('safety')` and the control is a
   * button, which has no link role and no href), so it could not pass on any
   * machine. What the card has to do is still the same; only the way it does it
   * changed.
   *
   * The destination is checked wherever the dialog puts it, because the docs
   * are NOT built on a PR (see e2e/help-dialog.spec.ts): with them the frame is
   * pointed at the page, and without them the dialog offers the very same page
   * on the docs site. Either one names the slug, and neither needs the build.
   */
  await card.getByRole('button', { name: /Read the safety notes/ }).click();
  const help = page.getByRole('dialog', { name: 'Help' });
  await expect(help).toBeVisible();
  await expect(help.locator('iframe[src*="/safety/"], a[href*="/safety"]').first()).toBeAttached();
});

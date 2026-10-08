import { test, expect, openTab, ready, runFlight } from './base';

/**
 * The Rocket-configuration dialog edits `name`, `designer`, `comments`,
 * `revision` and `designType`: all round-tripped to the `.ork`, none of them
 * physics.
 *
 * The store replaces the whole tree object for these edits, so neither the engine
 * rebuild nor the result-invalidation may key on the tree's object identity: typing
 * a designer name would run a full engine rebuild + aero sweep and throw away every
 * simulation result.
 */
/**
 * And it is reachable only where the component tree is. Naming a design, its
 * designer and its revision history is something you do to a design you are
 * building; where parts cannot be added the banner shows the name as a title
 * with no ✎, rather than a control that opens a dialog onto a design this
 * window cannot otherwise change.
 */
test('the name is a control only where a design can be built', async ({ page }) => {
  await ready(page);
  const edit = page.getByRole('button', { name: 'Edit rocket configuration' });
  await expect(edit).toBeVisible();
  // Whatever this design is called; the point is that the line survives losing
  // its control, not what the default design happens to be named.
  const title = ((await edit.textContent()) ?? '').replace('✎', '').trim();
  expect(title).not.toBe('');

  // Maximized: the side columns step aside, the tree with them.
  await page.getByRole('button', { name: /whole window/ }).click();
  await expect(edit).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(edit).toBeVisible();

  // A phone. The banner is on the Rocket half, and the name is still there,
  // just not a button: it titles the pane.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Rocket/ }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});

test('editing the design metadata keeps the flight results', async ({ page }) => {
  await page.goto('/');

  await runFlight(page);
  // The Flight view only exists once a result does.
  const flight = page.getByRole('button', { name: 'Flight', exact: true });

  // Pin the actual number, so a silently re-run simulation would still be caught
  // if it landed on a different value.
  const apogeeTile = page.locator('text=Apogee').first().locator('..');
  const apogee = (await apogeeTile.textContent())?.trim();
  expect(apogee).toBeTruthy();

  // The metadata dialog is launched from the component tree, a tab away.
  await openTab(page, 'Design');
  await page.getByRole('button', { name: 'Edit rocket configuration' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rocket configuration' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Designer' }).fill('Ada Lovelace');
  await dialog.getByRole('textbox', { name: 'Revision history' }).fill('rev 2');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();

  // The result is still there, and still the same result.
  await openTab(page, 'Results');
  await expect(flight).toBeVisible();
  expect((await apogeeTile.textContent())?.trim()).toBe(apogee);
});

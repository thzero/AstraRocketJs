import { test, expect, ready } from './base';

/**
 * The user's own parts library: save the component you built, pick it again
 * from the same dialog that offers the manufacturer catalog, delete it when
 * you are done with it.
 *
 * Driven end to end rather than unit-tested alone because the three pieces
 * live in three places (the store in presetStore, the projection to a picker
 * row in customParts, and the picker itself), and the interesting failure is a
 * save that lands in storage and never appears in the list.
 */

const PART = 'My 29mm airframe';

/** The save dialog, filled in and submitted for the selected component. */
async function saveSelectedAs(page: import('./base').Page, name: string) {
  await page.getByRole('button', { name: 'Save as part' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as a reusable part' });
  await dialog.getByLabel('Part name').fill(name);
  await dialog.getByLabel('Maker').fill('Bench');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Answer the confirmation a delete raises. */
async function confirmDelete(page: import('./base').Page) {
  const ask = page.getByRole('alertdialog');
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: /Delete|Confirm/ }).click();
  await expect(ask).toBeHidden();
}

/** Open the My Parts library from the menu. */
async function openMyParts(page: import('./base').Page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'My Parts' }).click();
  await expect(page.getByRole('dialog', { name: 'My Parts' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await ready(page);
});

/**
 * The library goes where the component tree goes.
 *
 * A saved part is applied through a component, so a window that cannot add the
 * component it belongs on would open the library onto a design it has no way to
 * put anything into. The catalog picker inside the property editor is a
 * different thing and stays: it re-sizes a part the design already has.
 */
test('My Parts is offered only where a design can be built', async ({ page }) => {
  const entry = page.getByRole('menuitem', { name: 'My Parts' });
  const menu = page.getByRole('button', { name: 'Menu' });

  await menu.click();
  await expect(entry).toBeVisible();
  await page.keyboard.press('Escape');

  // Maximized: the tree steps aside to give the drawing the window.
  await page.getByRole('button', { name: /whole window/ }).click();
  await menu.click();
  await expect(entry).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape'); // and out of maximize

  // A phone, where the tree is not rendered at all.
  await page.setViewportSize({ width: 390, height: 844 });
  await menu.click();
  await expect(entry).toHaveCount(0);
});

test('a saved body tube is offered back in the picker, starred, and can be deleted', async ({ page }) => {
  await page.locator('div[title="Body tube"]').click();

  // The catalog count before the save, so the saved part can be seen to join
  // the same list rather than a list of its own.
  const pick = page.getByRole('button', { name: /^Select part…/ });
  await expect(pick).toBeEnabled({ timeout: 20_000 });
  const before = Number(/\((\d+)\)/.exec((await pick.textContent()) ?? '')?.[1]);
  expect(before).toBeGreaterThan(0);

  await saveSelectedAs(page, PART);
  await expect(pick).toHaveText(new RegExp(`\\(${before + 1}\\)`), { timeout: 20_000 });

  // It is in the picker, marked as the user's own. Each result is a table row
  // whose part number is the button that applies it.
  await pick.click();
  const dialog = page.getByRole('dialog', { name: 'Select a part' });
  await expect(dialog).toBeVisible();
  const row = dialog.locator('tbody tr').filter({ hasText: PART });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('button', { name: PART, exact: true })).toHaveCount(1);
  await expect(row).toContainText('★ Bench');

  // And it goes away again, without the dialog closing under the user.
  await row.getByRole('button', { name: `Delete saved part ${PART}` }).click();
  await confirmDelete(page);
  await expect(row).toHaveCount(0);
  await expect(dialog).toBeVisible();
});

test('every saved part is listed and removable from the menu, whatever the design holds', async ({ page }) => {
  // A bulkhead, deliberately: the default rocket has none, so its picker
  // cannot be opened at all, and My Parts is the only place such a saved part
  // can be seen or deleted.
  await page.locator('div[title="Body tube"]').click();
  await page.locator('select').filter({ hasText: 'Bulkhead' }).selectOption({ label: 'Bulkhead' });
  await saveSelectedAs(page, 'Bench bulkhead');
  // Remove the bulkhead from the design, so nothing on screen is of its type.
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await confirmDelete(page);

  await openMyParts(page);
  const dialog = page.getByRole('dialog', { name: 'My Parts' });
  // Grouped under the type whose picker will offer it.
  await expect(dialog.getByRole('heading', { name: 'Bulkhead' })).toBeVisible();

  // Selecting on the left opens the editor on the right, in the same dialog.
  await dialog.getByRole('button', { name: /Bench bulkhead/ }).click();
  await expect(dialog.getByLabel('Part name')).toHaveValue('Bench bulkhead');

  // Deleting asks first, because the design it came from may be long gone.
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await confirmDelete(page);
  await expect(dialog.getByText('No saved parts yet.', { exact: false })).toBeVisible();
});

test('a saved part can be renamed and resized in place, and the picker follows', async ({ page }) => {
  await page.locator('div[title="Body tube"]').click();
  await saveSelectedAs(page, 'Bench draft');

  await openMyParts(page);
  const manage = page.getByRole('dialog', { name: 'My Parts' });
  await manage.getByRole('button', { name: /Bench draft/ }).click();

  // Renamed and resized in the detail pane: the fields are the property
  // panel's own, so the length reads in the user's unit. Save is inert until
  // something actually changes.
  await expect(manage.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await manage.getByLabel('Part name').fill('Bench 42cm tube');
  await manage.getByLabel('Length').fill('55');
  await manage.getByRole('button', { name: 'Save', exact: true }).click();

  // The part stays selected and the list updates under it: one part, the new
  // name, the new length. A rename that copied rather than moved would leave
  // two rows here.
  await expect(manage.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(manage.getByRole('listitem')).toHaveCount(1);
  const row = manage.getByRole('listitem').filter({ hasText: 'Bench 42cm tube' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('55.0');
  await manage.getByRole('button', { name: 'Close' }).click();

  // And the picker offers the edited part, not the one that was saved.
  await page.getByRole('button', { name: /^Select part…/ }).click();
  const picker = page.getByRole('dialog', { name: 'Select a part' });
  await expect(picker.getByRole('button').filter({ hasText: 'Bench 42cm tube' })).toHaveCount(1);
  await expect(picker.getByRole('button').filter({ hasText: 'Bench draft' })).toHaveCount(0);
});

test('switching parts with unsaved edits asks before throwing them away', async ({ page }) => {
  await page.locator('div[title="Nose cone"]').click();
  await saveSelectedAs(page, 'Bench cone');
  await page.locator('div[title="Body tube"]').click();
  await saveSelectedAs(page, 'Bench tube');

  await openMyParts(page);
  const manage = page.getByRole('dialog', { name: 'My Parts' });
  await manage.getByRole('button', { name: /Bench cone/ }).click();
  await manage.getByLabel('Part name').fill('Bench cone edited');

  // Declining leaves the edit, and the selection, exactly where they were.
  await manage.getByRole('button', { name: /Bench tube/ }).click();
  const ask = page.getByRole('alertdialog');
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(manage.getByLabel('Part name')).toHaveValue('Bench cone edited');

  // Accepting moves on and the edit is gone, not silently written.
  await manage.getByRole('button', { name: /Bench tube/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
  await expect(manage.getByLabel('Part name')).toHaveValue('Bench tube');
  await manage.getByRole('button', { name: /Bench cone/ }).click();
  await expect(manage.getByLabel('Part name')).toHaveValue('Bench cone');
});

test('a saved part carries back what no catalog column describes', async ({ page }) => {
  // A motor mount is a body tube flag the catalog has no column for, so it is
  // the plainest evidence that the whole node was saved and not the handful of
  // dimensions the picker lists.
  await page.locator('div[title="Body tube"]').click();
  const mount = page.getByLabel('Motor mount');
  await mount.check();
  await saveSelectedAs(page, 'Bench 29mm mount');

  // Clear the flag, then pick the saved part back.
  await mount.uncheck();
  await expect(mount).not.toBeChecked();
  await page.getByRole('button', { name: /^Select part…/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Select a part' });
  await dialog.getByRole('button').filter({ hasText: 'Bench 29mm mount' }).click();
  await expect(dialog).toBeHidden();
  await expect(mount).toBeChecked();
});

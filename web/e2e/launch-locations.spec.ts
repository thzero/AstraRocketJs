import { test, expect, openTab, ready, runButton, type Page } from './base';

/**
 * Saved launch locations, through the real app and real IndexedDB.
 *
 * `launchLocationStore.test.ts` covers the store and `LocationPicker.test.tsx` the component
 * against an in-memory one. What neither can reach is the thing that matters
 * most here: that a location SURVIVES A RELOAD. A location you have to re-enter is the
 * problem this feature exists to remove.
 */

/** The location row's controls, scoped past `getByLabel`'s substring matching. */
const padSelect = (page: Page) => page.getByLabel('Saved location', { exact: true });

const savePad = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Save this location' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save this location' });
  await dialog.getByRole('textbox').fill(name);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('option', { name })).toBeAttached();
};

/**
 * Move focus off a number field before touching the location dropdown.
 *
 * `NumberInput` renders a raw text draft WHILE FOCUSED and mirrors the prop
 * once blurred. A real click on the select blurs the field first; Playwright's
 * `selectOption` sets the value without moving focus, so without this the input
 * would keep showing the stale draft even though the store was updated.
 */
const blurFields = (page: Page) => page.getByText('LAUNCH SITE').click();

test('a saved location survives a reload and fills the site fields', async ({ page }) => {
  await ready(page);
  await openTab(page, 'Simulations');

  // Type a site, save it, then move the fields somewhere else entirely.
  await page.getByLabel('Latitude', { exact: true }).fill('39.05');
  await page.getByLabel('Longitude', { exact: true }).fill('-104.8');
  await page.getByLabel('Altitude', { exact: true }).fill('1830');
  await savePad(page, 'Home field');

  await page.reload();
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
  await openTab(page, 'Simulations');

  // Still there after the reload — this is the whole point.
  await expect(page.getByRole('option', { name: 'Home field' })).toBeAttached();
  await page.getByLabel('Latitude', { exact: true }).fill('0');
  await blurFields(page);

  await padSelect(page).selectOption({ label: 'Home field' });
  await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('39.05');
  await expect(page.getByLabel('Longitude', { exact: true })).toHaveValue('-104.8');
  await expect(page.getByLabel('Altitude', { exact: true })).toHaveValue('1830');
});

test('the picker says Custom once the fields no longer match', async ({ page }) => {
  await ready(page);
  await openTab(page, 'Simulations');
  await savePad(page, 'Home field');

  // Saving leaves the fields matching the location, so it is the current selection.
  await expect(padSelect(page)).toHaveValue(/.+/);
  // Edit one number and it is no longer that location. Recognized from the NUMBERS,
  // not a remembered id, so this holds however the fields changed.
  await page.getByLabel('Latitude', { exact: true }).fill('12.5');
  await blurFields(page);
  await expect(padSelect(page)).toHaveValue('');
});

test('picking Custom location returns the site to the launch defaults', async ({ page }) => {
  await ready(page);
  await openTab(page, 'Simulations');
  await page.getByLabel('Latitude', { exact: true }).fill('39.05');
  await page.getByLabel('Longitude', { exact: true }).fill('-104.8');
  await savePad(page, 'Home field');
  await expect(padSelect(page)).toHaveValue(/.+/);

  // The option was inert at first: the select's value is derived from the
  // fields, so picking it changed nothing and the location sprang back. It then
  // CLEARED the fields, which left all three required site inputs blank, the
  // map with nothing to draw and the Run button refusing.
  await blurFields(page);
  await padSelect(page).selectOption('');
  await expect(padSelect(page)).toHaveValue('');

  // The Kennedy Space Center, which is what the shipped launch defaults hold.
  await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('28.61');
  await expect(page.getByLabel('Longitude', { exact: true })).toHaveValue('-80.6');
  // A real place, so the run is still flyable rather than refused for a blank.
  await expect(runButton(page)).toBeEnabled();

  // One ordinary edit, so undo brings the previous site back.
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('39.05');
  await expect(page.getByLabel('Longitude', { exact: true })).toHaveValue('-104.8');
});

test('a location can be edited and deleted', async ({ page }) => {
  await ready(page);
  await openTab(page, 'Simulations');
  await savePad(page, 'Old name');

  await page.getByRole('button', { name: 'Manage saved locations' }).click();
  const manage = page.getByRole('dialog', { name: 'Manage saved locations' });
  await manage.getByRole('button', { name: 'Edit' }).click();
  // By NAME, not `.last()`: the manage dialog is still open behind it.
  const edit = page.getByRole('dialog', { name: 'Edit' });
  await edit.getByRole('textbox').fill('New name');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();

  // The manage list refreshes itself; the launch panel's dropdown behind the
  // modal refreshes when the dialog closes, which is when it is next visible.
  await expect(manage.getByText('New name')).toBeVisible();
  await expect(manage.getByText('Old name')).toHaveCount(0);

  // Deleting asks first: the location is the only copy of coordinates somebody may
  // have measured at a field.
  await manage.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
  await expect(manage.getByText(/No saved locations yet/i)).toBeVisible();

  await manage.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('option', { name: 'New name' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage saved locations' })).toBeDisabled();
});

/**
 * The menu route.
 *
 * The launch panel's ⚙ is only reachable from the Simulations tab, which makes
 * "where are my locations?" a question with an answer you have to already know. The
 * menu entry sits beside the Motor Dashboard, which is the same kind of thing:
 * a library of your own with a place to see it.
 */
test('launch locations open from the menu, and say what they are when empty', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Launch locations' }).click();

  const dialog = page.getByRole('dialog', { name: 'Manage saved locations' });
  await expect(dialog).toBeVisible();
  // Reachable before anything is saved, so it explains where locations come from
  // rather than showing an empty box.
  await expect(dialog.getByText(/No saved locations yet/i)).toBeVisible();
});

test('a location applies to the current simulation from the menu', async ({ page }) => {
  await ready(page);
  await openTab(page, 'Simulations');
  await page.getByLabel('Latitude', { exact: true }).fill('39.05');
  await savePad(page, 'Home field');
  await page.getByLabel('Latitude', { exact: true }).fill('0');
  await blurFields(page);

  // From the menu there is no site field on screen to write into, so applying
  // targets the ACTIVE simulation through the same patch the dropdown uses.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Launch locations' }).click();
  await page.getByRole('dialog', { name: 'Manage saved locations' }).getByText('Home field').click();

  await expect(page.getByRole('dialog', { name: 'Manage saved locations' })).toBeHidden();
  await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('39.05');
});

test('a location’s coordinates can be corrected, not just its name', async ({ page }) => {
  await ready(page);
  await openTab(page, 'Simulations');
  await page.getByLabel('Latitude', { exact: true }).fill('39.05');
  await savePad(page, 'Home field');

  await page.getByRole('button', { name: 'Manage saved locations' }).click();
  await page.getByRole('dialog', { name: 'Manage saved locations' }).getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit' });
  // The reason this dialog exists: a typo in a coordinate is the thing you most
  // want to fix about a location, and renaming could not.
  await edit.getByLabel('Latitude', { exact: true }).fill('39.1234');
  await edit.getByLabel('Altitude', { exact: true }).fill('1830');
  // The name must still be the name. The dialog focuses and selects it on open,
  // and while that was a `requestAnimationFrame` it could land a frame late,
  // mid-keystroke, and swallow the latitude into the name box - saving a
  // location called "39.1234". Silent to a user, so it is asserted here.
  await expect(edit.getByRole('textbox')).toHaveValue('Home field');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();

  const manage = page.getByRole('dialog', { name: 'Manage saved locations' });
  await expect(manage.getByText('39.1234')).toBeVisible();
  await manage.getByRole('button', { name: 'Close' }).click();

  // And the corrected values are what applying it now writes.
  await page.getByLabel('Latitude', { exact: true }).fill('0');
  await blurFields(page);
  await padSelect(page).selectOption({ label: 'Home field' });
  await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('39.1234');
  await expect(page.getByLabel('Altitude', { exact: true })).toHaveValue('1830');
});

test('a location can be created from nothing, in the menu', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Launch locations' }).click();

  // From the menu there are no launch fields to capture, so this is the only
  // way to add one there.
  const manage = page.getByRole('dialog', { name: 'Manage saved locations' });
  await manage.getByRole('button', { name: 'New location' }).click();
  const edit = page.getByRole('dialog', { name: 'New location' });
  await edit.getByRole('textbox').fill('Bong');
  await edit.getByLabel('Latitude', { exact: true }).fill('42.66');
  await edit.getByLabel('Longitude', { exact: true }).fill('-88.14');
  await edit.getByLabel('Altitude', { exact: true }).fill('238');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(manage.getByText('Bong')).toBeVisible();
  await expect(manage.getByText(/42\.6600/)).toBeVisible();

  // It applies to the open simulation like any other location.
  await manage.getByText('Bong').click();
  await openTab(page, 'Simulations');
  await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('42.66');
});

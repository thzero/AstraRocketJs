import { test, expect, openTab, ready, type Page } from './base';

/**
 * The launch-site map, through the real app.
 *
 * Tile requests are answered locally by the fixture in `base.ts`, so nothing
 * here depends on Esri being reachable. What that still
 * proves is the part unit tests cannot: that the map is reachable from both
 * places it was asked for, that a click on it lands in the launch fields as
 * ONE undoable edit, and that the layer buttons change which provider is
 * asked.
 */

const mapIn = (scope: Page | ReturnType<Page['getByRole']>) => scope.getByRole('group', { name: /Launch site map/ });

const lat = (page: Page) => page.getByLabel('Latitude', { exact: true });
const lon = (page: Page) => page.getByLabel('Longitude', { exact: true });

/** Move focus off a number field first: see the note in launch-locations.spec.ts. */
const blurFields = (page: Page) => page.getByText('LAUNCH SITE').click();

test('the map opens from the launch site card and shows where the coordinates are', async ({ page }) => {
  await ready(page);
  await openTab(page, 'Simulations');
  await lat(page).fill('39.05');
  await lon(page).fill('-104.8');
  await blurFields(page);

  await page.getByRole('button', { name: 'Show on map' }).click();
  const dialog = page.getByRole('dialog', { name: 'Launch site' });
  await expect(dialog).toBeVisible();

  // Hemispheres rather than signs, which is the error the map is here to catch.
  await expect(dialog.getByText('39.0500° N, 104.8000° W')).toBeVisible();
  // And it really drew: the fixture's tiles answered.
  await expect(dialog.locator('img').first()).toBeVisible();
});

test('clicking the map moves the location, as one undoable edit', async ({ page }) => {
  await ready(page);
  await openTab(page, 'Simulations');
  await lat(page).fill('39.05');
  await lon(page).fill('-104.8');
  await blurFields(page);

  await page.getByRole('button', { name: 'Show on map' }).click();
  const dialog = page.getByRole('dialog', { name: 'Launch site' });
  // North-west of center: up is north, left is west.
  await mapIn(dialog).click({ position: { x: 60, y: 40 } });
  await dialog.getByRole('button', { name: 'Close' }).click();

  const moved = Number(await lat(page).inputValue());
  expect(moved).toBeGreaterThan(39.05);
  expect(Number(await lon(page).inputValue())).toBeLessThan(-104.8);

  // One edit, so one undo puts the site back rather than leaving half of it
  // moved — the coordinates are written as a single patch.
  await page.keyboard.press('Control+z');
  await expect(lat(page)).toHaveValue('39.05');
  await expect(lon(page)).toHaveValue('-104.8');
});

test('the layer buttons switch which provider is asked', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (/arcgisonline\.com|openstreetmap\.org/.test(r.url())) asked.push(r.url());
  });

  await ready(page);
  await openTab(page, 'Simulations');
  await lat(page).fill('39.05');
  await lon(page).fill('-104.8');
  await blurFields(page);
  await page.getByRole('button', { name: 'Show on map' }).click();
  const dialog = page.getByRole('dialog', { name: 'Launch site' });

  await expect.poll(() => asked.some((u) => u.includes('World_Imagery'))).toBe(true);

  await dialog.getByRole('button', { name: 'Street' }).click();
  await expect.poll(() => asked.some((u) => u.includes('World_Street_Map'))).toBe(true);

  // Switching layers is a question about the PICTURE, so it must not touch the
  // coordinates. The layer buttons sit inside the box the map's pointer
  // handlers are on, and their events bubble: this used to read as a click on
  // the ground and move the launch site to the map's top-left corner.
  await expect(dialog.getByText('39.0500° N, 104.8000° W')).toBeVisible();

  // And nothing ever reached OpenStreetMap's volunteer tile servers, which the
  // street layer used to be pointed at. Asserted on the real network traffic,
  // because that is the only place the mistake would show.
  expect(asked.filter((u) => u.includes('openstreetmap.org'))).toEqual([]);

  // Put the layer back: it is remembered for the session, and the location editor
  // opened later in this file expects to start on imagery.
  await dialog.getByRole('button', { name: 'Satellite' }).click();
});

test('the location editor carries a map beside its fields', async ({ page }) => {
  await ready(page);
  await openTab(page, 'Simulations');

  // Save a location, then reopen it for editing: the editor is where a mistyped
  // coordinate gets corrected, so the map belongs next to those fields.
  await lat(page).fill('39.05');
  await lon(page).fill('-104.8');
  await blurFields(page);
  await page.getByRole('button', { name: 'Save this location' }).click();
  const naming = page.getByRole('dialog', { name: 'Save this location' });
  await naming.getByRole('textbox').fill('Home field');
  await naming.getByRole('button', { name: 'Save', exact: true }).click();

  await page.getByRole('button', { name: 'Manage saved locations' }).click();
  await page.getByRole('dialog', { name: 'Manage saved locations' }).getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit' });
  await expect(editor.getByText('39.0500° N, 104.8000° W')).toBeVisible();

  // Typing a coordinate moves the pin, so the map answers the draft rather
  // than the location as saved.
  await editor.getByLabel('Latitude', { exact: true }).fill('51.5');
  await expect(editor.getByText('51.5000° N, 104.8000° W')).toBeVisible();

  // And a click writes both fields back, which is how a field with no
  // published coordinates gets entered at all.
  await mapIn(editor).click({ position: { x: 40, y: 30 } });
  expect(Number(await editor.getByLabel('Latitude', { exact: true }).inputValue())).toBeGreaterThan(51.5);
});

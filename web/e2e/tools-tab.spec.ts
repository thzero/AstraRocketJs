import { test, expect, ready } from './base';

/**
 * The Tools tab's other two tools, and the parachute editor's sizing dialog,
 * end to end. Nothing here leaves the machine: the motor comes from the bundled
 * catalog and no forecast is asked for.
 */

test('Off the rail flies a catalog motor up the rail', async ({ page }) => {
  await ready(page);
  await page.getByRole('navigation', { name: 'Workbench' }).getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('tab', { name: 'Off the rail' }).click();
  await expect(page.getByRole('heading', { name: 'Off the rail' })).toBeVisible();

  await page.getByRole('button', { name: 'Choose…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder(/Search by code/i).fill('F50');
  const row = dialog.locator('ul li button[aria-pressed]').first();
  await row.click();
  await dialog.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(dialog).toBeHidden();

  const result = page.getByRole('region', { name: 'Off the rail result' });
  await expect(result.getByText('Rail exit speed')).toBeVisible();
  await expect(result.getByText('Weathercock angle', { exact: true })).toBeVisible();
  await expect(result.getByText(/^An estimate: no drag/)).toBeVisible();
});

test('Parachute sizing works from typed inputs', async ({ page }) => {
  await ready(page);
  await page.getByRole('navigation', { name: 'Workbench' }).getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('tab', { name: 'Parachute sizing' }).click();
  const result = page.getByRole('region', { name: 'Parachute sizing result' });
  await expect(result.getByText(/^Main \(/)).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Canopy diameter' }).fill('60');
  await expect(result.getByText('This canopy')).toBeVisible();
});

test('the parachute editor opens its sizing in a dialog, and applies a size', async ({ page }) => {
  await ready(page);
  await page.locator('div[title="Parachute"]').click();
  await page.getByRole('button', { name: 'Descent sizing…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Descent sizing' });
  await expect(dialog.getByText(/^Estimated for a descent mass/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Use the main diameter' }).click();
  // The canopy now lands in the main band.
  await expect(dialog.getByText('(main range)')).toBeVisible();
});

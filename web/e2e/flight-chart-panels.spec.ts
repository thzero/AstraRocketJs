import { test, expect, openTab, ready, runFlight } from './base';

/**
 * The flight chart's own controls, in a real browser: the velocity-against-
 * altitude panel, expanding one panel to the pane, and the run table download
 * on the Simulations tab. The series math is unit-tested; what only a browser
 * shows is that the controls reach the panels they are drawn on.
 */

test('a panel expands to the pane and gives the others back', async ({ page }) => {
  await ready(page);
  await runFlight(page);
  await openTab(page, 'Results');
  await page.getByRole('button', { name: 'Flight', exact: true }).click();

  await page.getByRole('button', { name: 'Velocity vs altitude', exact: true }).click();
  const expand = page.getByRole('button', { name: 'Show only this panel' });
  const before = await expand.count();
  expect(before).toBeGreaterThan(1);

  await expand.last().click();
  await expect(page.getByRole('button', { name: 'Show all panels' })).toHaveCount(1);
  await expect(expand).toHaveCount(0);

  await page.getByRole('button', { name: 'Show all panels' }).click();
  await expect(expand).toHaveCount(before);
});

test('the run table downloads every simulation as CSV', async ({ page }) => {
  await ready(page);
  await runFlight(page);
  await openTab(page, 'Simulations');
  const download = page.waitForEvent('download');
  await page.getByTitle(/Download the run table/).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/run-table\.csv$/);
  const text = await (await file.createReadStream()).toArray();
  const csv = Buffer.concat(text).toString('utf8');
  expect(csv.split('\r\n')[0]).toMatch(/^Simulation,Configuration,Motors,Status,Apogee \(/);
  expect(csv.split('\r\n').filter(Boolean).length).toBeGreaterThan(1);
});

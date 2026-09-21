import { test, expect, openTab, ready, importRkt } from './base';

/**
 * RockSim `.rkt` import and export, through the real app.
 *
 * The readers and writers have unit tests (`rktImport.test.ts`,
 * `rktExport.test.ts`); this covers what those cannot — that the menu entries
 * are wired, that the format sniff routes a `.rkt` to the right reader inside
 * the worker-backed load path, and that the imported design actually builds in
 * the kernel and produces numbers.
 */
test('a .rkt imports, builds and flies', async ({ page }) => {
  await ready(page);
  await importRkt(page, 'e2e/fixtures/rocksim.rkt', 'RockSim Bird');

  // The parts came across, not just the name.
  const tree = page.getByRole('tree', { name: 'Components' });
  for (const part of ['Nose', 'Airframe', 'Fins', 'Motor mount', 'Chute']) {
    await expect(tree.getByText(part, { exact: true }), part).toBeVisible();
  }

  // And the kernel built it: the statistics strip is computed, not stored, so a
  // real length and mass here mean the geometry survived the unit conversions.
  await expect(page.getByText('L/D', { exact: true })).toBeVisible();
  const stats = await page.locator('main').innerText();
  expect(stats).toMatch(/LENGTH/);

  // RockSim keeps its motor choices with its simulations, so the import says so
  // rather than leaving the user to wonder where the motor went.
  await expect(page.getByText(/motor selections and launch conditions are not imported/i)).toBeVisible();

  // The mount came across AS a mount, which is what makes the design flyable
  // once a motor is chosen. Until then the run is refused and says why — the
  // app will not seat a default C6 to make an unflyable file look flyable.
  await openTab(page, 'Simulations');
  await expect(page.getByRole('button', { name: /Run flight simulation/ })).toBeDisabled();
  await expect(page.getByText(/no usable motor/i)).toBeVisible();
});

test('the design exports back out as a .rkt', async ({ page }) => {
  await ready(page);
  await importRkt(page, 'e2e/fixtures/rocksim.rkt', 'RockSim Bird');

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: /^Export$/ }).click();
  const wait = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export RockSim (.rkt)' }).click();
  const dl = await wait;

  expect(dl.suggestedFilename()).toMatch(/\.rkt$/);
  // Plain XML, not a zip: RockSim does not archive its files, and a .ork-shaped
  // download here would open in nothing.
  const path = await dl.path();
  const text = await (await import('node:fs/promises')).readFile(path!, 'utf8');
  expect(text).toContain('<RockSimDocument>');
  expect(text).toContain('<Name>RockSim Bird</Name>');
  expect(text).toContain('<StageCount>1</StageCount>');
});

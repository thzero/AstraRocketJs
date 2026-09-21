import { test, expect, ready } from './base';

/**
 * The whole-rocket 3MF export, through the real app.
 *
 * The writer has unit tests (`threeMf.test.ts`) that parse the package and
 * check its geometry; this covers what those cannot — that the menu entry is
 * wired, that the dialog lists what the live design can print, and that the
 * download that comes out is a real 3MF built from the real meshers.
 */
const openDialog = async (page: import('./base').Page) => {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: /^Export$/ }).click();
  await page.getByRole('menuitem', { name: 'Export printable parts as 3MF' }).click();
  await expect(page.getByRole('dialog', { name: '3D print export' })).toBeVisible();
};

test('the dialog lists the parts that can actually be printed', async ({ page }) => {
  await ready(page);
  await openDialog(page);
  const dlg = page.getByRole('dialog', { name: '3D print export' });

  // The default design's solids, ticked by default.
  for (const part of ['Nose cone', 'Body tube', 'Trapezoidal fin set', 'Centering ring']) {
    await expect(dlg.getByRole('checkbox', { name: part }).first(), part).toBeChecked();
  }
  // …and not the parts with no body to print. Offering a parachute a tick box
  // that does nothing is a worse answer than leaving it out.
  await expect(dlg.getByRole('checkbox', { name: 'Parachute' })).toHaveCount(0);
});

test('it downloads a real 3MF package', async ({ page }) => {
  await ready(page);
  await openDialog(page);

  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save 3MF' }).click();
  const dl = await wait;
  expect(dl.suggestedFilename()).toMatch(/\.3mf$/);

  // A 3MF is an OPC zip: check the members rather than the extension, since a
  // file named .3mf that slicers reject is the failure worth catching.
  const { readFile } = await import('node:fs/promises');
  const { unzipSync, strFromU8 } = await import('fflate');
  const archive = unzipSync(new Uint8Array(await readFile((await dl.path())!)));
  expect(Object.keys(archive).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);

  const model = strFromU8(archive['3D/3dmodel.model']!);
  expect(model).toContain('unit="millimeter"');
  expect(model).toContain('name="Nose cone"');
  // Real geometry from the real meshers, not an empty shell.
  expect((model.match(/<triangle /g) ?? []).length).toBeGreaterThan(100);
});

test('clearing a part leaves it out of the file', async ({ page }) => {
  await ready(page);
  await openDialog(page);
  const dlg = page.getByRole('dialog', { name: '3D print export' });
  await dlg.getByRole('checkbox', { name: 'Nose cone' }).first().uncheck();

  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save 3MF' }).click();
  const dl = await wait;

  const { readFile } = await import('node:fs/promises');
  const { unzipSync, strFromU8 } = await import('fflate');
  const model = strFromU8(unzipSync(new Uint8Array(await readFile((await dl.path())!)))['3D/3dmodel.model']!);
  expect(model).not.toContain('name="Nose cone"');
  expect(model).toContain('name="Body tube"');
});

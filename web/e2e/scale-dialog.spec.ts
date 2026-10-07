import { test, expect, ready } from './base';

/**
 * Desktop's Scale dialog: with a part selected it starts on that part and what
 * is inside it, the from/to pair sets the factor, and scaling one part leaves
 * the rest of the rocket as it was.
 */
test('scales the selected part and its subcomponents, set from a from/to pair', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await ready(page);
  const tree = page.getByRole('tree', { name: 'Components' });
  // Unanchored: a row with children starts its name with the fold button's label.
  const length = (name: string) => tree.getByRole('treeitem', { name: new RegExp(name) });

  await expect(length('Body tube')).toContainText('45.7 cm');
  await expect(length('Nose cone')).toContainText('6.98 cm');

  await length('Body tube').click();
  await page.getByRole('button', { name: /Scale/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Scale rocket' });
  await expect(dialog.getByLabel('Scale', { exact: true })).toHaveValue('subtree');

  // "From" starts at the body tube's diameter; typing the size wanted sets the factor.
  const from = dialog.getByRole('spinbutton', { name: 'Scale from' });
  const to = dialog.getByRole('spinbutton', { name: 'Scale to' });
  await to.fill(String(Number(await from.inputValue()) * 1.5));
  await to.blur();
  await expect(dialog.getByRole('spinbutton', { name: 'Scale by' })).toHaveValue('1.5');

  await dialog.getByRole('button', { name: /Scale to 150%/ }).click();
  await expect(length('Body tube')).toContainText('68.6 cm');
  // The nose cone is outside the selection, so it keeps its size.
  await expect(length('Nose cone')).toContainText('6.98 cm');
});

test('turns offsets off for one part alone, and back on for the whole rocket', async ({ page }) => {
  await ready(page);
  const tree = page.getByRole('tree', { name: 'Components' });
  await tree
    .getByRole('treeitem', { name: /^Centering ring/ })
    .first()
    .click();
  await page.getByRole('button', { name: /Scale/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Scale rocket' });
  // A leaf part has no subcomponents to offer.
  await expect(dialog.getByLabel('Scale', { exact: true })).toHaveValue('part');
  await expect(dialog.getByRole('checkbox', { name: 'Scale component offsets' })).not.toBeChecked();
  await dialog.getByLabel('Scale', { exact: true }).selectOption('rocket');
  await expect(dialog.getByRole('checkbox', { name: 'Scale component offsets' })).toBeChecked();
  // The default design has a mass component, so typed masses can follow.
  await expect(dialog.getByRole('checkbox', { name: 'Update explicit mass values' })).toBeEnabled();
});

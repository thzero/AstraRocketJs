import { test, expect, ready } from './base';

/**
 * Cut, copy, paste and duplicate on the parts tree, with the buttons and with
 * desktop's shortcuts. The rows are counted by name, since a copy keeps the
 * original's name as it does on the desktop.
 */
test('the tree cuts, copies, pastes and duplicates parts', async ({ page }) => {
  await ready(page);
  const tree = page.getByRole('tree', { name: 'Components' });
  const rows = (name: string) => tree.getByRole('treeitem', { name });
  const button = (name: string) => page.getByRole('button', { name, exact: true });

  // Nothing copied yet: Paste is off and says why.
  await expect(button('Paste')).toBeDisabled();
  await expect(button('Paste')).toHaveAttribute('title', /Nothing to paste/);

  await rows('Shock cord').click();
  await button('Copy').click();
  // A shock cord holds nothing, so a paste here goes beside it.
  await expect(button('Paste')).toBeEnabled();
  await rows('Body tube').click();
  await button('Paste').click();
  await expect(rows('Shock cord')).toHaveCount(2);
  // The copy is selected, so the next command acts on it.
  await expect(tree.getByRole('treeitem', { selected: true })).toHaveAccessibleName(/^Shock cord/);

  await button('Duplicate').click();
  await expect(rows('Shock cord')).toHaveCount(3);

  await button('Cut').click();
  await expect(rows('Shock cord')).toHaveCount(2);

  // The shortcuts, on a focused row.
  await rows('Body tube').click();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(rows('Shock cord')).toHaveCount(3);
  await page.keyboard.press('ControlOrMeta+d');
  await expect(rows('Shock cord')).toHaveCount(4);

  // Each one is a single undo step.
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(rows('Shock cord')).toHaveCount(2);

  // Fins cannot go in a nose cone, nor beside it in the stage: Paste turns off
  // and names both.
  await rows('Trapezoidal fin set').click();
  await button('Copy').click();
  await rows('Nose cone').click();
  await expect(button('Paste')).toBeDisabled();
  await expect(button('Paste')).toHaveAttribute('title', /Trapezoidal fin set can't go in or after Nose cone/);
});

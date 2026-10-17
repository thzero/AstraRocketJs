import { test, expect, ready, type Page } from './base';

/**
 * A Settings value typed and left with Escape is kept.
 *
 * Those fields report on blur or Enter. Escape closes the dialog and removes
 * the focused field, and a removed node gets no blur from React, which a real
 * browser shows and jsdom does not.
 */

const openSimSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Simulation' }).click();
  return dialog;
};

test('a time step or maximum time typed and left with Escape is saved', async ({ page }) => {
  await ready(page);

  for (const [label, typed] of [
    ['Time step', '0.02'],
    ['Max sim time', '450'],
  ] as const) {
    let dialog = await openSimSettings(page);
    const field = () => dialog.getByLabel(label, { exact: true });
    await expect(field()).not.toHaveValue(typed);
    await field().fill(typed);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    dialog = await openSimSettings(page);
    await expect(field()).toHaveValue(typed);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }

  // Stored, not only held by the open page.
  await page.reload();
  await ready(page);
  const dialog = await openSimSettings(page);
  await expect(dialog.getByLabel('Time step', { exact: true })).toHaveValue('0.02');
  await expect(dialog.getByLabel('Max sim time', { exact: true })).toHaveValue('450');
});

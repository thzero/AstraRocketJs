import { test, expect, ready } from './base';

/**
 * Text a number box cannot read as a number leaves the stored value alone.
 *
 * Chromium hands a `type="number"` input's change handler an empty value, with
 * `validity.badInput` set, for "-" (the first keystroke of a negative number)
 * and for an exponent with no digits yet ("12e"). jsdom delivers the raw string
 * instead, so only a real browser shows what the field does with those
 * keystrokes. (A comma is not a case here: Chromium in an en-US locale drops
 * the keystroke, so the box never holds it.) The nose cone's shoulder length
 * is an optional dimension, the kind that would store 0 for a cleared box.
 */

test.beforeEach(async ({ page }) => {
  await ready(page);
});

test('a lone minus sign and an unfinished exponent keep the stored value', async ({ page }) => {
  await page.locator('div[title="Nose cone"]').click();
  const field = page.getByRole('spinbutton', { name: 'Shoulder length', exact: true });
  await field.fill('12');
  await field.blur();
  await expect(field).toHaveValue('12');

  // A lone "-": the box holds it while focused, and the value stays.
  await field.click();
  await field.press('ControlOrMeta+a');
  await field.pressSequentially('-');
  expect(await field.evaluate((el: HTMLInputElement) => el.validity.badInput)).toBe(true);
  await field.blur();
  await expect(field).toHaveValue('12');

  // "12e": the first keystroke of an exponent.
  await field.click();
  await field.press('End');
  await field.pressSequentially('e');
  expect(await field.evaluate((el: HTMLInputElement) => el.validity.badInput)).toBe(true);
  await field.blur();
  await expect(field).toHaveValue('12');
});

test('emptying the box after a lone minus sign clears it, as emptying it directly does', async ({ page }) => {
  await page.locator('div[title="Nose cone"]').click();
  const field = page.getByRole('spinbutton', { name: 'Shoulder length', exact: true });

  // What an empty box stores, by the plain path: select all and delete.
  await field.fill('12');
  await field.blur();
  await field.click();
  await field.press('ControlOrMeta+a');
  await field.press('Delete');
  await field.blur();
  const cleared = await field.evaluate((el: HTMLInputElement) => el.value);
  expect(cleared).not.toBe('12');

  // The same end state reached through "-": the browser reports '' for "-" and
  // again for the empty box, so no change event marks the clear.
  await field.fill('12');
  await field.blur();
  await field.click();
  await field.press('ControlOrMeta+a');
  await field.pressSequentially('-');
  await field.press('Backspace');
  await field.blur();
  await expect(field).toHaveValue(cleared);
});

test('a Settings field that commits on blur keeps its value through a lone minus sign', async ({ page }) => {
  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Simulation' }).click();
  const field = dialog.getByRole('spinbutton', { name: 'Max sim time', exact: true });
  await field.fill('900');
  await field.blur();
  await expect(field).toHaveValue('900');

  await field.click();
  await field.press('ControlOrMeta+a');
  await field.pressSequentially('-');
  expect(await field.evaluate((el: HTMLInputElement) => el.validity.badInput)).toBe(true);
  await field.blur();
  await expect(field).toHaveValue('900');

  await field.click();
  await field.press('End');
  await field.pressSequentially('e');
  await field.press('Enter');
  await expect(field).toHaveValue('900');
});

import { test, expect, ready, type Page } from './base';

/**
 * Undo and redo while the component editor is a dialog.
 *
 * Below `2xl` the editor opens over the drawing, and it is where every part
 * edit happens at that width, so Ctrl+Z and Ctrl+Y have to work with it open,
 * as they do with the editor in the right-hand column.
 *
 * The edits are made with a select and a checkbox, and the shortcut is pressed
 * with a button focused: a text box has an undo of its own, which would revert
 * the box whether or not the design's undo ran.
 */

const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit component' });

test('Ctrl+Z and Ctrl+Y undo and redo part edits with the editor dialog open', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await ready(page);
  await page.locator('div[title="Nose cone"]').click();
  await expect(editor(page)).toBeVisible();

  const shape = editor(page).getByRole('combobox', { name: /^Shape/ });
  const filled = editor(page).getByRole('checkbox', { name: 'Filled' });
  const close = editor(page).getByRole('button', { name: 'Close' });
  // The default rocket's nose cone.
  const shapeBefore = 'ogive';
  const shapeAfter = 'conical';
  await expect(shape).toHaveValue(shapeBefore);
  await expect(filled).not.toBeChecked();

  await shape.selectOption(shapeAfter);
  await filled.check();
  await close.focus();

  await page.keyboard.press('Control+z');
  await expect(filled).not.toBeChecked();
  await expect(shape).toHaveValue(shapeAfter);
  await page.keyboard.press('Control+z');
  await expect(shape).toHaveValue(shapeBefore);
  await expect(editor(page)).toBeVisible();

  await page.keyboard.press('Control+y');
  await expect(shape).toHaveValue(shapeAfter);
  await page.keyboard.press('Control+Shift+z');
  await expect(filled).toBeChecked();
});

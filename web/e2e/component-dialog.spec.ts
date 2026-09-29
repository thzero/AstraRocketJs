import { test, expect, ready, type Page } from './base';

/**
 * Where the component editor IS, which depends on how wide the window is.
 *
 * The Design tab wants three columns, and three of them do not fit under `xl`:
 * the tree and a 380px property panel leave the drawing a strip. So at 1280 and
 * up the editor is the right-hand column it has always been, and under that it
 * is a dialog opened over the drawing. Never both at once - a hidden second copy
 * is still in the document, and every field in it still answers to its label.
 *
 * The column itself is covered by component-editor.spec (which runs at the
 * project's 1500) and pane-splitter.spec; this is about the SWITCH.
 */

const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit component' });
/** The heading of the property column, and so the tell that the column is there. */
const columnHint = (page: Page) => page.getByText(/Select a component in the tree or drawing/i);

test('between lg and xl the editor is a dialog, and the column is gone', async ({ page }) => {
  // Wide enough for the component tree (lg), too narrow for a third column.
  await page.setViewportSize({ width: 1200, height: 900 });
  await ready(page);

  // No column, so no divider for it either, and nothing open until something
  // is selected.
  await expect(columnHint(page)).toHaveCount(0);
  await expect(page.getByRole('separator', { name: /side panel/ })).toHaveCount(0);
  await expect(editor(page)).toHaveCount(0);

  // Selecting a part in the tree opens it, with that part's fields in it.
  await page.locator('div[title="Nose cone"]').click();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByLabel('Shoulder length')).toBeVisible();
  // One editor in the document, not a column hiding behind the dialog.
  await expect(page.getByLabel('Shoulder length')).toHaveCount(1);

  // Closing leaves the part SELECTED: the dialog is how you edit it, not how
  // you hold it.
  await editor(page).getByRole('button', { name: /close/i }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(1);

  // And the same part opens again. This is what `selectionSeq` is for: the
  // store already holds this id, so a dialog keyed on the id alone would make
  // the second click do nothing at all.
  await page.locator('div[title="Nose cone"]').click();
  await expect(editor(page)).toBeVisible();

  // Another part while it is open swaps the contents rather than stacking a
  // second dialog on the first.
  await editor(page).getByRole('button', { name: /close/i }).click();
  await page.locator('div[title="Trapezoidal fin set"]').click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(editor(page).getByLabel('Fin tab length')).toBeVisible();
});

test('at xl and up it is the right-hand column, with no dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 }); // exactly the breakpoint
  await ready(page);

  await expect(columnHint(page)).toBeVisible();
  await page.locator('div[title="Nose cone"]').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Shoulder length')).toHaveCount(1);
});

/**
 * The phone, where the tree is not on screen either and the drawing is the only
 * way to reach a part. Tapping one there has to open the editor, or a phone can
 * see a design and not change it.
 */
test('a phone opens it by tapping the part in the drawing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);

  await page.getByRole('button', { name: /Sketch/ }).click();
  const svg = page
    .locator('svg')
    .filter({ has: page.locator('title') })
    .first();
  const b = (await svg.boundingBox())!;
  // The drawing is turned a quarter turn on a portrait phone, so the airframe
  // runs DOWN the box; its center is mid-rocket, on the centerline.
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);

  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByLabel('Motor mount')).toBeVisible(); // the body tube
});

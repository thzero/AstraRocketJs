import { test, expect, type Page } from './base';

async function openUnitsTab(page: Page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page
    .getByRole('menuitem', { name: 'Settings' })
    .or(page.getByText('Settings', { exact: true }))
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Units', exact: true }).click();
  return dialog;
}

// The glyph is the button's TEXT, not its name: SettingsDialog.tsx labels it
// `aria-label={t('settings.close')}` ("Close"), and a11y.spec.ts pins that a
// close button is named. Matching the ✕ found whichever dialog drew one first.
// The dialog has two buttons named Close (the header ✕ carries aria-label
// "Close", the footer button says it); either dismisses, so take the first.
const closeDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close', exact: true }).first().click();

/**
 * Units are a display/entry preference: the tree and the kernel stay SI.
 *
 * The two halves that can silently rot are that a preference reaches every
 * readout, and that an inline chip does NOT — a chip changes its own field and
 * stops there, which is the whole reason the per-field layer exists.
 */
test('the preferences reach the fields, the tree, the rulers and the stats strip', async ({ page }) => {
  await page.goto('/');

  const bodyTube = page.locator('div[title="Body tube"]').first();
  const schematic = page.locator('svg').first();
  // The ruler's unit caption is its own <text>, distinct from the tick numbers,
  // found by its data hook rather than its color class.
  const rulerUnit = schematic.locator('text[data-ruler-unit]').first();
  const statsUnit = page.getByLabel('Length unit').first();

  await expect(bodyTube).toContainText('cm');
  await expect(rulerUnit).toHaveText('cm');
  await expect(statsUnit).toHaveValue('cm');

  const dialog = await openUnitsTab(page);
  await dialog.getByRole('button', { name: 'Imperial defaults' }).click();
  await expect(dialog.getByLabel('Component dimensions')).toHaveValue('in');
  await closeDialog(page);

  // …all of them follow, with no reload and no re-selection.
  await expect(bodyTube).toContainText('in');
  await expect(rulerUnit).toHaveText('in');
  await expect(statsUnit).toHaveValue('in');
});

test('a chip changes its own field only, and nothing else moves', async ({ page }) => {
  await page.goto('/');

  await page.locator('div[title="Nose cone"]').click();
  const card = page.locator('section').filter({ hasText: 'Shoulder capped' });
  const lengthChip = card.getByLabel('Component dimensions unit').first();
  const thicknessRow = card.locator('label').filter({ hasText: 'Thickness' }).first();

  await lengthChip.selectOption('in');

  // The field it sits on changed…
  await expect(lengthChip).toHaveValue('in');
  // …its neighbor on the same card did not…
  await expect(thicknessRow.getByLabel('Component dimensions unit')).toHaveValue('cm');
  // …nor did the tree row, the ruler, or the stats strip.
  await expect(page.locator('div[title="Body tube"]').first()).toContainText('cm');
  await expect(page.locator('svg').first().locator('text[data-ruler-unit]').first()).toHaveText('cm');
  // …and Settings still shows the untouched default.
  const dialog = await openUnitsTab(page);
  await expect(dialog.getByLabel('Component dimensions')).toHaveValue('cm');
  await closeDialog(page);
});

test('a field showing a non-default unit says so in its name', async ({ page }) => {
  await page.goto('/');

  await page.locator('div[title="Nose cone"]').click();
  const card = page.locator('section').filter({ hasText: 'Shoulder capped' });
  const lengthChip = card.getByLabel('Component dimensions unit', { exact: true }).first();

  // Following the default: named without qualification (the tint is a
  // presentation detail; the accessible name is the contract).
  await lengthChip.selectOption('in');

  // Overridden: tinted, AND the accessible name carries the same fact, since a
  // color-only cue reaches nobody using a screen reader.
  const overridden = card.getByLabel('Component dimensions unit, set for this field').first();
  await expect(overridden).toHaveValue('in');

  // Picking the default back drops the override, so the qualified name goes
  // with it: the chip is once again named without "set for this field".
  await overridden.selectOption('cm');
  await expect(card.getByLabel('Component dimensions unit', { exact: true }).first()).toHaveValue('cm');
  await expect(card.getByLabel('Component dimensions unit, set for this field')).toHaveCount(0);
});

test('a field keeps its unit across a reload, and Settings can reset every field', async ({ page }) => {
  await page.goto('/');

  await page.locator('div[title="Nose cone"]').click();
  const card = page.locator('section').filter({ hasText: 'Shoulder capped' });
  await card.getByLabel('Component dimensions unit').first().selectOption('in');

  await page.reload();
  await page.locator('div[title="Nose cone"]').click();
  const reloaded = page.locator('section').filter({ hasText: 'Shoulder capped' });
  await expect(reloaded.getByLabel('Component dimensions unit').first()).toHaveValue('in');

  // The Units tab is the one place that can find and undo a per-field choice.
  const dialog = await openUnitsTab(page);
  await dialog.getByRole('button', { name: /Reset 1 field/ }).click();
  await closeDialog(page);
  await expect(
    page.locator('section').filter({ hasText: 'Shoulder capped' }).getByLabel('Component dimensions unit').first(),
  ).toHaveValue('cm');
});

test('a preset clears per-field choices so it actually takes effect', async ({ page }) => {
  await page.goto('/');

  await page.locator('div[title="Nose cone"]').click();
  const card = page.locator('section').filter({ hasText: 'Shoulder capped' });
  // Must differ from the default (cm), or the chip stores no override to strand.
  await card.getByLabel('Component dimensions unit').first().selectOption('mm');

  const dialog = await openUnitsTab(page);
  await dialog.getByRole('button', { name: 'Imperial defaults' }).click();
  await closeDialog(page);

  await expect(card.getByLabel('Component dimensions unit').first()).toHaveValue('in');
});

test('a length typed in inches round-trips through the SI tree', async ({ page }) => {
  await page.goto('/');

  const dialog = await openUnitsTab(page);
  await dialog.getByLabel('Component dimensions').selectOption('in');
  await closeDialog(page);

  // Tree rows carry title="<part label>", so clicking one selects that part.
  await page.locator('div[title="Body tube"]').click();
  // Scoped: the launch-conditions panel has a "Length" (the rod) of its own.
  const length = page.locator('section').filter({ hasText: 'Motor mount' }).getByLabel('Length', { exact: true });
  await expect(length).toHaveValue('16.535433');
  // Typed, not `fill()`: fill blanks the field first, and a blank geometry field
  // commits a 0-length tube that the rebuild does not recover from. (Pre-existing
  // NumberField behavior — `onChange(v ?? 0)` — not something units introduced.)
  await length.click();
  await length.press('Control+a');
  await length.pressSequentially('24');
  await expect(length).toHaveValue('24');
  await length.blur();

  // 24 in is 0.6096 m; switching the preference to mm must show exactly that,
  // not a value that has been rounded through an intermediate unit.
  const dialog2 = await openUnitsTab(page);
  await dialog2.getByLabel('Component dimensions').selectOption('mm');
  await closeDialog(page);
  await expect(length).toHaveValue('609.6');
});

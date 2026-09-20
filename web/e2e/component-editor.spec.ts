import { test, expect, runFlight, ready, box, defined } from './base';

/**
 * Guards the newly-exposed component-editor options render (and the new boolean
 * field kind doesn't crash the panel). Data round-trips are unit-tested in
 * orkFile.test.ts; this just drives the editor for a few types on the default
 * rocket. Tree rows carry title="<part label>", so clicking selects the part.
 */

test.beforeEach(async ({ page }) => {
  await ready(page);
});

test('nose-cone editor exposes shoulder fields incl. the capped toggle', async ({ page }) => {
  await page.locator('div[title="Nose cone"]').click();
  await expect(page.getByLabel('Shoulder length')).toBeVisible();
  await expect(page.getByLabel('Shoulder radius')).toBeVisible();
  await expect(page.getByLabel('Shoulder capped')).toBeVisible(); // boolean field kind
});

test('body-tube editor exposes the motor-mount toggle + overhang', async ({ page }) => {
  await page.locator('div[title="Body tube"]').click();
  const mount = page.getByLabel('Motor mount');
  await expect(mount).toBeVisible();
  await expect(page.getByLabel('Motor overhang')).toBeVisible();
});

test('fin editor exposes fin-tab fields', async ({ page }) => {
  await page.locator('div[title="Trapezoidal fin set"]').click();
  await expect(page.getByLabel('Fin tab length')).toBeVisible();
  await expect(page.getByLabel('Fin tab height')).toBeVisible();
});

test('a freeform fin can be added, shows the outline editor, and simulates', async ({ page }) => {
  // Select the body tube so the Add menu offers fin types, then add a freeform fin.
  await page.locator('div[title="Body tube"]').click();
  const addMenu = page.locator('select').filter({ hasText: 'Freeform fin set' });
  await addMenu.selectOption({ label: 'Freeform fin set' });

  // The new fin is auto-selected; its graphical outline editor renders.
  await expect(page.getByText('Fin outline')).toBeVisible();
  const editor = page.locator('svg:has(polygon)');
  await expect(editor.first()).toBeVisible();
  // The default outline has vertices (draggable circles) to shape.
  expect(await editor.locator('circle').count()).toBeGreaterThanOrEqual(4);

  // It builds + simulates end-to-end.
  await runFlight(page);
});

test('the design actions share one row above the component list', async ({ page }) => {
  // + Stage, + Add and Scale were split across the heading row and a second row
  // below it, which read as two unrelated groups and cost a row of height.
  const stage = page.getByRole('button', { name: /Stage$/ });
  // The select's accessible name is its title: "Add a part under …" when the
  // selection can host one, or "… can't contain sub-parts" when it cannot.
  const add = page.getByRole('combobox', { name: /Add a part under|contain sub-parts/i });
  const scale = page.getByRole('button', { name: /Scale/ });
  for (const el of [stage, add, scale]) await expect(el).toBeVisible();

  // Same row: their vertical centers line up.
  const boxes = await Promise.all([stage, add, scale].map((el) => box(el)));
  const first = defined(boxes[0], 'the Stage button box');
  const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
  for (const b of boxes) expect(Math.abs(mid(b) - mid(first))).toBeLessThan(6);

  // And above the list they act on.
  const heading = await box(page.getByRole('heading', { name: 'Components' }));
  for (const b of boxes) expect(b.y).toBeLessThan(heading.y);

  // Still one row at the NARROWEST the column goes, which is what TREE_PANE_MIN
  // is for. The default width was never the case at risk; the floor is, and it
  // moved down when the panel's padding came off.
  const sep = page.getByRole('separator', { name: /components panel/ });
  const b0 = await box(sep);
  await page.mouse.move(b0.x + b0.width / 2, b0.y + 200);
  await page.mouse.down();
  await page.mouse.move(5, b0.y + 200, { steps: 8 });
  await page.mouse.up();

  const tight = await Promise.all([stage, add, scale].map((el) => box(el)));
  const tightFirst = defined(tight[0], 'the Stage button box at the narrowest width');
  for (const b of tight) expect(Math.abs(mid(b) - mid(tightFirst))).toBeLessThan(6);
});

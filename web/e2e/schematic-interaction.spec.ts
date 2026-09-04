import { test, expect, type Page } from '@playwright/test';

async function dismissWip(page: Page) {
  await page.getByRole('button', { name: 'I understand' }).click({ timeout: 10_000 }).catch(() => {});
}

/**
 * 2D schematic INTERACTION coverage in a real browser — the select / hover /
 * drag-reposition / caliper paths that jsdom can't drive and the render e2e
 * (schematic.spec) doesn't touch. This is the safety net for decomposing the
 * renderer, whose shapes carry the interaction handlers.
 */
test.describe('2D schematic interaction', () => {
  const schematic = (page: Page) => page.locator('svg').filter({ has: page.locator('title') }).first();

  test('clicking a component on the canvas selects it (property editor opens)', async ({ page }) => {
    await page.goto('/');
    await dismissWip(page);
    const hint = page.getByText(/Select a component in the tree or drawing/i);
    await expect(hint).toBeVisible(); // nothing selected yet

    const svg = schematic(page);
    const box = (await svg.boundingBox())!;
    // Centerline, mid-rocket → lands on the airframe (body tube).
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height / 2);

    await expect(hint).toBeHidden(); // selection populated the property editor
  });

  test('hovering a component shows its name tag on the canvas', async ({ page }) => {
    await page.goto('/');
    await dismissWip(page);
    const svg = schematic(page);
    const box = (await svg.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2);
    await expect(svg.locator('text', { hasText: /Body tube/i })).toBeVisible();
  });

  test('dragging horizontally on the drawing rolls the rocket', async ({ page }) => {
    await page.goto('/');
    await dismissWip(page);
    // The roll slider mirrors the schematic's roll; a horizontal drag on the
    // drawing spins the fins (onMove → onRoll), so its value must change.
    const roll = page.getByRole('slider', { name: /roll/i });
    const before = await roll.inputValue();

    const svg = schematic(page);
    const box = (await svg.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, y, { steps: 15 });
    await page.mouse.up();

    await expect.poll(() => roll.inputValue()).not.toBe(before);
  });

  test('the length caliper shows a live measurement readout', async ({ page }) => {
    await page.goto('/');
    await dismissWip(page);
    await page.getByTitle(/Length calipers/i).click();
    const svg = schematic(page);
    // The caliper distance is the accent-colored "<n> cm" label.
    await expect(svg.locator('text[fill="var(--accent)"]', { hasText: /cm/ }).first()).toBeVisible();
  });
});

import { test, expect, type Page } from './base';
import { THEMES } from './axe';

/**
 * 2D schematic interaction coverage in a real browser: the select / hover /
 * roll-drag / caliper paths that jsdom can't drive and the render e2e
 * (schematic.spec) doesn't touch. The renderer's shapes carry the interaction
 * handlers, so this guards them through any change to how the shapes are built.
 *
 * Drag-reposition is not among them: there is no such path in the renderer, and a
 * component's position is set numerically in the property panel.
 */
test.describe('2D schematic interaction', () => {
  const schematic = (page: Page) =>
    page
      .locator('svg')
      .filter({ has: page.locator('title') })
      .first();

  /**
   * The screen y of the rocket's centerline: the middle of the nose cone's shape.
   * The svg's own middle is not it, because the drawing centers between the
   * ruler lanes that are on, and the default set is top and left only.
   */
  const centerlineY = async (page: Page) => {
    const nose = (await schematic(page)
      .locator('title', { hasText: /^Nose cone$/ })
      .first()
      .locator('..')
      .boundingBox())!;
    return nose.y + nose.height / 2;
  };

  /**
   * Open the app and wait for the drawing to settle before measuring it.
   *
   * These tests click at coordinates derived from the svg's bounding box, so a
   * box read while the pane is still laying out sends the click somewhere else
   * entirely. The stats strip renders once the engine has built the rocket,
   * which is also when the schematic has its final size.
   */
  const ready = async (page: Page) => {
    await page.goto('/');
    await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
  };

  test('clicking a component on the canvas selects it (property editor opens)', async ({ page }) => {
    await ready(page);
    const hint = page.getByText(/Select a component in the tree or drawing/i);
    await expect(hint).toBeVisible(); // nothing selected yet

    const svg = schematic(page);
    const box = (await svg.boundingBox())!;
    // Centerline, mid-rocket → lands on the airframe (body tube).
    await page.mouse.click(box.x + box.width * 0.45, await centerlineY(page));

    await expect(hint).toBeHidden(); // selection populated the property editor
  });

  test('hovering a component shows its name tag on the canvas', async ({ page }) => {
    await ready(page);
    const svg = schematic(page);
    const box = (await svg.boundingBox())!;
    // Two thirds back, which is airframe and nothing else: the default design
    // packs a chute, a shock cord, wadding and a lug along the forward half, and
    // the tag names whichever part is under the cursor.
    await page.mouse.move(box.x + box.width * 0.62, await centerlineY(page));
    await expect(svg.locator('text', { hasText: /Body tube/i })).toBeVisible();
  });

  test('dragging horizontally on the drawing rolls the rocket', async ({ page }) => {
    await ready(page);
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
    await ready(page);
    await page.getByTitle(/Length calipers/i).click();
    const svg = schematic(page);
    // The caliper distance is the accent-colored "<n> <unit>" label, cm by default.
    await expect(svg.locator('text[fill="var(--accent)"]', { hasText: /cm/ }).first()).toBeVisible();
  });

  /**
   * The caliper readouts are SVG text, which axe does not judge, and the
   * calipers are off in every state the axe scans see. So their contrast is
   * measured here: the accent text against the box drawn under it, in every
   * theme.
   */
  for (const theme of THEMES) {
    test(`the caliper readouts hold 4.5:1 in the ${theme} theme`, async ({ page }) => {
      await ready(page);
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.getByTitle(/Length calipers/i).click();
      await page.getByTitle(/Diameter calipers/i).click();
      const tags = schematic(page).locator('text[fill="var(--accent)"]');
      await expect(tags).toHaveCount(2);

      const ratios = await tags.evaluateAll((texts) => {
        // Through a canvas, so any color the browser resolves (oklch included)
        // comes back as sRGB.
        const ctx = document.createElement('canvas').getContext('2d')!;
        const rgb = (css: string) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = css;
          ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
        };
        const lum = (c: number[]) => {
          const [r, g, b] = c.map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        return texts.map((text) => {
          const fg = lum(rgb(getComputedStyle(text).fill));
          const bg = lum(rgb(getComputedStyle(text.previousElementSibling!).fill));
          return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        });
      });
      for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }
});

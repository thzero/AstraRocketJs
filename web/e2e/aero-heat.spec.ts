import { test, expect, type Page } from './base';

const openPerComponent = async (page: Page) => {
  await page.getByRole('button', { name: 'Aero', exact: true }).click();
  await page.getByRole('button', { name: 'Per component', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Drag by component' })).toBeVisible();
};

/** Inline background colours of one column, by its header text, in table `k`. */
const columnColours = (page: Page, table: number, header: string) =>
  page.evaluate(
    ({ k, h }) => {
      const t = document.querySelectorAll('table')[k];
      if (!t) return [];
      const heads = [...(t.querySelectorAll('thead th') ?? [])].map((x) => (x.textContent || '').trim());
      const col = heads.findIndex((x) => x === h);
      if (col < 0) return [];
      return [...t.querySelectorAll('tbody tr')].map((tr) => {
        const cell = tr.children[col] as HTMLElement | undefined;
        return cell?.style.backgroundColor || '';
      });
    },
    { k: table, h: header },
  );

/**
 * The "By heat" palette is OpenRocket's own formula, and it is anchored to an
 * ABSOLUTE Cd scale that reaches full red at 1.5. That is meaningful for drag
 * and meaningless for anything else: CNalpha runs to 15 or 20 per radian, so
 * every row would clamp to the same red and the column would say nothing.
 *
 * The stability table used to pass `heatStyle === 'openrocket' ? 'openrocket' :
 * 'sky'` for CNalpha — an identity expression, since HeatStyle has exactly two
 * members. It read as a guard and was not one.
 */
test.describe('aero table shading', () => {
  test('Cd is shaded on the OpenRocket scale, CNalpha is not', async ({ page }) => {
    await page.goto('/');
    await openPerComponent(page);

    await page.getByRole('button', { name: 'By heat', exact: true }).click();

    // Drag is genuinely on that scale, so it still shades.
    const cd = (await columnColours(page, 0, 'Cd')).filter(Boolean);
    expect(cd.length).toBeGreaterThan(0);

    // CNalpha is not, so it carries no inline colour at all — the same call the
    // roll table makes, and the same one the desktop makes by only colouring
    // its drag tab.
    const cna = (await columnColours(page, 1, 'CNα')).filter(Boolean);
    expect(cna).toEqual([]);
  });

  test('By magnitude shades CNalpha, and distinguishes its rows', async ({ page }) => {
    await page.goto('/');
    await openPerComponent(page);

    await page.getByRole('button', { name: 'By magnitude', exact: true }).click();

    const cna = (await columnColours(page, 1, 'CNα')).filter(Boolean);
    expect(cna.length).toBeGreaterThan(1);
    // The point of shading: different magnitudes must look different. Under the
    // absolute-Cd ramp every one of these clamped to the same full red.
    expect(new Set(cna).size).toBeGreaterThan(1);
  });
});

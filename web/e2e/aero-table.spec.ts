import { test, expect, type Page } from './base';

/** Rows of one table on the page: 0 is the drag breakdown, 1 the stability one. */
const rows = (page: Page, table = 0) =>
  page.evaluate(
    (k) =>
      [...(document.querySelectorAll('table')[k]?.querySelectorAll('tr') ?? [])].map((tr) =>
        [...tr.children].map((c) => (c.textContent || '').trim()),
      ),
    table,
  );

/**
 * The per-component drag table. It lives on the Aero view's "Per component"
 * pane, where a Mach slider picks the point it reports at; on the Charts pane
 * the hover crosshair sets the same value, so switching panes lands on whatever
 * you were just looking at.
 */
test.describe('aero component table', () => {
  test('adds up: the rows account for the whole rocket', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Aero', exact: true }).click();
    await page.getByRole('button', { name: 'Per component', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Drag by component' })).toBeVisible();

    const r = await rows(page);
    // Column-indexed, not position 1: the split columns appear only when the
    // kernel supplies them, so the Cd column moves.
    const cd = r[0]!.indexOf('Cd');
    expect(cd).toBeGreaterThan(0);
    const total = Number(r.find((x) => x[0] === 'Whole rocket')![cd]);
    const sum = r
      .slice(1)
      .filter((x) => x[0] !== 'Whole rocket')
      .reduce((a, x) => a + Number(x[cd]), 0);
    console.log('total', total, 'sum of rows', sum.toFixed(3));

    // The component rows sum to the whole-rocket figure, with nothing left over.
    // They did not until the kernel started reporting each component's TOTAL
    // drag rather than its PER-INSTANCE drag: a 3-fin set was contributing one
    // fin, which put 39% of the rocket's drag nowhere.
    expect(Math.abs(sum - total)).toBeLessThan(0.005);
    expect(r.some((x) => x[0] === 'Not attributed to a component')).toBe(false);
  });

  test('counts every instance of a multi-instance component', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Aero', exact: true }).click();
    await page.getByRole('button', { name: 'Per component', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Drag by component' })).toBeVisible();

    const r = await rows(page);
    const header = r[0]!;
    const fins = r.find((x) => /Fin Set/.test(x[0]!))!;
    const perInstance = header.indexOf('Per instance');
    const cd = header.indexOf('Cd');
    expect(perInstance).toBeGreaterThan(-1);

    // "0.251 × 3" per instance, 0.754 total — the default rocket has three fins.
    const [one, count] = fins[perInstance]!.split('×').map((x) => Number(x.trim()));
    console.log('fins', fins[perInstance], '->', fins[cd]);
    expect(count).toBe(3);
    expect(Number(fins[cd])).toBeCloseTo(one! * count!, 2);
  });

  test('the Mach slider drives the tables, and only lands on computed samples', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Aero', exact: true }).click();
    await page.getByRole('button', { name: 'Per component', exact: true }).click();

    const heading = page.getByRole('heading', { name: 'Drag by component' });
    const machText = () => heading.locator('xpath=following-sibling::span[1]').textContent();
    const resting = await machText();

    // Arrow keys rather than fill(): a range input steps, and stepping is the
    // behaviour under test. The slider's step is the sweep's own sampling, so
    // every stop is a Mach that was actually computed — otherwise the slider
    // reads 0.30 while the table, which snaps to the nearest sample, reads 0.29.
    const slider = page.getByLabel('Mach number for the tables');
    await slider.focus();
    for (let k = 0; k < 10; k++) await page.keyboard.press('ArrowRight');

    const moved = await machText();
    console.log('slider', resting, '->', moved);
    expect(moved).not.toBe(resting);

    // The slider's own readout and the table's heading agree, to the digit.
    const shown = await page.locator('input[type=range]').evaluate((el: HTMLInputElement) => el.value);
    expect(moved).toContain(Number(shown).toFixed(2));
  });
});

/**
 * The stability table answers "why is my CP there": a fin set carrying most of
 * the normal-force slope is what holds the CP aft. Barrowman reports a fin
 * set's CNa for the whole set, so — unlike drag — there is no per-instance
 * multiplication to get wrong here; this pins that it stays true.
 */
test.describe('aero stability table', () => {
  test('component CNa sums to the rocket, and CP is its weighted mean', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Aero', exact: true }).click();
    await page.getByRole('button', { name: 'Per component', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Stability contribution' })).toBeVisible();

    const r = await rows(page, 1);
    const head = r[0]!;
    const cp = head.findIndex((h) => h.startsWith('CP'));
    const cna = head.indexOf('CNα');
    const rocket = r.find((x) => x[0] === 'Whole rocket')!;
    const parts = r.slice(1).filter((x) => x[0] !== 'Whole rocket');

    const sumCna = parts.reduce((a, x) => a + Number(x[cna]), 0);
    console.log('rocket CNa', rocket[cna], 'sum of parts', sumCna.toFixed(2));
    expect(sumCna).toBeCloseTo(Number(rocket[cna]), 1);

    // The rocket's CP is the CNa-weighted mean of its parts' — which is the
    // arithmetic the engine does, un-weighted back out for display.
    const weighted = parts.reduce((a, x) => a + Number(x[cp]) * Number(x[cna]), 0) / sumCna;
    console.log('rocket CP', rocket[cp], 'weighted mean', weighted.toFixed(1));
    expect(weighted).toBeCloseTo(Number(rocket[cp]), 0);

    // A straight body tube carries no normal force in Barrowman, so it is left
    // out rather than shown as a row of zeros with a meaningless CP.
    expect(parts.some((x) => /Body Tube/.test(x[0]!))).toBe(false);
  });
});

test('carries the mass breakdown beside the aero figures', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Aero', exact: true }).click();
  await page.getByRole('button', { name: 'Per component', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stability contribution' })).toBeVisible();

  const r = await rows(page, 1);
  const head = r[0]!;
  // Mass comes from a different engine call than the aero sweep, keyed on the
  // component name -- so a rename on one side and not the other would show up
  // as dashes here rather than as wrong numbers.
  for (const col of ['Each (g)', 'Total (g)', 'CG (cm)']) expect(head).toContain(col);
  const fins = r.find((x) => /Fin Set/.test(x[0]!))!;
  expect(fins.some((c) => c === '—')).toBe(false);
  console.log('fins row', fins.join(' | '));
});

/**
 * Roll dynamics is shown for every fin set, canted or not. An earlier version
 * hid the section when both coefficients were zero — which is every default
 * rocket — so most people never saw it exist, let alone learned that canting the
 * fins would fill it in. Zeros are the honest answer and the desktop shows them.
 */
test('always shows roll dynamics, and fills it in once the fins are canted', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Aero', exact: true }).click();
  await page.getByRole('button', { name: 'Per component', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stability contribution' })).toBeVisible();

  // There before anything is canted, listing the fin set with zeros.
  await expect(page.getByRole('heading', { name: 'Roll dynamics' })).toBeVisible();
  const forcingNow = () =>
    page.evaluate(() => {
      const t = [...document.querySelectorAll('table')].find((x) => /Roll forcing/.test(x.textContent || ''))!;
      return Number([...t.querySelectorAll('tr')][1]!.children[1]!.textContent);
    });
  expect(await forcingNow()).toBe(0);

  await page.getByText(/Trapezoidal fin/).click();
  const cant = page.getByLabel(/cant/i).first();
  await cant.fill('');
  await cant.pressSequentially('3');
  await cant.blur();
  await page.getByRole('button', { name: 'Aero', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Roll dynamics' })).toBeVisible();
  const roll = await rows(page, 2);
  const forcing = Number(roll.find((x) => /Fin Set/.test(x[0]!))![1]);
  console.log('roll forcing at 3 deg cant', forcing);
  expect(forcing).toBeGreaterThan(0);
});

/**
 * Cell shading is a magnitude ramp: ONE hue, stronger with the value. Not the
 * desktop's green-to-red, which rotates hue 120 degrees and reads as a verdict
 * the number does not carry. This pins the encoding, not merely that cells are
 * coloured: a ramp that stopped tracking the value would still "have colour".
 */
test('shades the drag cells in proportion to the value', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Aero', exact: true }).click();
  await page.getByRole('button', { name: 'Per component', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Drag by component' })).toBeVisible();

  const cells = await page.evaluate(() => {
    const table = document.querySelectorAll('table')[0]!;
    const rows = [...table.querySelectorAll('tr')];
    const cd = [...rows[0]!.children].findIndex((c) => c.textContent!.trim() === 'Cd');
    return rows.slice(1).map((r) => {
      const td = r.children[cd] as HTMLElement;
      const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(td).backgroundColor)!;
      const parts = m[1]!.split(',').map(Number);
      return { value: Number(td.textContent), alpha: parts[3] ?? 1, rgb: parts.slice(0, 3).join(',') };
    });
  });
  console.log('cd cells', JSON.stringify(cells));

  // One hue throughout — the ramp is alpha over a single colour, not a rotation.
  expect(new Set(cells.map((c) => c.rgb)).size).toBe(1);

  // Stronger with the value, in the same order as the values themselves.
  const byValue = [...cells].sort((a, b) => a.value - b.value);
  const alphas = byValue.map((c) => c.alpha);
  expect(alphas).toEqual([...alphas].sort((a, b) => a - b));
  expect(alphas.at(-1)!).toBeGreaterThan(alphas[0]!);

  // …and short of opaque, so the text on top stays its own colour.
  expect(alphas.at(-1)!).toBeLessThan(0.6);
  await expect(page.getByText('Share of total')).toBeVisible(); // the ramp is explained
});

/**
 * The desktop's green-to-red heat, offered as a choice. It is a 120-degree hue
 * rotation on an absolute Cd scale with dark text on light cells — a different
 * encoding from the default magnitude ramp, not a recolour of it, so this checks
 * the formula reproduces rather than merely that something changed.
 */
test('offers OpenRocket’s heat as an alternative shading', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Aero', exact: true }).click();
  await page.getByRole('button', { name: 'Per component', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Drag by component' })).toBeVisible();

  // Switched from the legend itself, not from Settings: the control sits on the
  // thing it changes.
  await page.getByRole('button', { name: 'By heat' }).click();

  const cells = await page.evaluate(() => {
    const t = document.querySelectorAll('table')[0]!;
    const rows = [...t.querySelectorAll('tr')];
    const cd = [...rows[0]!.children].findIndex((c) => c.textContent!.trim() === 'Cd');
    return rows.slice(1).map((r) => {
      const td = r.children[cd] as HTMLElement;
      const st = getComputedStyle(td);
      return { value: Number(td.textContent), bg: st.backgroundColor, fg: st.color };
    });
  });
  console.log('OR heat', JSON.stringify(cells));

  // Cd 0.468 -> r=0.312, hue=0.1253, sat=0.3184, val=1 -> rgb(255,235,174).
  // Straight from ComponentAnalysisGeneralPanel's DragCellRenderer.
  const mid = cells.find((c) => c.value === 0.468)!;
  expect(mid.bg).toBe('rgb(255, 235, 174)');

  // The hue really rotates: the biggest cell is red, the smallest green-ish.
  const rgb = (s: string) => s.match(/\d+/g)!.map(Number);
  const big = rgb(cells.find((c) => c.value === 1.292)!.bg);
  const small = rgb(cells.at(-1)!.bg);
  expect(big[0]).toBeGreaterThan(big[1]!); // red dominant
  expect(small[1]).toBeGreaterThan(small[0]!); // green dominant

  // Light cells, so the text goes dark with them — the trade the desktop makes.
  expect(cells.every((c) => c.fg === 'rgb(0, 0, 0)')).toBe(true);
  await expect(page.getByText('Cd scale')).toBeVisible(); // the fixed 0–1.5 scale is named
});

/**
 * The shading switch lives on the legend, beside the ramp it changes, and writes
 * the same preference Settings does — so it sticks, and the two never disagree.
 */
test('the shading switch on the legend is the same preference as Settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Aero', exact: true }).click();
  await page.getByRole('button', { name: 'Per component', exact: true }).click();

  const magnitude = page.getByRole('button', { name: 'By magnitude' });
  const orHeat = page.getByRole('button', { name: 'By heat' });
  await expect(magnitude).toHaveAttribute('aria-pressed', 'true');

  await orHeat.click();
  await expect(orHeat).toHaveAttribute('aria-pressed', 'true');
  await expect(magnitude).toHaveAttribute('aria-pressed', 'false');

  // Settings shows what the legend just set…
  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Colors' }).click();
  const select = page.getByLabel('Cell colours');
  await expect(select).toHaveValue('openrocket');

  // …and setting it there moves the legend back.
  await select.selectOption('sky');
  await page.getByRole('button', { name: 'Close' }).first().click();
  await expect(page.getByRole('button', { name: 'By magnitude' })).toHaveAttribute('aria-pressed', 'true');
});

/**
 * Roll shading only earns its place with something to compare against: one fin
 * set is its own maximum, so every cell would sit at full tint and say nothing.
 * Most rockets have exactly one, which makes the unshaded case the common one.
 */
test('leaves a lone fin set unshaded in the roll table', async ({ page }) => {
  await page.goto('/');
  await page.getByText(/Trapezoidal fin/).click();
  await page.getByLabel('Cant angle').fill('3');
  await page.getByLabel('Cant angle').blur();
  await page.getByRole('button', { name: 'Aero', exact: true }).click();
  await page.getByRole('button', { name: 'Per component', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Roll dynamics' })).toBeVisible();

  const cells = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find((x) => /Roll forcing/.test(x.textContent || ''))!;
    return [...t.querySelectorAll('tr')]
      .slice(1)
      .flatMap((tr) => [...tr.children].map((td) => getComputedStyle(td as HTMLElement).backgroundColor));
  });
  console.log('roll cell backgrounds', JSON.stringify(cells));
  expect(cells.every((bg) => bg === 'rgba(0, 0, 0, 0)')).toBe(true);
  await expect(page.getByText('Share of the largest in each column')).toHaveCount(0);
});

import { test, expect, type Page, note, tableRows } from './base';

const openAero = async (page: Page) => {
  await page.getByRole('button', { name: 'Aero', exact: true }).click();
  await page.getByRole('button', { name: 'Per component', exact: true }).click();
};

/** The whole rocket's CP, from the stability table. NaN when a row is missing. */
const cp = async (page: Page) => {
  const rows = await tableRows(page, 'Stability contribution');
  const i = rows[0]?.findIndex((h) => h.startsWith('CP')) ?? -1;
  return Number(rows.find((r) => r[0] === 'Whole rocket')?.[i]);
};

/** The fin set's [forcing, damping], or undefined before the table has a row. */
const rollRow = async (page: Page) => {
  const rows = await tableRows(page, 'Roll dynamics');
  return rows[1]?.slice(1).map(Number);
};

/**
 * Set one flight-condition field and wait for the sweep it triggers.
 *
 * `settled` is the reading the caller is about to assert on: this polls until
 * it CHANGES, which is the only honest signal that the re-run finished. It
 * used to sleep 500 ms and hope — inside this shared helper, so every
 * assertion in the file rode on that guess.
 */
const setField = async (page: Page, label: string, value: string, settled?: () => Promise<unknown>) => {
  // By ROLE: every one of these number inputs sits beside a unit chip, and the
  // chip's accessible name is built from the field's own ("Wind direction
  // unit"), so a bare getByLabel('Wind dir') matches both.
  const before = settled ? JSON.stringify(await settled()) : null;
  await page.getByRole('spinbutton', { name: label }).fill(value);
  // The condition inputs commit on blur or Enter, not per keystroke.
  await page.getByRole('spinbutton', { name: label }).press('Enter');
  if (settled) {
    await expect
      .poll(async () => JSON.stringify(await settled()), { timeout: 15_000, message: `${label} never re-swept` })
      .not.toBe(before);
  }
};

/**
 * The flight conditions the aero sweep is flown at — angle of attack, wind
 * direction about the roll axis, and roll rate. Every sweep ran at zero for all
 * three before these were exposed, so each test here asserts the number on
 * screen actually MOVES: a control wired to nothing would look identical.
 */
test.describe('aero flight conditions', () => {
  test('angle of attack moves the CP', async ({ page }) => {
    await page.goto('/');
    await openAero(page);

    const at0 = await cp(page);
    await setField(page, 'AoA', '5', () => cp(page));
    const at5 = await cp(page);
    note('CP at AoA 0 =', at0, '| at AoA 5 =', at5);
    expect(at5).not.toBeCloseTo(at0, 1);
  });

  test('roll rate brings the damping coefficient to life', async ({ page }) => {
    await page.goto('/');
    // Damping needs fins that can roll; forcing needs them canted.
    await page.getByText(/Trapezoidal fin/).click();
    await setField(page, 'Cant angle', '3');
    await openAero(page);

    const still = await rollRow(page);
    expect(still, 'the fin set row of the roll table').toBeDefined();
    expect(still?.[1]).toBe(0); // damping opposes a roll rate; there is none yet

    // The sweep now runs off the render path, so poll the row until it moves
    // rather than reading straight after the commit.
    await setField(page, 'Roll rate', '20', () => rollRow(page));
    const rolling = await rollRow(page);
    note('roll [forcing, damping] still', still, '-> rolling', rolling);
    expect(rolling, 'the fin set row of the roll table after the roll rate').toBeDefined();
    expect(rolling?.[1]).toBeGreaterThan(0);
    expect(rolling?.[0]).toBeCloseTo(still?.[0] ?? NaN, 3); // forcing is the cant, unchanged
  });

  test('Worst finds the wind direction where the CP sits furthest forward', async ({ page }) => {
    await page.goto('/');
    // Two fins, so the CP genuinely depends on roll angle. A symmetric three-fin
    // set does not, and Worst correctly reports 0 for it — which would make this
    // test pass without proving anything.
    await page.getByText(/Trapezoidal fin/).click();
    await setField(page, 'Fin count', '2');
    await openAero(page);
    await setField(page, 'AoA', '5');

    const seen: number[] = [];
    for (const theta of ['0', '30', '60', '90']) {
      await setField(page, 'Wind dir', theta);
      seen.push(await cp(page));
    }
    note('CP across wind direction:', seen);
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(1); // it really varies

    // Worst writes the direction it found back into the field, so that is the
    // observable — not a 500 ms guess at the sweep behind it.
    const dir = page.getByRole('spinbutton', { name: 'Wind dir' });
    const beforeWorst = await dir.inputValue();
    await page.getByRole('button', { name: 'Worst' }).click();
    await expect.poll(() => dir.inputValue(), { timeout: 15_000 }).not.toBe(beforeWorst);
    // Furthest forward is the least stable, which is the point of the button.
    // Polled: the direction lands in the field one render before the deferred
    // sweep it triggers lands in the table.
    await expect.poll(() => cp(page), { timeout: 15_000 }).toBeLessThanOrEqual(Math.min(...seen) + 0.05);
    note(
      'worst wind dir =',
      await page.getByRole('spinbutton', { name: 'Wind dir' }).inputValue(),
      '-> CP',
      await cp(page),
    );
  });
});

import { test, expect, tableRows, defined } from './base';

/**
 * Two components can share a name, and by default they do: nothing forces a
 * part to be renamed, so an unnamed one takes its class default and a two-tube
 * rocket has two "Body tube"s.
 *
 * The engine facade keys its per-component maps on the component's UUID, and the
 * tables key their rows on it too. Keyed on `getName()` the two merge into a single
 * row: drag summed across both, instance count last-wins, CP averaged into a station
 * belonging to neither.
 */
test('two parts sharing a name are two rows, not one merged one', async ({ page }) => {
  await page.goto('/');

  // Both parts renamed to the same string. It has to be an exact collision:
  // renaming one to the other's displayed label is not enough, because an
  // untouched part reports the kernel's own "[BodyTube.BodyTube]" rather than
  // the "Body Tube" the table shows, so renaming only one part would pass even
  // with rows keyed on name.
  for (const part of ['Nose cone', 'Body tube']) {
    await page.locator(`div[title="${part}"]`).first().click();
    const name = page.getByLabel('Name', { exact: true });
    await name.fill('Twin');
    await name.blur();
  }

  await page.getByRole('button', { name: 'Aero', exact: true }).click();
  await page.getByRole('button', { name: 'Per component', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Drag by component' })).toBeVisible();

  // Two rows, not one merged one; merged, they would sum into a single row whose
  // Cd covers both parts and whose CP belongs to neither. Polled because the
  // engine rebuild that carries the renames is debounced.
  const twins = async () => (await tableRows(page, 'Drag by component')).filter((x) => x[0] === 'Twin');
  await expect.poll(async () => (await twins()).length).toBe(2);
  const r = await tableRows(page, 'Drag by component');

  // And the rows still account for the whole rocket: the split must not have
  // double-counted or dropped anything.
  const cd = defined(r[0], 'the drag table header row').indexOf('Cd');
  const total = Number(
    defined(
      r.find((x) => x[0] === 'Whole rocket'),
      'the Whole rocket row',
    )[cd],
  );
  const sum = r
    .slice(1)
    .filter((x) => x[0] !== 'Whole rocket')
    .reduce((a, x) => a + Number(x[cd]), 0);
  expect(sum).toBeGreaterThan(total * 0.9);
  expect(sum).toBeLessThanOrEqual(total * 1.01);
});

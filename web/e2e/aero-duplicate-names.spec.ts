import { test, expect, type Page } from '@playwright/test';

const dismiss = (page: Page) =>
  page
    .getByRole('button', { name: 'I understand' })
    .click({ timeout: 10_000 })
    .catch(() => {});

const rows = (page: Page, table = 0) =>
  page.evaluate(
    (k) =>
      [...(document.querySelectorAll('table')[k]?.querySelectorAll('tr') ?? [])].map((tr) =>
        [...tr.children].map((c) => (c.textContent || '').trim()),
      ),
    table,
  );

/**
 * Two components can share a name, and by default they do: nothing forces a
 * part to be renamed, so an unnamed one takes its class default and a two-tube
 * rocket has two "Body tube"s.
 *
 * The engine facade used to key its per-component maps on `getName()`, which
 * merged them into a single row — drag summed across both, instance count
 * last-wins, CP averaged into a station belonging to neither. The maps are keyed
 * on the component's UUID now, and the tables key their rows on it too.
 */
test('two parts sharing a name are two rows, not one merged one', async ({ page }) => {
  await page.goto('/');
  await dismiss(page);

  // Both parts renamed to the SAME string. It has to be an exact collision:
  // renaming one to the other's DISPLAYED label is not enough, because an
  // untouched part reports the kernel's own "[BodyTube.BodyTube]" rather than
  // the "Body Tube" the table shows — a version of this test that renamed only
  // one part passed against the broken engine.
  for (const part of ['Nose cone', 'Body tube']) {
    await page.locator(`div[title="${part}"]`).first().click();
    const name = page.getByLabel('Name', { exact: true });
    await name.fill('Twin');
    await name.blur();
  }

  await page.getByRole('button', { name: 'Aero', exact: true }).click();
  await page.getByRole('button', { name: 'Per component', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Drag by component' })).toBeVisible();

  const r = await rows(page);
  // Two rows, not one merged one. Before the fix these summed into a single row
  // whose Cd covered both parts and whose CP belonged to neither.
  const named = r.filter((x) => x[0] === 'Twin');
  expect(named).toHaveLength(2);

  // And the rows still account for the whole rocket — the split must not have
  // double-counted or dropped anything.
  const cd = r[0]!.indexOf('Cd');
  const total = Number(r.find((x) => x[0] === 'Whole rocket')![cd]);
  const sum = r
    .slice(1)
    .filter((x) => x[0] !== 'Whole rocket')
    .reduce((a, x) => a + Number(x[cd]), 0);
  expect(sum).toBeGreaterThan(total * 0.9);
  expect(sum).toBeLessThanOrEqual(total * 1.01);
});

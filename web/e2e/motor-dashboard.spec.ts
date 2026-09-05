import { test, expect, type Page } from '@playwright/test';

/**
 * Motor Dashboard — the standalone motor reference: a sortable grid + detail
 * pane, plus the multi-select Compare (overlay) and Combine (cluster) tools.
 * Opens from the header ☰ menu. All data is bundled → fully offline.
 */

async function dismissWip(page: Page) {
  await page
    .getByRole('button', { name: 'I understand' })
    .click({ timeout: 10_000 })
    .catch(() => {});
}

async function openDashboard(page: Page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Motor dashboard' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await dismissWip(page);
});

test('opens from the menu and shows a motor detail on row selection', async ({ page }) => {
  const dialog = await openDashboard(page);
  await dialog.getByPlaceholder(/Search by code/i).fill('C6');

  await dialog.locator('tbody tr').first().click();
  await expect(dialog.getByText('View on ThrustCurve.org')).toBeVisible();
  await expect(dialog.locator('svg').first()).toBeVisible();
});

test('grid columns are sortable (toggle asc/desc)', async ({ page }) => {
  const dialog = await openDashboard(page);
  const impulse = dialog.getByRole('button', { name: /Impulse/ });
  await impulse.click();
  await expect(impulse).toContainText('▲');
  await impulse.click();
  await expect(impulse).toContainText('▼');
});

test('column chooser adds columns and remembers them across a reload', async ({ page }) => {
  let dialog = await openDashboard(page);

  // "Peak N" is off by default.
  await expect(dialog.getByRole('button', { name: /Peak/ })).toHaveCount(0);

  // Enable Peak + a couple more via the Columns picker.
  await dialog.getByText('Columns', { exact: true }).click();
  for (const name of ['Peak N', 'Mass g', 'Type']) {
    await dialog.getByRole('checkbox', { name, exact: true }).check();
  }
  await expect(dialog.getByRole('button', { name: /Peak/ })).toBeVisible();

  // The grid's scroll container never crushes columns — cells don't wrap.
  await expect(dialog.locator('table').first()).toHaveClass(/whitespace-nowrap/);

  // The choice is remembered across a reload (persisted to localStorage).
  await page.reload();
  await dismissWip(page);
  dialog = await openDashboard(page);
  await expect(dialog.getByRole('button', { name: /Peak/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Type/ })).toBeVisible();
});

test('adding many columns scrolls the grid, it does not shove the detail pane', async ({ page }) => {
  const dialog = await openDashboard(page);
  await dialog.locator('tbody tr').first().click();
  await expect(dialog.getByText('View on ThrustCurve.org')).toBeVisible();

  // Turn on every optional column.
  await dialog.getByText('Columns', { exact: true }).click();
  for (const name of [
    'Peak N',
    'Length mm',
    'Mass g',
    'Prop g',
    'Delays',
    'Type',
    'Designation',
    'Isp s',
    'Mass frac.',
    'Sparky',
    'Curves',
  ]) {
    await dialog.getByRole('checkbox', { name, exact: true }).check();
  }
  await dialog.getByText('Columns', { exact: true }).click(); // close the dropdown

  // The detail pane is still visible — the grid absorbed the width internally…
  await expect(dialog.getByText('View on ThrustCurve.org')).toBeVisible();
  // …by overflowing its own scroll container (the reported bug was the opposite).
  const overflows = await dialog.locator('tbody').evaluate((tb) => {
    const c = tb.closest('.overflow-auto') as HTMLElement;
    return c.scrollWidth > c.clientWidth;
  });
  expect(overflows).toBe(true);
});

test('a motor with no bundled thrust curve cannot be checked', async ({ page }) => {
  const dialog = await openDashboard(page);
  // A2 (Jambol/Ultra) has no bundled curve → its checkbox is disabled and tagged.
  await expect(dialog.getByRole('checkbox', { name: 'Select A2', exact: true }).first()).toBeDisabled();
});

test('compare opens full-width, honors chosen columns, and Back returns to the grid', async ({ page }) => {
  const dialog = await openDashboard(page);

  // Enable a non-default column so we can prove Compare reflects it.
  await dialog.getByText('Columns', { exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Isp s', exact: true }).check();
  await dialog.getByText('Columns', { exact: true }).click(); // close dropdown

  const compare = dialog.getByRole('button', { name: /Compare \(/ });
  await expect(compare).toHaveCount(0); // hidden until ≥1 checked
  const boxes = dialog.locator('tbody input[type="checkbox"]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();

  // With 2+ checked the right pane becomes a call-to-action explaining the tools.
  await expect(dialog.getByText(/Overlay their thrust curves/i)).toBeVisible();
  await expect(compare).toBeEnabled();
  await compare.click();

  // Full-width compare: overlay (one line per series) + a spec table that
  // includes the chosen Isp column.
  expect(await dialog.locator('svg path[stroke]').count()).toBeGreaterThanOrEqual(2);
  await expect(dialog.getByRole('columnheader', { name: 'Isp s' })).toBeVisible();

  // Back collapses the tool and restores the grid.
  await dialog.getByRole('button', { name: /Back to list/ }).click();
  await expect(dialog.getByRole('button', { name: /Impulse/ })).toBeVisible();
});

test('combines the checked motors into one cluster curve', async ({ page }) => {
  const dialog = await openDashboard(page);
  const boxes = dialog.locator('tbody input[type="checkbox"]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();

  await dialog.getByRole('button', { name: /Combine \(/ }).click();
  await expect(dialog.getByText('Combined cluster')).toBeVisible();
  await expect(dialog.getByText(/2-motor cluster/)).toBeVisible();

  // The chart overlays each motor's own curve on the combined total.
  await expect(dialog.getByText('Combined total')).toBeVisible();
  expect(await dialog.locator('svg path[stroke]').count()).toBeGreaterThanOrEqual(3); // 2 motors + total
});

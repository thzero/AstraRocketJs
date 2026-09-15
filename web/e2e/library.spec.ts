import { test, expect, type Page } from '@playwright/test';

const dismiss = (page: Page) =>
  page
    .getByRole('button', { name: 'I understand' })
    .click({ timeout: 10_000 })
    .catch(() => {});

const openLibrary = async (page: Page) => {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Open…' }).click();
  await expect(page.getByRole('dialog', { name: 'My Rockets' })).toBeVisible();
};

/**
 * The saved-designs library.
 *
 * The first test here exists because this dialog shipped with an unbounded
 * render loop and nothing caught it: the open-effect listed `onClose` in its
 * deps, `onClose` was an inline arrow in AppHeader, and the effect's own
 * `refresh()` wrote a fresh `designs` array that AppHeader subscribes to — so
 * every refresh re-rendered AppHeader, minted a new `onClose`, and refreshed
 * again, for as long as the dialog stayed open.
 */
test.describe('design library', () => {
  test('opens and settles instead of refreshing forever', async ({ page }) => {
    // Count IndexedDB reads, not DOM mutations: each loop iteration calls
    // refresh() -> designLibrary.list() -> a store read. A MutationObserver
    // cannot see this bug at all, because re-rendering identical output mutates
    // no DOM — a version of this test built on one passed against the broken
    // code.
    await page.addInitScript(() => {
      const w = window as unknown as { __idbGets: number };
      w.__idbGets = 0;
      const orig = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (...args: [IDBValidKey | IDBKeyRange]) {
        w.__idbGets++;
        return orig.apply(this, args);
      };
    });

    await page.goto('/');
    await dismiss(page);

    await openLibrary(page);
    const panel = page.getByRole('dialog', { name: 'My Rockets' });

    const before = await page.evaluate(() => (window as unknown as { __idbGets: number }).__idbGets);
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => (window as unknown as { __idbGets: number }).__idbGets);

    // An open, settled dialog reads nothing further. The loop issued a read per
    // iteration, without limit, for as long as it stayed open.
    expect(after - before).toBeLessThan(10);
    await expect(panel).toBeVisible();
  });

  test('rename dialog stays open, and its backdrop does not close the library', async ({ page }) => {
    await page.goto('/');
    await dismiss(page);

    // Give the library something to list: Save As creates a named design.
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Save As…' }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Test Rocket');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await openLibrary(page);
    await expect(page.getByText('Test Rocket')).toBeVisible();

    // The loop re-ran `setRenaming(null)` on every iteration, so this dialog
    // used to be torn down a few ms after opening.
    await page.getByRole('button', { name: 'Rename' }).first().click();
    const rename = page.getByRole('dialog', { name: 'Rename' });
    await expect(rename).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(rename).toBeVisible();

    // Dismissing the nested dialog must not also dismiss the library behind it.
    await page.mouse.click(5, 5);
    await expect(rename).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'My Rockets' })).toBeVisible();
  });

  test('asks before deleting a saved design', async ({ page }) => {
    await page.goto('/');
    await dismiss(page);

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Save As…' }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Doomed Rocket');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await openLibrary(page);
    await page.getByRole('button', { name: 'Delete' }).first().click();

    // Cancelling keeps it: a mistap on a phone must not destroy saved work.
    const ask = page.getByRole('alertdialog');
    await expect(ask.getByText(/Delete "Doomed Rocket"\?/)).toBeVisible();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Doomed Rocket')).toBeVisible();

    // Confirming removes it.
    await page.getByRole('button', { name: 'Delete' }).first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Doomed Rocket')).toBeHidden();
  });
});

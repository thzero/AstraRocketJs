import { test, expect, importOrk, type NameClash, type Page } from './base';

const openLibrary = async (page: Page) => {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Open…' }).click();
  await expect(page.getByRole('dialog', { name: 'My Rockets' })).toBeVisible();
};

/** The page's running count of IndexedDB reads; see the init script below. */
const idbGets = (page: Page) => page.evaluate(() => (window as unknown as { __idbGets: number }).__idbGets);

/**
 * Wait for the store to go QUIET: two consecutive samples of the read counter
 * agree. A settled dialog issues no reads at all, so the first pair of samples
 * satisfies this; a refresh loop issues one per render and the samples never
 * agree, so this times out and says so, rather than a fixed sleep guessing at
 * how long "long enough to notice" is (it was 1.5 s and 1 s, and both were
 * guesses about the machine under CI).
 */
const idbSettled = async (page: Page) => {
  let prev = await idbGets(page);
  await expect
    .poll(
      async () => {
        const now = await idbGets(page);
        const stable = now === prev;
        prev = now;
        return stable;
      },
      { timeout: 10_000, message: 'IndexedDB reads never went quiet: the dialog is refreshing itself' },
    )
    .toBe(true);
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
  // Count IndexedDB reads, not DOM mutations: each loop iteration calls
  // refresh() -> designLibrary.list() -> a store read. A MutationObserver
  // cannot see this bug at all, because re-rendering identical output mutates
  // no DOM — a version of this test built on one passed against the broken
  // code.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __idbGets: number };
      w.__idbGets = 0;
      const orig = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (...args: [IDBValidKey | IDBKeyRange]) {
        w.__idbGets++;
        return orig.apply(this, args);
      };
    });
  });

  test('opens and settles instead of refreshing forever', async ({ page }) => {
    await page.goto('/');

    await openLibrary(page);
    const panel = page.getByRole('dialog', { name: 'My Rockets' });

    // An open, settled dialog reads nothing further. The loop issued a read per
    // iteration, without limit, for as long as it stayed open. Sampled AFTER
    // the open, so the one list read that opening legitimately does is not
    // counted against it.
    const before = await idbGets(page);
    await idbSettled(page);
    expect((await idbGets(page)) - before).toBeLessThan(10);
    await expect(panel).toBeVisible();
  });

  test('rename dialog stays open, and its backdrop does not close the library', async ({ page }) => {
    await page.goto('/');

    // Give the library something to list: Save As creates a named design.
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Save As…' }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Test Rocket');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await openLibrary(page);
    await expect(page.getByText('Test Rocket')).toBeVisible();

    // The loop re-ran `setRenaming(null)` on every iteration, so this dialog
    // used to be torn down a few ms after opening. The loop was a refresh loop,
    // so "the store went quiet and the dialog is still here" is the assertion.
    await page.getByRole('button', { name: 'Rename' }).first().click();
    const rename = page.getByRole('dialog', { name: 'Rename' });
    await expect(rename).toBeVisible();
    await idbSettled(page);
    await expect(rename).toBeVisible();

    // Dismissing the nested dialog must not also dismiss the library behind it.
    await page.mouse.click(5, 5);
    await expect(rename).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'My Rockets' })).toBeVisible();
  });

  test('asks before deleting a saved design', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Save As…' }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Doomed Rocket');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await openLibrary(page);
    await page.getByRole('button', { name: 'Delete' }).first().click();

    // Canceling keeps it: a mistap on a phone must not destroy saved work.
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

/**
 * The bundled OpenRocket examples, as the library's second tab.
 *
 * They are the only designs that ship WITH the app, so the failure this guards
 * is a deployment one: the files live in `public/examples/` and are listed by a
 * generated index, and neither the index nor the fetch is exercised by any
 * unit test. `exampleLibrary.test.ts` proves every file imports and flies; this
 * proves the app can actually reach one and open it.
 */
test('an example opens from the library, as its own unsaved design', async ({ page }) => {
  await page.goto('/');
  await openLibrary(page);

  const dlg = page.getByRole('dialog', { name: 'My Rockets' });
  await page.getByRole('tab', { name: 'Examples' }).click();

  // Every entry carries the author's own note under its name, which is most of
  // why the tab is worth having: a list of seventeen bare filenames does not
  // tell anyone which one to open.
  const entry = dlg.getByRole('button').filter({ hasText: 'Clustered motors' });
  await expect(entry).toBeVisible({ timeout: 15_000 });
  await expect(entry).toContainText('Cluster');

  await entry.click();
  await expect(dlg).toBeHidden();

  // It lands as an IMPORT: the file's own name and parts, and no library entry
  // of its own, so editing it can never write back over the bundled copy.
  const title = page.getByRole('button', { name: 'Edit rocket configuration' });
  await expect(title).toContainText('Clustered motors');
  // Scoped to the TREE. The name is also on four SVG <title>s in the
  // schematic, one per clustered instance, which is its own small proof the
  // cluster came through.
  await expect(page.getByRole('tree', { name: 'Components' }).getByText('Clustered Inner Tube')).toBeVisible();

  await openLibrary(page);
  await expect(page.getByRole('dialog', { name: 'My Rockets' }).getByText('No saved rockets yet')).toBeVisible();
});

/**
 * The same examples, reached the other way.
 *
 * Menu → Import → Examples is the primary route and the semantically exact
 * one — opening an example runs the identical `openOrkFile` path a picked file
 * does — so it sits beside the `.ork` import rather than beside New. The
 * library tab above is the same list mounted a second time, for the moment you
 * are browsing rather than starting.
 */
test('an example opens from Import, as its own unsaved design', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: /^Import$/ }).click();
  await page.getByRole('menuitem', { name: 'Import an example rocket' }).click();

  const dlg = page.getByRole('dialog', { name: 'Example rockets' });
  const entry = dlg.getByRole('button').filter({ hasText: 'Tube fin rocket' });
  await expect(entry).toBeVisible({ timeout: 15_000 });
  await entry.click();
  await expect(dlg).toBeHidden();

  await expect(page.getByRole('button', { name: 'Edit rocket configuration' })).toContainText('Tube fin rocket');
  await expect(page.getByRole('tree', { name: 'Components' }).getByText('Tube fin set')).toBeVisible();
});

/**
 * Re-importing a rocket does not silently stack up copies of it.
 *
 * An import gets its own library entry, which is right - it is a new design,
 * not an edit to whatever was open - but nothing looked at the NAME, so the
 * edit-in-OpenRocket-and-import-again loop filled File > Open with rows called
 * the same thing, each a real design with its own id and nothing to tell them
 * apart by.
 */
test.describe('re-importing a rocket the library already holds', () => {
  /** The rocket names File > Open lists, opening and closing the dialog. */
  const savedNames = async (page: Page): Promise<string[]> => {
    await openLibrary(page);
    const dlg = page.getByRole('dialog', { name: 'My Rockets' });
    const rows = await dlg
      .getByRole('listitem')
      .evaluateAll((els) => els.map((el) => el.querySelector('span')?.textContent ?? ''));
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    return rows;
  };

  const importTwice = async (page: Page, clash: NameClash) => {
    await importOrk(page, 'e2e/fixtures/two-stage.ork');
    // The entry is created by the DEBOUNCED autosave, so wait for it to exist
    // rather than racing the second import against the write it clashes with.
    await expect.poll(() => savedNames(page), { timeout: 20_000 }).toHaveLength(1);
    await importOrk(page, 'e2e/fixtures/two-stage.ork', clash);
  };

  test('overwriting leaves the library holding one rocket', async ({ page }) => {
    await page.goto('/');
    await importTwice(page, 'overwrite');

    // Round-tripped twice: the second read is after the import's own autosave
    // has had its chance to add a row, which is the thing being ruled out.
    expect(await savedNames(page)).toHaveLength(1);
    expect(await savedNames(page)).toHaveLength(1);
  });

  test('keeping both gives the second rocket a name of its own', async ({ page }) => {
    await page.goto('/');
    await importTwice(page, 'keepBoth');

    await expect.poll(() => savedNames(page), { timeout: 20_000 }).toHaveLength(2);
    const names = await savedNames(page);
    expect(new Set(names).size).toBe(2);
    expect(names.some((n) => n.endsWith('(2)'))).toBe(true);
  });
});

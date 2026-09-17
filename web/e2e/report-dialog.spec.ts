import { readFile } from 'node:fs/promises';
import { test, expect } from './base';

/**
 * The Rocket Design Report dialog. A MULTI-STAGE design is the whole point of
 * this suite: assembleReport() builds each stage alone (which resets the shared
 * engine) and then reinstalls a rebuilt whole-rocket handle via applyBuild. That
 * hands the store fresh `info`/`rocket` object identities, and the dialog's
 * assemble effect used to depend on them — so it assembled, rebuilt, re-ran,
 * assembled… until React tore the entire app down with "Maximum update depth
 * exceeded" and the dialog never appeared at all.
 *
 * The PDF test below is the only thing in the suite that EXECUTES
 * services/reportPdf.ts. All 447 lines of it ran at zero coverage: the unit
 * tests cannot reach it (ExportDialog pulls it in through a lazy `await
 * import`), and this spec only ever checked that the button was enabled.
 */
test.describe('Rocket Design Report dialog', () => {
  test('opens on a multi-stage design without an update loop', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    // "L/D" is the unique fineness-tile unit — its presence means the engine ran.
    await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });

    await page.setInputFiles('input[type=file]', 'e2e/fixtures/two-stage.ork');
    await expect(page.getByText('Booster').first()).toBeVisible({ timeout: 20_000 });

    await page
      .getByRole('button', { name: /menu|☰/i })
      .first()
      .click();
    await page.getByRole('menuitem', { name: /Rocket Design Report/i }).click();

    // The dialog must reach its populated state (not the "no design" fallback):
    // both stages listed and the export actions live.
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Sustainer')).toBeVisible();
    await expect(dialog.getByText('Booster')).toBeVisible();
    await expect(page.getByRole('button', { name: /Save as PDF/i })).toBeEnabled();
    await expect(page.getByRole('button', { name: /Save as CSV/i })).toBeEnabled();

    // The app is still standing — the loop used to blank the whole tree.
    await page.getByRole('button', { name: 'Close' }).first().click();
    await expect(page.getByText('L/D', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Save as PDF writes a real PDF, not an empty or truncated one', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });

    await page
      .getByRole('button', { name: /menu|☰/i })
      .first()
      .click();
    await page.getByRole('menuitem', { name: /Rocket Design Report/i }).click();
    await expect(page.getByRole('dialog').first()).toBeVisible();

    const wait = page.waitForEvent('download');
    await page.getByRole('button', { name: /Save as PDF/i }).click();
    const dl = await wait;

    expect(dl.suggestedFilename()).toMatch(/.pdf$/);
    const bytes = await readFile((await dl.path())!);
    // A WHOLE PDF: the header, and the trailer that says the cross-reference
    // table was written. A truncated stream is invisible until someone opens it.
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.subarray(-1024).toString('latin1')).toContain('%%EOF');
    // Every section is on by default, so this draws the side view, the summary
    // grid, a parts table and a template page — about 40 kB. Well under that
    // means sections fell out silently.
    expect(bytes.length).toBeGreaterThan(20_000);
    expect(errors).toEqual([]);
  });

  test('the report can be pinned to a unit system, and the choice is remembered', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });

    await page
      .getByRole('button', { name: /menu|☰/i })
      .first()
      .click();
    await page.getByRole('menuitem', { name: /Rocket Design Report/i }).click();
    let dialog = page.getByRole('dialog').first();
    await expect(dialog.getByLabel('Units')).toHaveValue('current');

    // Pin the document to imperial — the app itself stays metric, because an
    // export's units are the document's choice, not a preference change.
    await dialog.getByLabel('Units').selectOption('imperial');
    await page.getByRole('button', { name: 'Close' }).first().click();
    await expect(page.getByLabel('Length unit').first()).toHaveValue('cm');

    // It is remembered across a reload, like the other report output options.
    await page.reload();
    await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
    await page
      .getByRole('button', { name: /menu|☰/i })
      .first()
      .click();
    await page.getByRole('menuitem', { name: /Rocket Design Report/i }).click();
    dialog = page.getByRole('dialog').first();
    await expect(dialog.getByLabel('Units')).toHaveValue('imperial');
  });
});

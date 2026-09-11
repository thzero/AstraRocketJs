import { test, expect, type Page } from '@playwright/test';

// The pre-1.0 "work in progress" modal shows on a fresh context and its overlay
// swallows clicks, so every test dismisses it right after loading.
async function dismissWip(page: Page) {
  await page
    .getByRole('button', { name: 'I understand' })
    .click({ timeout: 10_000 })
    .catch(() => {});
}

/**
 * The Rocket Design Report dialog. A MULTI-STAGE design is the whole point of
 * this suite: assembleReport() builds each stage alone (which resets the shared
 * engine) and then reinstalls a rebuilt whole-rocket handle via applyBuild. That
 * hands the store fresh `info`/`rocket` object identities, and the dialog's
 * assemble effect used to depend on them — so it assembled, rebuilt, re-ran,
 * assembled… until React tore the entire app down with "Maximum update depth
 * exceeded" and the dialog never appeared at all.
 */
test.describe('Rocket Design Report dialog', () => {
  test('opens on a multi-stage design without an update loop', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await dismissWip(page);
    // "L/D" is the unique fineness-tile unit — its presence means the engine ran.
    await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });

    await page.setInputFiles('input[type=file]', 'e2e/fixtures/two-stage.ork');
    await expect(page.getByText('Booster').first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /menu|☰/i }).first().click();
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
    await page.getByRole('button', { name: '✕' }).first().click();
    await expect(page.getByText('L/D', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

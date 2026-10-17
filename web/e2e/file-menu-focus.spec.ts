import { test, expect, ready } from './base';

/**
 * A dialog opened from the File menu hands focus back to the Menu button when
 * it closes.
 *
 * The chosen item unmounts as the dialog mounts, so the dialog can only return
 * focus to where it was when it opened. Focus left on the body sends the next
 * Tab back to the top of the document.
 */

test.beforeEach(async ({ page }) => {
  await ready(page);
});

for (const item of ['About', 'Settings']) {
  test(`closing ${item} from the File menu returns focus to the Menu button`, async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Menu' });
    await trigger.click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

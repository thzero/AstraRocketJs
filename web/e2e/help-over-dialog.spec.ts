import { test, expect, openTab, ready } from './base';

/**
 * Help opened from inside another dialog sits on top of it.
 *
 * Help is mounted early in the header, before the dialogs it can be opened
 * from, so the surface the user sees on top is not the last one in the
 * document. What a browser shows and jsdom cannot: focus lands in Help and
 * stays there while the dialog underneath is still open, and Escape closes
 * Help first, then the dialog it was opened from.
 *
 * The launch site map's key note is the link, so this runs with no Esri key
 * stored (a fresh context has none).
 */

test('Help opened from the launch site map takes focus and closes first on Escape', async ({ page }) => {
  await ready(page);
  await openTab(page, 'Simulations');
  await page.getByRole('button', { name: 'Show on map' }).click();
  const map = page.getByRole('dialog', { name: 'Launch site' });
  await expect(map).toBeVisible();

  await map.getByRole('button', { name: 'How to get one' }).click();
  const help = page.getByRole('dialog', { name: 'Help' });
  await expect(help).toBeVisible();
  await expect(map).toBeVisible();

  // Focus is in Help, and stays there: the map's trap must not pull it back.
  const inHelp = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"][aria-label="Help"]'));
  await expect.poll(inHelp).toBe(true);
  await help.getByRole('button', { name: 'Close' }).focus();
  await expect.poll(inHelp).toBe(true);

  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await expect(map).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(map).toBeHidden();
});

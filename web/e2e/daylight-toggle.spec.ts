import { test, expect, ready } from './base';

/**
 * The header's daylight toggle: one tap into the high-contrast theme and one
 * back, on a phone and on a desktop alike.
 */
test('the header toggles daylight and back, on a phone and on a desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  const toggle = page.getByRole('button', { name: 'Daylight (high contrast)' });
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await theme()).toBe('daylight');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await theme()).toBe('dark');

  await page.setViewportSize({ width: 1600, height: 950 });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await theme()).toBe('daylight');
});

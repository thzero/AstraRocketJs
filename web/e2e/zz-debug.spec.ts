import { test, expect } from './base';

test('debug headings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Help' }).click();
  const dialog = page.getByRole('dialog', { name: 'Help' });
  const contents = dialog.getByRole('navigation', { name: 'Contents' });
  await contents.getByRole('button', { name: 'Designing a Rocket', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Designing a Rocket' })).toBeVisible();
  await page.waitForTimeout(1500);
  console.log('RAIL:', JSON.stringify((await contents.innerText()).split('\n').slice(0, 30)));
  const frame = page.frameLocator('iframe[title="Help"]');
  console.log('TOC links in frame:', await frame.locator('.table-of-contents a[href^="#"]').count());
  console.log('toc-desktop count:', await frame.locator('.theme-doc-toc-desktop').count());
});

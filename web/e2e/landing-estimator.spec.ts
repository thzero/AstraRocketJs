import { test, expect, ready, type Page } from './base';
import { answer } from '../tests/testing/openMeteoFixture';

/**
 * The Tools tab's landing estimator, end to end in a browser: the inputs, one
 * Estimate, the map and the numbers. Open-Meteo is answered locally (the
 * forecast from the shared fixture, the terrain as gently rising ground), so
 * nothing leaves the machine.
 */

async function answerOpenMeteo(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route(/open-meteo\.com/, async (route) => {
    const req = route.request();
    asked.push(req.url());
    const u = new URL(req.url());
    let body: unknown;
    if (u.pathname === '/v1/elevation') {
      const longitudes = u.searchParams.get('longitude')!.split(',').map(Number);
      body = { elevation: longitudes.map((lon) => 3 + (lon + 80.6) * 500) };
    } else {
      const elevation = Number(u.searchParams.get('elevation') ?? 0);
      body = answer(elevation, { start: Math.floor(Date.now() / 1000 / 3600) * 3600 - 24 * 3600, hours: 96 });
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
  return asked;
}

test('estimates a landing from the Tools tab', async ({ page }) => {
  const asked = await answerOpenMeteo(page);
  await ready(page);
  await page.getByRole('navigation', { name: 'Workbench' }).getByRole('button', { name: 'Tools', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Landing estimator' })).toBeVisible();

  await page.getByRole('radio', { name: 'Dual' }).check();
  await page.getByRole('button', { name: 'Estimate landing' }).click();

  await expect(page.getByRole('img', { name: /^Landing estimate seen from above/ })).toBeVisible();
  await expect(page.getByText('Lands at')).toBeVisible();
  await expect(page.getByText(/^An estimate from typed descent rates\. The zone covers \d+ descents/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'CC BY 4.0' })).toBeVisible();
  // The forecast, then the ground under the drift.
  expect(asked.some((u) => u.includes('/v1/forecast'))).toBe(true);
  expect(asked.some((u) => u.includes('/v1/elevation') && u.split(',').length > 50)).toBe(true);
});

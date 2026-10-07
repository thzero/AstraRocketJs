import { test, expect, openTab, ready, type Page } from './base';
import { answer } from '../tests/testing/openMeteoFixture';

/**
 * Weather from Open-Meteo, in a real browser.
 *
 * The unit tests cover the client and the dialog against a stand-in transport,
 * because jsdom does not run the sandboxed frame the requests go through. What
 * only a browser can show is what those requests actually carry: the frame is
 * there so that nothing in them names this app or the site it is served from,
 * which a page's own fetch cannot do (the browser adds `Origin` to it).
 *
 * Open-Meteo is answered locally with fixtures, so nothing here leaves the
 * machine.
 */

interface Seen {
  url: string;
  headers: Record<string, string>;
}

async function answerOpenMeteo(page: Page): Promise<Seen[]> {
  const seen: Seen[] = [];
  await page.route(/open-meteo\.com/, async (route) => {
    const req = route.request();
    seen.push({ url: req.url(), headers: await req.allHeaders() });
    const elevation = Number(new URL(req.url()).searchParams.get('elevation') ?? 0);
    const body = req.url().includes('/v1/elevation')
      ? { elevation: [elevation] }
      : answer(elevation, { start: Math.floor(Date.now() / 1000 / 3600) * 3600 - 24 * 3600, hours: 96 });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
  return seen;
}

test('a weather request names neither the app nor its site', async ({ page }) => {
  const seen = await answerOpenMeteo(page);
  await ready(page);
  await openTab(page, 'Simulations');
  await page.getByRole('button', { name: 'Get weather…' }).click();
  await page.getByRole('button', { name: 'Fetch', exact: true }).click();
  await expect(page.getByText('Atmosphere aloft')).toBeVisible();

  const site = new URL(page.url());
  expect(seen.length).toBeGreaterThan(0);
  for (const { url, headers } of seen) {
    expect(url.startsWith('https://api.open-meteo.com/')).toBe(true);
    expect(headers['origin']).toBe('null');
    expect(headers['referer']).toBeUndefined();
    expect(headers['cookie']).toBeUndefined();
    for (const value of Object.values(headers)) {
      expect(value).not.toContain(site.host);
    }
  }

  // And the answer still arrives and applies.
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText(/^Open-Meteo forecast for /)).toBeVisible();
  await expect(page.getByRole('link', { name: 'CC BY 4.0' })).toBeVisible();
});

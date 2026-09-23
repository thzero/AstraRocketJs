import { test, expect, openTab, ready, runFlight, type Page } from './base';

/**
 * The imagery laid on the 3D view's ground plane.
 *
 * The layout math is covered in `components/canvas/FlightGroundMap.test.ts`,
 * where a mirrored or misplaced map can be caught by arithmetic. What only a
 * browser can answer is whether the controls over the canvas actually reach it:
 * they sit in a DOM overlay above a WebGL canvas with orbit controls under
 * them, which is exactly the arrangement where a click goes to the wrong place.
 *
 * The provider's attribution is the proxy for "the map is drawn", and not an
 * arbitrary one: it is a condition of using the tiles, so it has to appear when
 * they do and go away when they do not.
 *
 * Tiles are answered locally with a 1x1 PNG by the shared fixture, so nothing
 * here touches Esri.
 */

const attribution = (page: Page) => page.getByText(/Imagery: Esri/);
const streetAttribution = (page: Page) => page.getByText(/OpenStreetMap contributors/);

async function flyAndOpen3D(page: Page): Promise<void> {
  await ready(page);
  await openTab(page, 'Simulations');
  // Wind, so the flight has a reach worth covering with ground.
  await page.getByLabel('Speed', { exact: true }).fill('4');
  await runFlight(page);
  await openTab(page, 'Results');
  await page.getByRole('button', { name: '3D path', exact: true }).click();
  await expect(page.locator('canvas').first()).toBeVisible();
}

/** Ask for the ground: imagery is off until somebody wants it. */
async function showGround(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Satellite', exact: true }).click();
}

/**
 * The ground plane starts bare. The trajectory is the measurement and it does
 * not need a photograph under it, so opening the view is not a reason to fetch
 * scenery from somebody else's servers.
 */
test('draws no ground imagery until it is asked for', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('arcgisonline.com')) asked.push(r.url());
  });

  await flyAndOpen3D(page);
  expect(asked).toHaveLength(0);
  await expect(attribution(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'None', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await showGround(page);
  await expect(attribution(page)).toBeVisible();
  expect(asked.length).toBeGreaterThan(0);
});

test('the ground map turns off and back on from over the canvas', async ({ page }) => {
  await flyAndOpen3D(page);
  await showGround(page);
  await expect(page.getByRole('button', { name: 'Satellite', exact: true })).toBeInViewport();
  await expect(attribution(page)).toBeVisible();

  // Off is a real choice: the ground under a trajectory is context, and
  // sometimes it is in the way.
  await page.getByRole('button', { name: 'None', exact: true }).click();
  await expect(attribution(page)).toHaveCount(0);
  // The scene itself is untouched - only the ground it stands on.
  await expect(page.locator('canvas').first()).toBeVisible();

  await page.getByRole('button', { name: 'Satellite', exact: true }).click();
  await expect(attribution(page)).toBeVisible();
});

test('the street layer swaps the ground, and its credit with it', async ({ page }) => {
  await flyAndOpen3D(page);

  await page.getByRole('button', { name: 'Street', exact: true }).click();
  await expect(streetAttribution(page)).toBeVisible();
  await expect(attribution(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Satellite', exact: true }).click();
  await expect(attribution(page)).toBeVisible();
});

/**
 * One question for the whole app, not one per view: somebody who asked for the
 * ground in 3D does not want to ask again in the plan view, and somebody who
 * turned it off does not want it back.
 */
test('the choice carries between the 3D ground and the ground track', async ({ page }) => {
  await flyAndOpen3D(page);
  await showGround(page);

  // Turned on in 3D, the plan view opens with it on too.
  await page.getByRole('button', { name: 'Ground track', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Satellite', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Imagery: Esri/)).toBeVisible();

  // And back the other way.
  await page.getByRole('button', { name: 'None', exact: true }).click();
  await page.getByRole('button', { name: '3D path', exact: true }).click();
  await expect(attribution(page)).toHaveCount(0);
});

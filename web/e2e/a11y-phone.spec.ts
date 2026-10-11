import { test, expect, ready, type Page } from './base';
import { axeViolations, THEMES } from './axe';
import {
  DESIGN_VIEWS,
  RESULT_VIEWS,
  TOOLS,
  type ConfigsTab,
  type Tab,
  type Tool,
  type ViewMode,
} from '../src/state/tabs';
import { taskTabs } from '../src/components/layout/tabTable';

/**
 * The phone layout through axe, in every theme: each button of the bottom tab
 * bar, and each view, sub-tab and tool behind it. The phone shows one pane at
 * a time and moves the editors under the tables, so its screens are not the
 * desktop's screens rearranged, and its contrast and names are scanned here.
 *
 * Runs under the Pixel 7 project only (MOBILE_SPECS, and the desktop project's
 * testIgnore, in playwright.config.ts): the desktop project scans the same
 * views at desktop width in a11y.spec.ts.
 */

/** The phone bar's labels, keyed by tab: the bar uses the short ones. */
const BAR: Record<Exclude<Tab, 'design'>, string> = {
  configs: 'Config',
  sim: 'Simulate',
  results: 'Results',
  tools: 'Tools',
};
const VIEW: Record<ViewMode, string> = {
  '2d': '2D',
  '3d': '3D',
  drag: 'Aero',
  flight: 'Flight',
  path: '3D path',
  ground: 'Ground track',
  environment: 'Environment',
};
const CONFIGS: Record<ConfigsTab, string> = { motors: 'Motors', recovery: 'Recovery', separation: 'Staging' };
const TOOL: Record<Tool, string> = { landing: 'Landing estimator', rail: 'Off the rail', chute: 'Parachute sizing' };

/** Tap a button of the bottom bar. */
async function tap(page: Page, label: string): Promise<void> {
  const button = page.getByRole('navigation', { name: 'Workbench' }).getByRole('button', { name: label, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'page');
}

/** Press a toggle button by its exact name and wait for it to report pressed. */
async function press(page: Page, name: string): Promise<void> {
  const toggle = page.getByRole('button', { name, exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}

/** Each view of a view switch, scanned in turn. */
async function scanViews(page: Page, where: string, views: readonly ViewMode[]): Promise<string[]> {
  const found: string[] = [];
  for (const view of views) {
    await press(page, VIEW[view]);
    await expect(page.getByText('Loading 3D…')).toHaveCount(0);
    if (view === 'drag') await expect(page.getByRole('img', { name: /peak .* at Mach/ }).first()).toBeVisible();
    found.push(...(await axeViolations(page, `${where} / ${VIEW[view]}`)));
  }
  return found;
}

/** What each bar button opens onto, scanned once per view, sub-tab or tool it offers. */
const SCREENS: { name: string; scan: (page: Page) => Promise<string[]> }[] = [
  {
    name: 'Rocket',
    scan: async (page) => {
      await tap(page, 'Rocket');
      return axeViolations(page, 'Rocket');
    },
  },
  {
    name: 'Sketch',
    scan: async (page) => {
      await tap(page, 'Sketch');
      return scanViews(page, 'Sketch', DESIGN_VIEWS);
    },
  },
  ...taskTabs(true).map(({ id }) => ({
    name: BAR[id as keyof typeof BAR],
    scan: async (page: Page): Promise<string[]> => {
      const label = BAR[id as keyof typeof BAR];
      await tap(page, label);
      if (id === 'results') return scanViews(page, label, RESULT_VIEWS);
      const found: string[] = [];
      if (id === 'configs') {
        for (const sub of Object.keys(CONFIGS) as ConfigsTab[]) {
          const toggle = page.getByRole('button', { name: CONFIGS[sub], exact: true });
          await toggle.click();
          await expect(toggle).toHaveAttribute('aria-current', 'true');
          found.push(...(await axeViolations(page, `${label} / ${CONFIGS[sub]}`)));
        }
      } else if (id === 'tools') {
        for (const tool of TOOLS) {
          const tab = page.getByRole('tab', { name: TOOL[tool], exact: true });
          await tab.click();
          await expect(tab).toHaveAttribute('aria-selected', 'true');
          found.push(...(await axeViolations(page, `${label} / ${TOOL[tool]}`)));
        }
      } else {
        found.push(...(await axeViolations(page, label)));
      }
      return found;
    },
  })),
  {
    name: 'Menu and Settings',
    scan: async (page) => {
      await page.getByRole('button', { name: 'Menu' }).click();
      const found = await axeViolations(page, 'Menu');
      await page.getByRole('menuitem', { name: 'Settings' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      found.push(...(await axeViolations(page, 'Settings')));
      return found;
    },
  },
];

for (const theme of THEMES) {
  test.describe(`axe on a phone in the ${theme} theme`, () => {
    for (const screen of SCREENS) {
      test(`finds nothing on ${screen.name}`, async ({ page }) => {
        test.setTimeout(120_000);
        await ready(page);
        // A run first: Results shows on the bar only once there is a flight to read.
        await page.getByRole('navigation', { name: 'Workbench' }).getByRole('button', { name: 'Simulate' }).click();
        await page.getByRole('button', { name: /Run flight simulation/ }).click();
        await expect(page.getByRole('button', { name: 'Results', exact: true })).toBeVisible({ timeout: 30_000 });
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        const found = await screen.scan(page);
        expect(found, found.join('\n')).toEqual([]);
      });
    }
  });
}

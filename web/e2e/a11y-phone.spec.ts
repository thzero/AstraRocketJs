import { test, expect, defined, ready, type Page } from './base';
import { AERO_PANE, aeroChartsDrawn, axeViolations, CONFIGS, press, THEMES, TOOL, TWO_D, VIEW } from './axe';
import { eachEditor } from './editors';
import { DESIGN_VIEWS, RESULT_VIEWS, TOOLS, type ConfigsTab, type Tab, type ViewMode } from '../src/state/tabs';
import { taskTabs } from '../src/components/layout/tabTable';

/**
 * The phone layout through axe, in every theme: each button of the bottom tab
 * bar, each view, sub-tab and tool behind it, and the editor of every part
 * type. The phone shows one pane at a time and moves the editors under the
 * tables, so its screens are not the desktop's screens rearranged, and its
 * contrast and names are scanned here.
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

/** Tap a button of the bottom bar. */
async function tap(page: Page, label: string): Promise<void> {
  const button = page.getByRole('navigation', { name: 'Workbench' }).getByRole('button', { name: label, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'page');
}

/** The panes inside a view that has a switch of its own: the 2D sides and the Aero panes. */
const PANES: Partial<Record<ViewMode, Record<string, string>>> = {
  '2d': TWO_D,
  drag: AERO_PANE,
};

/** Each view of a view switch, and each pane inside one, scanned in turn. */
async function scanViews(page: Page, where: string, views: readonly ViewMode[]): Promise<string[]> {
  const found: string[] = [];
  for (const view of views) {
    await press(page, VIEW[view]);
    await expect(page.getByText('Loading 3D…')).toHaveCount(0);
    if (view === 'drag') await aeroChartsDrawn(page);
    const panes = PANES[view];
    if (!panes) {
      found.push(...(await axeViolations(page, `${where} / ${VIEW[view]}`)));
      continue;
    }
    for (const pane of Object.values(panes)) {
      await press(page, pane);
      found.push(...(await axeViolations(page, `${where} / ${VIEW[view]} / ${pane}`)));
    }
  }
  return found;
}

/** What each bar button opens onto, scanned once per view, sub-tab or tool it offers. */
const SCREENS: { name: string; scan: (page: Page) => Promise<string[]>; timeout?: number }[] = [
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
    // The editor of every part type. On a phone it is a full-screen dialog over
    // the drawing. The phone has no tree, and the drawing does not reach every
    // part, so each part is chosen at a width that shows the tree, which also
    // opens the editor as a dialog, and the dialog is scanned at the phone's.
    name: 'Part editors',
    timeout: 300_000,
    scan: async (page) => {
      const phone = defined(page.viewportSize(), 'the phone viewport');
      const laptop = { width: 1200, height: 900 };
      const found: string[] = [];
      await page.setViewportSize(laptop);
      await eachEditor(
        page,
        async (name) => {
          await page.setViewportSize(phone);
          await expect(page.getByRole('dialog', { name: 'Edit component' })).toBeVisible();
          found.push(...(await axeViolations(page, name)));
          await page.setViewportSize(laptop);
        },
        { dialog: true },
      );
      return found;
    },
  },
  {
    // Two ticked and not flown: running them switches to Results, so the
    // editor's multi-edit banner is on screen only before a run.
    name: 'Simulate / two ticked',
    scan: async (page) => {
      await tap(page, BAR.sim);
      await page.getByRole('button', { name: 'Duplicate simulation' }).click();
      await page.getByRole('checkbox', { name: 'Select all simulations' }).check();
      await expect(page.getByRole('status').filter({ hasText: 'Editing 2 selected simulations.' })).toBeVisible();
      return axeViolations(page, 'Simulate / two ticked');
    },
  },
  {
    // An edit after the flight: the header carries the Outdated marker. The
    // launch angle is a flight input on the Simulate tab, which the phone
    // reaches without the component tree.
    name: 'Results / outdated',
    scan: async (page) => {
      await tap(page, BAR.sim);
      const angle = page.getByLabel('Angle', { exact: true });
      await angle.fill('7');
      await angle.blur();
      await tap(page, BAR.results);
      await expect(page.getByText('Outdated', { exact: true }).first()).toBeVisible();
      return axeViolations(page, 'Results / outdated');
    },
  },
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
        test.setTimeout(screen.timeout ?? 120_000);
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

import { test, expect, defined, runFlight, ready, openTab, type Page } from './base';
import { axeViolations, THEMES } from './axe';
import { answer } from '../tests/testing/openMeteoFixture';
import {
  DESIGN_VIEWS,
  RESULT_VIEWS,
  type AeroPane,
  type ConfigsTab,
  type Tool,
  type TwoDView,
  type ViewMode,
} from '../src/state/tabs';
import type { HeaderDialog, LibraryTab, SettingsTab } from '../src/components/layout/dialogKeys';

/*
 * The names of every view, keyed by the type the app switches on. A view the
 * app gains is a new member of one of these unions, and a record that lacks
 * it fails the typecheck rather than leaving a gap in the scan.
 */

const VIEW: Record<ViewMode, string> = {
  '2d': '2D',
  '3d': '3D',
  drag: 'Aero',
  flight: 'Flight',
  path: '3D path',
  ground: 'Ground track',
  environment: 'Environment',
};
const TWO_D: Record<TwoDView, string> = { side: 'Side', aft: 'Aft' };
const AERO_PANE: Record<AeroPane, string> = { charts: 'Charts', components: 'Per component' };
const CONFIGS: Record<ConfigsTab, string> = { motors: 'Motors', recovery: 'Recovery', separation: 'Staging' };
const TOOLS: Record<Tool, string> = { landing: 'Landing estimator', rail: 'Off the rail', chute: 'Parachute sizing' };
const SETTINGS: Record<SettingsTab, string> = {
  general: 'General',
  units: 'Units',
  colors: 'Colors',
  materials: 'Materials',
  playback: 'Playback',
  sketch: 'Sketch',
  sim: 'Simulation',
  launch: 'Launch',
};
const LIBRARY: Record<LibraryTab, string> = { mine: 'My rockets', examples: 'Examples' };

const keys = <K extends string>(r: Record<K, unknown>): K[] => Object.keys(r) as K[];

/** One scan: what to open. A view that reads a flight result runs one first. */
interface Scan {
  name: string;
  open: (page: Page) => Promise<void>;
}

/**
 * Switch the center pane to one of the tab's views and wait for it to draw.
 * The 3D views load their renderer on demand, and axe run over the
 * placeholder would scan text that is about to go away.
 */
async function openView(page: Page, view: ViewMode): Promise<void> {
  await press(page, VIEW[view]);
  await expect(page.getByText('Loading 3D…')).toHaveCount(0);
}

/** Press a toggle button by its exact name and wait for it to report pressed. */
async function press(page: Page, name: string): Promise<void> {
  const toggle = page.getByRole('button', { name, exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}

/** Open the Aero view and wait for the sweep, so axe reads the charts rather than "Computing…". */
async function openAero(page: Page): Promise<void> {
  await openTab(page, 'Design');
  await openView(page, 'drag');
  await expect(page.getByRole('img', { name: /peak .* at Mach/ }).first()).toBeVisible({ timeout: 20_000 });
}

/** Choose a menu entry, expanding its submenu first when it has one. */
async function menu(page: Page, item: string, parent?: 'Import' | 'Export'): Promise<void> {
  await page.getByRole('button', { name: 'Menu' }).click();
  if (parent) await page.getByRole('menuitem', { name: parent, exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** The open dialog, once it is on screen. */
async function dialogOpen(page: Page, name?: string) {
  const dialog = name ? page.getByRole('dialog', { name }) : page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Open a dialog from the menu and wait for it. */
const fromMenu =
  (item: string, parent?: 'Import' | 'Export') =>
  async (page: Page): Promise<void> => {
    await menu(page, item, parent);
    await dialogOpen(page);
  };

/** The motor dashboard with two motors checked, which is what Compare and Combine work on. */
async function dashboardWithTwo(page: Page) {
  await menu(page, 'Motor Dashboard');
  const dialog = await dialogOpen(page);
  const boxes = dialog.locator('tbody input[type="checkbox"]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  return dialog;
}

/** Answer Open-Meteo locally, as weather.spec.ts does, so nothing leaves the machine. */
async function answerOpenMeteo(page: Page): Promise<void> {
  await page.route(/open-meteo\.com/, async (route) => {
    const url = route.request().url();
    const elevation = Number(new URL(url).searchParams.get('elevation') ?? 0);
    const body = url.includes('/v1/elevation')
      ? { elevation: [elevation] }
      : answer(elevation, { start: Math.floor(Date.now() / 1000 / 3600) * 3600 - 24 * 3600, hours: 96 });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
}

/** Every workbench screen: each tab, each view of its view switch, and each sub-tab or pane inside one. */
const SCREENS: Scan[] = [
  ...keys(TWO_D).map((side): Scan => ({
    name: `Design / 2D / ${TWO_D[side]}`,
    open: async (page) => {
      await openTab(page, 'Design');
      await openView(page, '2d');
      await press(page, TWO_D[side]);
    },
  })),
  ...DESIGN_VIEWS.filter((v) => v !== '2d' && v !== 'drag').map((view): Scan => ({
    name: `Design / ${VIEW[view]}`,
    open: async (page) => {
      await openTab(page, 'Design');
      await openView(page, view);
    },
  })),
  ...keys(AERO_PANE)
    .filter((pane) => pane !== 'components')
    .map((pane): Scan => ({
      name: `Design / Aero / ${AERO_PANE[pane]}`,
      open: async (page) => {
        await openAero(page);
        await press(page, AERO_PANE[pane]);
      },
    })),
  // The per-component tables shade their cells, and each shading is a
  // different ramp under the same text, so the pane is scanned once per shading.
  ...['By magnitude', 'By heat'].map((shading): Scan => ({
    name: `Design / Aero / Per component, ${shading}`,
    open: async (page) => {
      await openAero(page);
      await press(page, AERO_PANE.components);
      await press(page, shading);
    },
  })),
  ...keys(CONFIGS).map((sub): Scan => ({
    name: `Configurations / ${CONFIGS[sub]}`,
    open: async (page) => {
      await openTab(page, 'Configurations');
      const toggle = page
        .getByRole('navigation', { name: 'Flight configurations' })
        .getByRole('button', { name: CONFIGS[sub], exact: true });
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-current', 'true');
    },
  })),
  {
    name: 'Simulations',
    open: async (page) => {
      await runFlight(page);
      await openTab(page, 'Simulations');
    },
  },
  ...RESULT_VIEWS.map((view): Scan => ({
    name: `Results / ${VIEW[view]}`,
    open: async (page) => {
      await runFlight(page);
      await openTab(page, 'Results');
      await openView(page, view);
    },
  })),
  ...keys(TOOLS).map((tool): Scan => ({
    name: `Tools / ${TOOLS[tool]}`,
    open: async (page) => {
      await openTab(page, 'Tools');
      const tab = page.getByRole('tab', { name: TOOLS[tool], exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
    },
  })),
];

/** Open a tabbed dialog from the menu on one of its tabs. */
async function dialogTab(page: Page, item: string, tab: string): Promise<void> {
  await menu(page, item);
  const dialog = await dialogOpen(page);
  const button = dialog.getByRole('tab', { name: tab, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-selected', 'true');
}

/**
 * The dialogs the menu raises, keyed by the header's own list of them, so a
 * dialog added there has to be added here. The tabbed ones and the motor
 * dashboard are scanned per tab and per pane in DIALOGS.
 */
const HEADER_DIALOGS: Record<Exclude<HeaderDialog, 'settings' | 'library' | 'motors'>, Scan['open']> = {
  report: fromMenu('Rocket Design Report'),
  about: fromMenu('About'),
  privacy: fromMenu('Privacy'),
  updates: fromMenu('Check for updates'),
  examples: fromMenu('Import an example rocket', 'Import'),
  print: fromMenu('Export printable parts as 3MF', 'Export'),
  locations: fromMenu('Launch Locations'),
  parts: fromMenu('My Parts'),
  saveAs: fromMenu('Save As…'),
};

/** Every dialog: the menu's, each tab and pane of the tabbed ones, and those raised from inside a tab. */
const DIALOGS: Scan[] = [
  ...keys(SETTINGS).map((tab): Scan => ({
    name: `Settings / ${SETTINGS[tab]}`,
    open: (page) => dialogTab(page, 'Settings', SETTINGS[tab]),
  })),
  ...keys(LIBRARY).map((tab): Scan => ({
    name: `Open / ${LIBRARY[tab]}`,
    open: (page) => dialogTab(page, 'Open…', LIBRARY[tab]),
  })),
  ...keys(HEADER_DIALOGS).map((id): Scan => ({ name: `Menu / ${id}`, open: HEADER_DIALOGS[id] })),
  {
    name: 'Motor Dashboard / detail',
    open: async (page) => {
      await menu(page, 'Motor Dashboard');
      const dialog = await dialogOpen(page);
      // A motor with a curve: the grid draws before the catalog lands, and a
      // row clicked before then is replaced under the click.
      await dialog.getByPlaceholder(/Search by code/i).fill('C6');
      const row = dialog.locator('tbody tr').first();
      await expect(row).toContainText('C6');
      await row.click();
      await expect(dialog.getByText('View on ThrustCurve.org')).toBeVisible();
    },
  },
  {
    name: 'Motor Dashboard / Compare',
    open: async (page) => {
      const dialog = await dashboardWithTwo(page);
      await dialog.getByRole('button', { name: /Compare \(/ }).click();
      await expect(dialog.getByRole('button', { name: /Back to list/ })).toBeVisible();
    },
  },
  {
    name: 'Motor Dashboard / Combine',
    open: async (page) => {
      const dialog = await dashboardWithTwo(page);
      await dialog.getByRole('button', { name: /Combine \(/ }).click();
      await expect(dialog.getByText('Combined cluster')).toBeVisible();
    },
  },
  { name: 'Help', open: fromMenu('Help') },
  { name: 'Safety', open: fromMenu('Safety') },
  {
    name: 'Motor picker',
    open: async (page) => {
      await openTab(page, 'Configurations');
      await page
        .getByRole('button', { name: /change/i })
        .first()
        .click();
      const dialog = await dialogOpen(page);
      await expect(dialog.getByRole('button', { name: 'Select', exact: true })).toBeVisible();
    },
  },
  {
    name: 'Component picker',
    open: async (page) => {
      await openTab(page, 'Design');
      await page.locator('div[title="Body tube"]').click();
      const pick = page.getByRole('button', { name: /^Select part…/ });
      await expect(pick).toBeEnabled({ timeout: 20_000 });
      await pick.click();
      const dialog = await dialogOpen(page, 'Select a part');
      await expect(dialog.locator('tbody tr').first()).toBeVisible();
    },
  },
  {
    name: 'Wind profile',
    open: async (page) => {
      await openTab(page, 'Simulations');
      await page.getByRole('radio', { name: 'Multi-level' }).check();
      await page.getByRole('button', { name: 'Edit wind profile…' }).click();
      await dialogOpen(page);
    },
  },
  {
    name: 'Weather',
    open: async (page) => {
      await answerOpenMeteo(page);
      await openTab(page, 'Simulations');
      await page.getByRole('button', { name: 'Get weather…' }).click();
      await page.getByRole('button', { name: 'Fetch', exact: true }).click();
      await expect(page.getByText('Atmosphere aloft')).toBeVisible();
    },
  },
];

/**
 * Every view through axe, in every theme. Contrast is the part the JSX lint
 * cannot see: it depends on the theme's tokens and the surface under the text,
 * so each theme is its own scan. The theme attribute is set directly; the
 * setting that normally sets it is covered in daylight-toggle.spec.ts.
 *
 * One test per theme and view, so the scans spread across the workers. An
 * axe pass over a screen with a live WebGL canvas takes several seconds on a
 * CI runner software-rendering it, after the engine boot and, for a view that
 * reads a result, a flight run.
 */
for (const theme of THEMES) {
  test.describe(`axe in the ${theme} theme`, () => {
    for (const scan of [...SCREENS, ...DIALOGS]) {
      test(`finds nothing on ${scan.name}`, async ({ page }) => {
        test.setTimeout(90_000);
        await ready(page);
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await scan.open(page);
        const found = await axeViolations(page, scan.name);
        expect(found, found.join('\n')).toEqual([]);
      });
    }
  });
}

/**
 * Keyboard and screen-reader reachability: modals close from the keyboard,
 * state is exposed rather than shown by color alone, and controls that sit
 * together carry distinct accessible names.
 */
test.describe('accessibility', () => {
  test('the export dialog closes on Escape and names its close button', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: /Rocket Design Report/i }).click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();

    // The close button carries a real accessible name, not just the ✕ glyph.
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();

    // An aria-modal overlay must have a keyboard way out.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('the settings tabs are a real tablist, not color alone', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: /Settings/i }).click();

    const tabs = page.getByRole('tab');
    expect(await tabs.count()).toBeGreaterThan(1);
    // Exactly one selected, and which one is exposed rather than implied by a
    // background color.
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
  });

  test('unit chips in the stats strip have distinct accessible names', async ({ page }) => {
    await page.goto('/');

    // Four of these are the length quantity (length, max diameter, CG, CP) and
    // two are mass. Named by quantity alone they would announce identically, so
    // each carries its own tile's name.
    //
    // Scoped to the strip: "Length unit" also exists in the launch panel (the
    // rod's length), which is a separate cross-panel collision and not what
    // this pins.
    const strip = page.locator('div.grid').filter({ hasText: 'Max diameter' }).first();
    const names = await strip.evaluate((el) =>
      [...el.querySelectorAll('select[aria-label]')].map((s) => s.getAttribute('aria-label') || ''),
    );
    expect(names.length).toBeGreaterThanOrEqual(5);
    expect(new Set(names).size).toBe(names.length);
  });

  test('no two unit chips on one screen announce the same name', async ({ page }) => {
    await page.goto('/');

    // The whole workbench at once: the stats strip, the property panel and the
    // launch panel each mint unit chips, and they must not collide across panels:
    // two "Length unit"s (the rod's and the rocket's) or two "Direction unit"s
    // (the rod's and the wind's) on screen together are indistinguishable to
    // anyone navigating by name.
    await expect(page.getByText('Max diameter')).toBeVisible();
    const names = await page.evaluate(() =>
      [...document.querySelectorAll('select[aria-label]')]
        .map((s) => s.getAttribute('aria-label') || '')
        .filter((n) => /unit/i.test(n)),
    );
    expect(names.length).toBeGreaterThan(5);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes, `duplicate unit chip names: ${[...new Set(dupes)].join(', ')}`).toEqual([]);
  });

  /**
   * An `aria-modal` dialog needs a focus trap and focus restore (`useFocusTrap`):
   * without them Tab walks out into the page behind the overlay and the trigger
   * loses focus on close.
   */
  test('a modal keeps Tab inside it and hands focus back on close', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Menu' }).click();
    const trigger = page.getByRole('menuitem', { name: /About/ });
    await trigger.click();

    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();

    // Tab all the way round; focus must never leave the panel.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const inside = await dialog.evaluate((el) => el.contains(document.activeElement));
      expect(inside, `focus escaped the dialog after ${i + 1} tabs`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('the import and export .ork menu items are told apart', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Menu' }).click();

    // Both submenus can be open at once, so two entries reading "OpenRocket
    // (.ork)" are ambiguous to a screen reader and a strict-mode violation for
    // getByRole.
    await page.getByRole('menuitem', { name: /^Import$/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Import OpenRocket (.ork)' })).toBeVisible();
  });

  /**
   * The drag curves and the flight charts show their values at a crosshair.
   * The crosshair must be movable from the keyboard as well as by pointer, or
   * those values are unreachable without a mouse.
   */
  test('the aero chart crosshair can be driven from the keyboard', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Aero', exact: true }).click();

    const chart = page.getByRole('group', { name: /arrow keys to move the crosshair/i }).first();
    await expect(chart).toBeVisible();

    // Focusing alone plants the crosshair, so there is something to read at once.
    await chart.focus();
    // The crosshair line carries a data hook so the test does not depend on
    // its color class.
    const crosshair = () => page.locator('svg line[data-crosshair]');
    // Count, not visibility: a 1px SVG <line> has no meaningful bounding box,
    // so Playwright reports it hidden even while it is drawn and positioned.
    // One per chart card: hoverM is shared, so all three track together.
    expect(await crosshair().count()).toBeGreaterThan(0);

    // Arrowing moves it: the line's x must change.
    const xAt = async () => crosshair().first().getAttribute('x1');
    const start = await xAt();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await xAt()).not.toBe(start);

    // Home and End reach the ends, and Escape puts it away.
    await page.keyboard.press('Home');
    const home = await xAt();
    await page.keyboard.press('End');
    expect(await xAt()).not.toBe(home);
    await page.keyboard.press('Escape');
    await expect(crosshair()).toHaveCount(0);
  });

  test('the flight chart crosshair can be driven from the keyboard', async ({ page }) => {
    await page.goto('/');
    await runFlight(page);
    await page.getByRole('button', { name: 'Flight', exact: true }).click();

    const charts = page.getByRole('group', { name: /arrow keys to move the crosshair/i }).first();
    await expect(charts).toBeVisible();

    // The announcement is a live region that speaks on a key step only, so a
    // pointer sweep does not flood a reader; its text is what a reader hears.
    const readout = page.locator('[role="status"][aria-live="polite"]').filter({ hasText: /\d/ }).first();
    await charts.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(readout).toHaveText(/\d/);
    const mid = defined(await readout.textContent(), 'the crosshair announcement');

    // Web-first (`toHaveText` retries) rather than a one-shot `textContent()`
    // compare: the region updates after the keypress, and a read taken before
    // it would compare the text with itself.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(readout).not.toHaveText(mid);

    await page.keyboard.press('Home');
    await expect(readout).not.toHaveText(mid);
    const atStart = defined(await readout.textContent(), 'the crosshair announcement at Home');
    await page.keyboard.press('End');
    await expect(readout).not.toHaveText(atStart);
  });

  /**
   * Each chart states its numbers in words for a screen reader: a flight panel
   * its peak and when, the flight's events in order, and a drag chart each
   * curve's peak and its Mach number. Without these, the only way to hear a
   * value is to walk the crosshair sample by sample.
   */
  test('the charts describe themselves to a screen reader', async ({ page }) => {
    await page.goto('/');
    await runFlight(page);
    await page.getByRole('button', { name: 'Flight', exact: true }).click();
    await expect(page.getByRole('img', { name: /^Altitude: peak \S+ m at [\d.]+ s$/ })).toBeVisible();
    await expect(page.getByText(/^Events: .*Apogee at [\d.]+ s/)).toHaveCount(1);

    // The drag charts are a design view, on the Design tab.
    await openTab(page, 'Design');
    await page.getByRole('button', { name: 'Aero', exact: true }).click();
    await expect(page.getByRole('img', { name: /peak .* at Mach [\d.]+/ }).first()).toBeVisible();
  });
});

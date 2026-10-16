import { existsSync } from 'node:fs';
import { test, expect, defined, runFlight, ready, openTab, importRkt, type Page, type WipState } from './base';
import { AERO_PANE, aeroChartsDrawn, axeViolations, CONFIGS, press, THEMES, TOOL, TWO_D, VIEW } from './axe';
import { DIALOG_SURFACES, type DialogSurface } from './dialogSurfaces';
import { POPUP_SURFACES, type PopupSurface } from './popupSurfaces';
import { eachEditor } from './editors';
import { answer } from '../tests/testing/openMeteoFixture';
import { DESIGN_VIEWS, RESULT_VIEWS, type ViewMode } from '../src/state/tabs';
import type { HeaderDialog, LibraryTab, SettingsTab } from '../src/components/layout/dialogKeys';

/*
 * The names of every dialog tab, keyed by the type the app switches on, as the
 * view names in axe.ts are.
 */

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
  /** The work-in-progress notice, for the one scan that is of the notice. */
  wip?: WipState;
  /**
   * A state of the app before or without the engine: `open` loads the page
   * itself, and the scan does not wait for the engine first.
   */
  boot?: true;
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

/** Open the Aero view and wait for the sweep, so axe reads the charts rather than "Computing…". */
async function openAero(page: Page): Promise<void> {
  await openTab(page, 'Design');
  await openView(page, 'drag');
  await aeroChartsDrawn(page);
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

// Playwright's cwd is web/, as in help-dialog.spec.ts.
const docsBuilt = existsSync('public/docs/index.html');

/**
 * The Help dialog opened from the menu on `item`, with its page shown and
 * settled. The docs frame stays transparent until it is ready, and the docs
 * site animates its colors as it takes the theme, so a scan that does not wait
 * reads either the loading line or colors partway through a transition. In CI
 * the docs are built before the scans; missing there, the scan fails rather
 * than passing on the "not part of this copy" note.
 */
async function helpOpen(page: Page, item: 'Help' | 'Safety') {
  await menu(page, item);
  const dialog = await dialogOpen(page);
  if (!docsBuilt) {
    if (process.env.CI) throw new Error('web/public/docs is not built; run `npm run docs:build` before the scans');
    await expect(dialog.getByText(/The documentation is not part of this copy/)).toBeVisible();
    return dialog;
  }
  const frame = dialog.locator('iframe');
  await expect(frame).toBeVisible();
  await expect(frame).not.toHaveClass(/opacity-0/, { timeout: 20_000 });
  const doc = await (await frame.elementHandle())?.contentFrame();
  if (!doc) throw new Error('the Help frame has no document');
  await doc.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    );
  });
  return dialog;
}

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

/** Open the app with the engine download held open, never answered, as a stalled network does. */
async function engineStalled(page: Page): Promise<void> {
  await page.route(/openrocket-engine|\.wasm/, () => undefined);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
}

/** Open the app with the engine download refused. */
async function engineFailed(page: Page): Promise<void> {
  await page.route(/openrocket-engine|\.wasm/, (route) => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('The physics engine could not be loaded.').first()).toBeVisible({ timeout: 20_000 });
}

/**
 * A deploy, played locally. Once the first worker is active, the page's
 * registration is given sw.js again under a query, served naming a build
 * script with a higher id, and that script is the shipped one answering with
 * the higher id. The browser installs it beside the running worker and leaves
 * it waiting, a newer build, which raises the update banner.
 *
 * A new script URL rather than `update()`: the browser's update check of the
 * same URL does not pass through the context's routes, so it would fetch the
 * shipped sw.js and find nothing new.
 */
async function updateWaiting(page: Page): Promise<void> {
  let shipped = '';
  await page.context().route(/\/sw\.js(\?.*)?$/, async (route) => {
    const url = route.request().url();
    const res = await route.fetch({ url: url.replace(/\?.*$/, '') });
    const body = await res.text();
    shipped = /sw-build-(\d+)\.js/.exec(body)?.[1] ?? '';
    const next = url.includes('?') ? String(Number(shipped) + 1) : shipped;
    await route.fulfill({ response: res, body: body.replace(`sw-build-${shipped}.js`, `sw-build-${next}.js`) });
  });
  await page.context().route(/\/sw-build-\d+\.js$/, async (route) => {
    const url = route.request().url();
    const res = await route.fetch({ url: url.replace(/sw-build-\d+/, `sw-build-${shipped}`) });
    const body = await res.text();
    const id = /sw-build-(\d+)/.exec(url)?.[1] ?? shipped;
    await route.fulfill({ response: res, body: body.replace(/build: \d+/, `build: ${id}`) });
  });
  await ready(page);
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    await navigator.serviceWorker.register(`${reg.active?.scriptURL ?? '/sw.js'}?next`, { scope: reg.scope });
  });
  await expect(page.getByText('A new version is available.')).toBeVisible({ timeout: 30_000 });
}

/** The 3D view with its code missing, as on a stale deploy: the view's fallback in its place. */
async function viewFallback(page: Page): Promise<void> {
  await page.route(/\/assets\/Rocket3D-[^/]*\.js$/, (route) => route.abort());
  await ready(page);
  await openTab(page, 'Design');
  await page.getByRole('button', { name: '3D', exact: true }).first().click();
  await expect(page.getByRole('alert').filter({ hasText: /Reload/ })).toBeVisible({ timeout: 20_000 });
}

/**
 * The screens that come up only when something goes wrong or changes under the
 * app: the engine banner while it loads, once it is stuck and when it failed;
 * the update banner; and the fallback a view shows when its code cannot load.
 * Every other scan waits for the engine first, so none of these is on screen in
 * any of them.
 */
const BOOT: Scan[] = [
  {
    name: 'Engine banner / loading',
    boot: true,
    open: async (page) => {
      await engineStalled(page);
      await expect(page.getByText('Downloading engine…').first()).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: 'Engine banner / slow',
    boot: true,
    open: async (page) => {
      await engineStalled(page);
      await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({ timeout: 40_000 });
    },
  },
  { name: 'Engine banner / failed', boot: true, open: engineFailed },
  { name: 'Update banner', boot: true, open: updateWaiting },
  { name: 'View fallback', boot: true, open: viewFallback },
];

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
    open: (page) => resultView(page, view),
  })),
  ...keys(TOOL).map((tool): Scan => ({
    name: `Tools / ${TOOL[tool]}`,
    open: (page) => openTool(page, TOOL[tool]),
  })),
  // What each tool shows once it has an answer: the landing card and its map,
  // and the flight figures, flagged ones included.
  {
    name: 'Tools / Landing estimator / estimate',
    open: async (page) => {
      await answerOpenMeteo(page);
      await openTool(page, TOOL.landing);
      await page.getByRole('button', { name: 'Estimate landing' }).click();
      await expect(page.getByText('Lands at')).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: 'Tools / Off the rail / result',
    open: async (page) => {
      await openTool(page, TOOL.rail);
      await page.getByRole('button', { name: 'Choose…' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByPlaceholder(/Search by code/i).fill('F50');
      await dialog.locator('ul li button[aria-pressed]').first().click();
      await dialog.getByRole('button', { name: 'Select', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole('region', { name: 'Off the rail result' }).getByText('Rail exit speed'),
      ).toBeVisible();
    },
  },
];

/** Open one tool on the Tools tab. */
async function openTool(page: Page, name: string): Promise<void> {
  await openTab(page, 'Tools');
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

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
 * dashboard are scanned per tab and per pane in DIALOG_SCANS.
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

/** A menu dialog's scan, under the name the header's list gives it. */
const header = (id: keyof typeof HEADER_DIALOGS): Scan => ({ name: `Menu / ${id}`, open: HEADER_DIALOGS[id] });

/** Open the Results tab on one of its views, after a flight to show. */
async function resultView(page: Page, view: ViewMode): Promise<void> {
  await runFlight(page);
  await openTab(page, 'Results');
  await openView(page, view);
}

/** Select a part by its row in the tree. */
async function selectPart(page: Page, name: string): Promise<void> {
  await openTab(page, 'Design');
  await page.getByRole('tree', { name: 'Components' }).locator(`[title="${name}"]`).first().click();
}

/** The flight path export dialog, over the 3D path view. */
async function pathExport(page: Page) {
  await resultView(page, 'path');
  await page.getByTitle('Export flight path (KML / GPX / CSV)').click();
  return dialogOpen(page, 'Export flight path');
}

/**
 * Every dialog, keyed by the component that renders it (dialogSurfaces.ts,
 * which a unit test holds to the source), so a dialog the app gains fails the
 * typecheck until it is scanned here. Each is opened the way a user opens it:
 * from the menu, on each tab and pane of the tabbed ones, and from inside a
 * tab, a part's editor or another dialog.
 */
const DIALOG_SCANS: Record<DialogSurface, Scan[]> = {
  SettingsDialog: keys(SETTINGS).map((tab): Scan => ({
    name: `Settings / ${SETTINGS[tab]}`,
    open: (page) => dialogTab(page, 'Settings', SETTINGS[tab]),
  })),
  DesignLibraryDialog: keys(LIBRARY).map((tab): Scan => ({
    name: `Open / ${LIBRARY[tab]}`,
    open: (page) => dialogTab(page, 'Open…', LIBRARY[tab]),
  })),
  ExportDialog: [
    header('report'),
    {
      name: 'Report / print settings',
      open: async (page) => {
        await HEADER_DIALOGS.report(page);
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await dialogOpen(page, 'Print settings');
      },
    },
  ],
  AboutDialog: [header('about')],
  PrivacyDialog: [header('privacy')],
  UpdateCheckDialog: [header('updates')],
  ExamplesDialog: [header('examples')],
  PrintExportDialog: [header('print')],
  LocationsDialog: [
    header('locations'),
    {
      name: 'Launch Locations / editor',
      open: async (page) => {
        await HEADER_DIALOGS.locations(page);
        await page.getByRole('button', { name: 'New location' }).click();
        await expect(page.getByRole('dialog').getByRole('spinbutton').first()).toBeVisible();
      },
    },
  ],
  SavedPartsDialog: [header('parts')],
  DesignPropertiesDialog: [header('saveAs')],
  MotorDashboard: [
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
  ],
  HelpDialog: [
    {
      name: 'Help',
      open: async (page) => {
        await helpOpen(page, 'Help');
      },
    },
    {
      name: 'Safety',
      open: async (page) => {
        await helpOpen(page, 'Safety');
      },
    },
  ],
  MotorDialog: [
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
  ],
  MotorSpecDialog: [
    {
      name: 'Motor thrust curve',
      open: async (page) => {
        await openTab(page, 'Configurations');
        await page.getByRole('button', { name: 'Thrust curve', exact: true }).first().click();
        await dialogOpen(page);
      },
    },
  ],
  ComponentPicker: [
    {
      name: 'Component picker',
      open: async (page) => {
        await selectPart(page, 'Body tube');
        const pick = page.getByRole('button', { name: /^Select part…/ });
        await expect(pick).toBeEnabled({ timeout: 20_000 });
        await pick.click();
        const dialog = await dialogOpen(page, 'Select a part');
        await expect(dialog.locator('tbody tr').first()).toBeVisible();
      },
    },
  ],
  SavePartButton: [
    {
      name: 'Save as part',
      open: async (page) => {
        await selectPart(page, 'Body tube');
        await page.getByRole('button', { name: 'Save as part' }).click();
        await dialogOpen(page, 'Save as a reusable part');
      },
    },
  ],
  RecoverySizingReadout: [
    {
      name: 'Descent sizing',
      open: async (page) => {
        await selectPart(page, 'Parachute');
        await page.getByRole('button', { name: 'Descent sizing…' }).click();
        await dialogOpen(page, 'Descent sizing');
      },
    },
  ],
  // Under `2xl`, a laptop's width, the part editor is a dialog over the drawing.
  ComponentDialog: [
    {
      name: 'Component editor',
      open: async (page) => {
        await page.setViewportSize({ width: 1200, height: 900 });
        await selectPart(page, 'Nose cone');
        await dialogOpen(page, 'Edit component');
      },
    },
  ],
  RocketConfigDialog: [
    {
      name: 'Rocket configuration',
      open: async (page) => {
        await openTab(page, 'Design');
        await page.getByRole('button', { name: 'Edit rocket configuration' }).click();
        await dialogOpen(page, 'Rocket configuration');
      },
    },
  ],
  ScaleDialog: [
    {
      name: 'Scale',
      open: async (page) => {
        await openTab(page, 'Design');
        await page.getByRole('button', { name: /Scale/ }).first().click();
        await dialogOpen(page, 'Scale rocket');
      },
    },
  ],
  WindProfileDialog: [
    {
      name: 'Wind profile',
      open: async (page) => {
        await openTab(page, 'Simulations');
        await page.getByRole('radio', { name: 'Multi-level' }).check();
        await page.getByRole('button', { name: 'Edit wind profile…' }).click();
        await dialogOpen(page);
      },
    },
  ],
  WeatherDialog: [
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
  ],
  PlaceSearchDialog: [
    {
      name: 'Find a place',
      open: async (page) => {
        // Coordinates, so the one lookup is the elevation, answered locally.
        await answerOpenMeteo(page);
        await openTab(page, 'Simulations');
        await page.getByRole('button', { name: 'Find a place' }).first().click();
        const dialog = await dialogOpen(page);
        const field = dialog.getByRole('textbox');
        await field.fill('39.05, -104.8');
        await field.press('Enter');
        await expect(dialog.getByRole('listitem').getByRole('button')).toBeEnabled();
      },
    },
  ],
  SiteMapDialog: [
    {
      name: 'Launch site map',
      open: async (page) => {
        await openTab(page, 'Simulations');
        await page.getByLabel('Latitude', { exact: true }).fill('39.05');
        await page.getByLabel('Longitude', { exact: true }).fill('-104.8');
        // Off the number field first, so the coordinates commit.
        await page.getByText('LAUNCH SITE').click();
        await page.getByRole('button', { name: 'Show on map' }).click();
        const dialog = await dialogOpen(page, 'Launch site');
        await expect(dialog.locator('img').first()).toBeVisible();
      },
    },
  ],
  FlightCsvDialog: [
    {
      name: 'Flight data CSV',
      open: async (page) => {
        await resultView(page, 'flight');
        await page.getByRole('button', { name: 'Download flight data (.csv)' }).first().click();
        await dialogOpen(page);
      },
    },
  ],
  FlightPathExport: [
    {
      name: 'Flight path export',
      open: async (page) => {
        await pathExport(page);
      },
    },
  ],
  StageColorDialog: [
    {
      name: 'Flight path export / stage colors',
      open: async (page) => {
        const dialog = await pathExport(page);
        await dialog.getByRole('button', { name: 'Stage colors…' }).click();
        await dialogOpen(page, 'Stage colors');
      },
    },
  ],
  ConfirmDialog: [
    {
      name: 'Confirm',
      open: async (page) => {
        await menu(page, 'Settings');
        const settings = await dialogOpen(page);
        await settings.getByRole('button', { name: 'Reset all' }).click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
      },
    },
  ],
  WorkInProgressDialog: [
    {
      name: 'Work in progress',
      wip: 'shown',
      open: async (page) => {
        await expect(page.getByRole('alertdialog')).toBeVisible();
      },
    },
  ],
};

/** Open a popup by its trigger and wait for the menu it opens. */
async function openMenu(page: Page, trigger: ReturnType<Page['getByRole']>): Promise<void> {
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menu').first()).toBeVisible();
}

/** Turn a disclosure from the state the page opens it in to the other. */
async function toggle(fold: ReturnType<Page['getByRole']>): Promise<void> {
  const was = await fold.getAttribute('aria-expanded');
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', was === 'true' ? 'false' : 'true');
}

/** Open a native `<details>` by its summary and wait for it to be open. */
async function openDetails(summary: ReturnType<Page['locator']>): Promise<void> {
  await summary.click();
  await expect(summary.locator('xpath=..')).toHaveAttribute('open', '');
}

/**
 * Every popup and disclosure, keyed by the component that renders it
 * (popupSurfaces.ts, which a unit test holds to the source), each scanned in
 * a state the page does not open in: a menu or a panel opened, a fold that
 * starts open folded. The import notes are the exception: they open by default
 * and are scanned open. A popup the app gains fails the typecheck until it is here.
 */
const POPUP_SCANS: Record<PopupSurface, Scan[]> = {
  CheckMenu: [
    {
      name: 'Popup / dashboard columns',
      open: async (page) => {
        await menu(page, 'Motor Dashboard');
        const dialog = await dialogOpen(page);
        await openDetails(dialog.locator('summary', { hasText: 'Columns' }));
      },
    },
    {
      name: 'Popup / motor manufacturers',
      open: async (page) => {
        await openTool(page, TOOL.rail);
        await page.getByRole('button', { name: 'Choose…' }).click();
        const dialog = await dialogOpen(page);
        await openDetails(dialog.locator('summary', { hasText: 'All manufacturers' }).first());
      },
    },
  ],
  ComponentExportButton: [
    {
      name: 'Popup / part export menu',
      open: async (page) => {
        await openTab(page, 'Design');
        const tree = page.getByRole('tree', { name: 'Components' });
        await openMenu(page, tree.getByRole('button', { name: 'Export', exact: true }).first());
      },
    },
  ],
  ComponentTree: [
    {
      name: 'Popup / component list folded',
      open: async (page) => {
        await openTab(page, 'Design');
        // Named by its heading; the title says which way it turns.
        await toggle(page.getByTitle(/the component list/));
      },
    },
    {
      name: 'Popup / component row folded',
      open: async (page) => {
        await openTab(page, 'Design');
        const tree = page.getByRole('tree', { name: 'Components' });
        const row = tree.locator('[role="treeitem"][aria-expanded="true"]').first();
        await row.getByRole('button', { name: 'Collapse' }).click();
        await expect(tree.locator('[role="treeitem"][aria-expanded="false"]').first()).toBeVisible();
      },
    },
  ],
  FileMenu: [
    {
      name: 'Popup / menu',
      open: async (page) => {
        await openMenu(page, page.getByRole('button', { name: 'Menu' }));
      },
    },
    {
      name: 'Popup / menu / Import',
      open: async (page) => {
        await page.getByRole('button', { name: 'Menu' }).click();
        await toggle(page.getByRole('menuitem', { name: 'Import', exact: true }));
      },
    },
  ],
  GroundTrack: [
    {
      name: 'Popup / drift sweep',
      open: async (page) => {
        await resultView(page, 'ground');
        await toggle(page.getByRole('button', { name: /^Drift/ }));
        await expect(page.getByRole('heading', { name: 'Drift sweep' })).toBeVisible();
      },
    },
  ],
  HelpDialog: [
    {
      name: 'Popup / help contents',
      open: async (page) => {
        const dialog = await helpOpen(page, 'Help');
        const contents = dialog.getByRole('button', { name: 'Contents' });
        await expect(contents).toBeVisible({ timeout: 20_000 });
        await toggle(contents);
      },
    },
  ],
  ImageExportMenu: [
    {
      name: 'Popup / image export menu',
      open: async (page) => {
        await openTab(page, 'Design');
        await openView(page, '2d');
        await openMenu(page, page.getByRole('button', { name: 'Image', exact: true }).first());
      },
    },
  ],
  LoadedBanner: [
    {
      name: 'Popup / import notes',
      open: async (page) => {
        await importRkt(page, 'e2e/fixtures/rocksim.rkt', 'RockSim Bird');
        const notes = page.getByRole('button', { name: /import note/ });
        if ((await notes.getAttribute('aria-expanded')) !== 'true') await notes.click();
        await expect(notes).toHaveAttribute('aria-expanded', 'true');
      },
    },
  ],
  OffTheRail: [
    {
      name: 'Popup / Off the rail forecast',
      open: async (page) => {
        await openTool(page, TOOL.rail);
        await openDetails(page.locator('summary', { hasText: 'Wind from a forecast' }));
      },
    },
  ],
  ResultPicker: [
    {
      name: 'Popup / flight picker',
      open: async (page) => {
        // The picker is there once one run has flown two simulations.
        await ready(page);
        await openTab(page, 'Simulations');
        await page.getByRole('button', { name: 'Duplicate simulation' }).click();
        await page.getByRole('checkbox', { name: 'Select all simulations' }).check();
        await page.getByRole('button', { name: 'Run 2 simulations' }).click();
        await openMenu(page, page.getByRole('button', { name: /^Choose which flight to show/ }));
      },
    },
  ],
  SimSummary: [
    {
      name: 'Popup / safety card folded',
      open: async (page) => {
        await runFlight(page);
        await openTab(page, 'Results');
        // Folding it asks for an acknowledgment first.
        const fold = page.getByRole('button', { name: 'Before you fly' }).first();
        await fold.click();
        await page.getByRole('alertdialog').getByRole('button', { name: 'I understand' }).click();
        await expect(fold).toHaveAttribute('aria-expanded', 'false');
      },
    },
  ],
  StabilityBadge: [
    {
      name: 'Popup / statistics folded',
      open: async (page) => {
        await openTab(page, 'Design');
        await toggle(page.getByRole('button', { name: /Static statistics/ }).first());
      },
    },
  ],
};
const POPUPS: Scan[] = keys(POPUP_SCANS).flatMap((id) => POPUP_SCANS[id]);

// A component with two popups needs two scans.
for (const id of keys(POPUP_SCANS)) {
  if (POPUP_SCANS[id].length < POPUP_SURFACES[id]) throw new Error(`${id} renders more popups than are scanned`);
}

// A component with two dialogs needs two scans, and a menu dialog its own.
for (const id of keys(DIALOG_SCANS)) {
  if (DIALOG_SCANS[id].length < DIALOG_SURFACES[id]) throw new Error(`${id} renders more dialogs than are scanned`);
}
const DIALOGS: Scan[] = keys(DIALOG_SCANS).flatMap((id) => DIALOG_SCANS[id]);
for (const id of keys(HEADER_DIALOGS)) {
  if (!DIALOGS.some((d) => d.name === `Menu / ${id}`)) throw new Error(`the menu's ${id} dialog is not scanned`);
}

/**
 * Every view through axe, in every theme. Contrast is the part the JSX lint
 * cannot see: it depends on the theme's tokens and the surface under the text,
 * so each theme is its own scan. The theme attribute is set directly; the
 * setting that normally sets it is covered in daylight-toggle.spec.ts.
 *
 * One test per theme and view, so the scans spread across the workers. An
 * axe pass over a screen with a live WebGL canvas takes several seconds on a
 * CI runner software-rendering it, after the engine boot and, for a view that
 * reads a result, a flight run. The part editors are one test per theme: one
 * page load, each part selected in turn.
 */
for (const theme of THEMES) {
  test.describe(`axe in the ${theme} theme`, () => {
    for (const scan of [...SCREENS, ...DIALOGS, ...POPUPS, ...BOOT]) {
      test.describe(() => {
        if (scan.wip) test.use({ wip: scan.wip });
        const themed = (page: Page) =>
          page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        // A boot scan loads the page itself; every other one opens on the app
        // with the engine up.
        const start = scan.boot
          ? async (page: Page) => {
              await scan.open(page);
              await themed(page);
            }
          : async (page: Page) => {
              await ready(page);
              await themed(page);
              await scan.open(page);
            };

        test(`finds nothing on ${scan.name}`, async ({ page }) => {
          test.setTimeout(90_000);
          await start(page);
          const found = await axeViolations(page, scan.name);
          expect(found, found.join('\n')).toEqual([]);
        });
      });
    }

    test('finds nothing on any part editor', async ({ page }) => {
      test.setTimeout(240_000);
      await ready(page);
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      const found: string[] = [];
      await eachEditor(page, async (name) => {
        found.push(...(await axeViolations(page, name)));
      });
      expect(found, found.join('\n')).toEqual([]);
    });
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

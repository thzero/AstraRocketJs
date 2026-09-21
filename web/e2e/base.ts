import { test as base, expect, type Locator, type Page } from '@playwright/test';

/** Mirrors `KEY` in src/services/settings.ts. */
const SETTINGS_KEY = 'astrarrocketjs:settings:v1';

export type WipState = 'acknowledged' | 'shown';

/**
 * The shared `test`, which arrives with the pre-1.0 work-in-progress notice
 * already out of the way.
 *
 * Every spec used to open with its own copy of
 *
 *     page.getByRole('button', { name: 'I understand' })
 *       .click({ timeout: 10_000 })
 *       .catch(() => {});
 *
 * — twenty definitions and seventy-six calls, each swallowing its own failure.
 * That `.catch` is why a slow boot never reported "the notice would not go
 * away": it reported, twenty steps later, that some unrelated click had been
 * intercepted by `div.fixed.inset-0.z-[60]`, which is the notice's backdrop.
 *
 * The notice is gated on a stored flag (WorkInProgressDialog.tsx:16), so this
 * sets the flag rather than racing the button, and e2e/wip-gate.spec.ts is now
 * the one place that exercises the gate itself. A spec that wants to SEE the
 * notice asks for it:
 *
 *     test.use({ wip: 'shown' });
 *
 * The seed MERGES into whatever is already stored, and has to keep doing so:
 * it runs on every navigation, `page.reload()` included, and a dozen specs
 * reload precisely to prove a preference survived. Overwriting the blob would
 * erase the thing they assert.
 */
export const test = base.extend<{ wip: WipState }>({
  wip: ['acknowledged', { option: true }],
  // `run`, not Playwright's usual `use`: eslint's react-hooks rule reads a bare
  // `use(...)` as the React hook and rejects it outside a component.
  page: async ({ page, wip }, run) => {
    if (wip === 'acknowledged') {
      await page.addInitScript((key: string) => {
        const stored = (): Record<string, unknown> => {
          try {
            return (JSON.parse(localStorage.getItem(key) || '{}') as Record<string, unknown>) ?? {};
          } catch {
            return {}; // a corrupt blob; the app discards it too, so start clean
          }
        };
        try {
          localStorage.setItem(key, JSON.stringify({ ...stored(), wipAcknowledged: true }));
        } catch {
          // An opaque origin (about:blank) has no usable storage. The real
          // navigation into the app runs this again, where it does.
        }
      }, SETTINGS_KEY);
    }
    // Map tiles never leave the test runner.
    //
    // `components/sim/SiteMap.tsx` requests real tiles from Esri. A suite that
    // actually fetched them would be slow, would fail on a machine with no
    // network, and would put a CI job's worth of load on someone else's tile
    // servers for pictures nothing asserts against. Every tile is answered
    // locally with a 1x1 PNG, which is all the component needs to see to
    // report that imagery loaded.
    await page.route(/arcgisonline\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }),
    );
    await run(page);
  },
});

/** A 1x1 transparent PNG, standing in for every map tile. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export { expect };
export type { Locator, Page } from '@playwright/test';

/**
 * A diagnostic that does NOT print on a green run.
 *
 * `console.log` in a spec lands in GitHub's annotation stream every time the
 * suite passes (playwright.config.ts uses the `github` reporter under CI), so
 * two dozen of them turned every successful run into a wall of numbers. A
 * Playwright annotation carries the same information into the report, where it
 * is there when you are reading a failure and invisible when you are not.
 */
export const note = (...parts: unknown[]): void => {
  test.info().annotations.push({
    type: 'note',
    description: parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '),
  });
};

/**
 * Wait for the DEBOUNCED autosave to reach IndexedDB, rather than guessing.
 *
 * Several specs slept 700 ms before `page.reload()` to cover a 500 ms debounce
 * plus an async IndexedDB write. That is a guess at two variable delays, and on
 * a loaded machine it loses — which is how `recovery.spec.ts` failed twice in
 * one afternoon while passing in isolation. This polls the actual store, so it
 * returns as soon as the write lands and fails loudly if it never does.
 *
 * `needle` is matched against every stored value; `atLeast` counts occurrences,
 * so "two simulations" can be expressed as a per-simulation marker seen twice.
 */
export async function autosaved(page: Page, needle: string, atLeast = 1): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (n) =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open('astrarrocketjs');
              req.onerror = () => resolve(-1);
              req.onsuccess = () => {
                let tx;
                try {
                  tx = req.result.transaction('kv', 'readonly');
                } catch {
                  return resolve(-1); // store not created yet
                }
                const all = tx.objectStore('kv').getAll();
                all.onerror = () => resolve(-1);
                all.onsuccess = () =>
                  resolve(
                    all.result
                      .filter((v): v is string => typeof v === 'string')
                      .reduce((sum, v) => sum + v.split(n).length - 1, 0),
                  );
              };
            }),
          needle,
        ),
      { timeout: 15_000, message: `autosave never wrote ${atLeast}x ${needle}` },
    )
    .toBeGreaterThanOrEqual(atLeast);
}

/**
 * Open a workbench tab (Design · Simulations · Results).
 *
 * The workbench is tabbed at every width now, so the design editor, the
 * simulation controls and the flight charts are no longer all on screen at once
 * the way the old three-pane desktop layout had them. A spec that edits a part
 * and then runs a simulation has to say where it is going.
 *
 * Scoped to the desktop strip by its label: the phone's bottom bar carries
 * overlapping names ("Simulate", "Results") and both are in the DOM at once.
 */
export async function openTab(page: Page, name: 'Design' | 'Simulations' | 'Results'): Promise<void> {
  await page.getByRole('navigation', { name: 'Workbench' }).getByRole('button', { name, exact: true }).click();
}

/**
 * The primary Run control, which becomes Cancel while a batch is in flight.
 *
 * Matched by its exact labels rather than /^Run/: the simulations toolbar has a
 * "Run outdated (n)" button too, and a loose prefix matches both.
 */
export function runButton(page: Page) {
  return page.getByRole('button', { name: /^(Run flight simulation|Run \d+ simulations|Cancel run)$/ });
}

/**
 * Run the active simulation and wait for its result.
 *
 * Running lives on the Simulations tab; a finished run moves itself to Results,
 * which is where the Flight view switch appears. Waiting on that button is
 * waiting on the result, without a sleep.
 */
export async function runFlight(page: Page): Promise<void> {
  await openTab(page, 'Simulations');
  await page.getByRole('button', { name: /Run flight simulation/ }).click();
  await expect(page.getByRole('button', { name: 'Flight', exact: true })).toBeVisible({ timeout: 30_000 });
}

/**
 * Open the app and wait for the engine to have run on the default design.
 *
 * "L/D" is the unique fineness-tile unit in the statistics strip, so its
 * presence means the WASM kernel loaded, built the rocket and reported real
 * numbers. Every spec that clicks into the design needs that first, and the
 * goto-plus-wait pair was copied 18 times in mobile-layout.spec.ts alone, with
 * the timeout sometimes stated and sometimes left at the 5 s default.
 *
 * 20 s: the kernel is a 2.9 MB WASM module that is compiled on first load, and
 * a cold CI runner software-rendering WebGL beside it has been seen to take
 * more than the default.
 */
export async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
}

/**
 * Import a fixture `.ork` and WAIT for the design to land.
 *
 * `setInputFiles` returns as soon as the file is handed over; the parse, the
 * tree swap and the engine rebuild are all async after that. Without a
 * synchronization point the next click can run against the default rocket, and
 * the assertion then fails for a reason that has nothing to do with the feature.
 * The Booster stage is unique to these fixtures, so its appearance in the tree
 * means the import has actually been applied.
 *
 * Waits for the engine to have run on the DEFAULT design first, so this works
 * straight after `page.goto` and after `page.reload` alike.
 */
export async function importOrk(page: Page, fixture: string): Promise<void> {
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
  // Scoped by `accept`: the header carries one hidden input per readable
  // format (.ork and .rkt), so a bare `input[type=file]` is now ambiguous.
  await page.locator('input[accept=".ork"]').setInputFiles(fixture);
  await expect(page.getByText('Booster').first()).toBeVisible({ timeout: 20_000 });
}

/**
 * Import a fixture `.rkt` and wait for the design to land.
 *
 * Waits on the design's NAME rather than a "Booster" row: the RockSim fixture
 * is single-stage, and the tree shows a Sustainer whether or not an import
 * happened, so that is not a synchronization point.
 */
export async function importRkt(page: Page, fixture: string, designName: string): Promise<void> {
  await expect(page.getByText('L/D', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.locator('input[accept=".rkt"]').setInputFiles(fixture);
  await expect(page.getByRole('button', { name: 'Edit rocket configuration' })).toContainText(designName, {
    timeout: 20_000,
  });
}

/**
 * A value that the spec REQUIRES to exist, named.
 *
 * `noUncheckedIndexedAccess` makes every `rows[0]` and `find()` result
 * possibly-undefined, and the specs answered with `!`. A `!` that misses throws
 * "Cannot read properties of undefined (reading 'indexOf')" from somewhere in
 * the arithmetic below it; this fails on the line that looked, and says what it
 * was looking for.
 */
export function defined<T>(value: T | undefined | null, what: string): T {
  expect(value, `${what} was not found`).toBeDefined();
  expect(value, `${what} was not found`).not.toBeNull();
  return value as T;
}

/**
 * `boundingBox()` that fails on the element, not later.
 *
 * Playwright returns null for an element that is not rendered, and the specs
 * followed every call with `!`; a hidden pane then failed as "Cannot read
 * properties of null (reading 'width')" a few lines down. The locator's own
 * description goes in the message, so the failure says which box was missing.
 */
export async function box(target: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await target.boundingBox();
  if (!b) throw new Error(`${String(target)} has no bounding box: not rendered, or detached`);
  return b;
}

/**
 * The table that a heading introduces.
 *
 * The aero tables carry no accessible name of their own (they are a `<table>`
 * under a `TableHead` `<h3>`, see AeroAnalysis.tsx), so the specs reached them
 * by document index: `querySelectorAll('table')[1]`. That index moved every
 * time a table was added or a pane was mounted hidden. The heading IS named,
 * and the app renders each table as the first one after its heading, so this
 * selects by that relationship instead. It is an XPath axis, not a class name,
 * so it survives restyling.
 */
export function tableUnder(page: Page, heading: string | RegExp): Locator {
  return page.getByRole('heading', { name: heading }).locator('xpath=following::table[1]');
}

/**
 * The rows of the table under `heading`, as trimmed cell text. Row 0 is the
 * header row.
 */
export async function tableRows(page: Page, heading: string | RegExp): Promise<string[][]> {
  const table = tableUnder(page, heading);
  await expect(table, `no table under the "${heading}" heading`).toBeVisible();
  // The Aero pane recomputes its sweep off the render path and marks itself
  // aria-busy while it does; a read inside that window sees the previous
  // sweep's numbers. Wait for the pane to settle before snapshotting.
  await expect(page.locator('[aria-busy="true"]'), 'a pane was still computing').toHaveCount(0, { timeout: 20_000 });
  return table.evaluate((t) =>
    [...t.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => (c.textContent || '').trim())),
  );
}

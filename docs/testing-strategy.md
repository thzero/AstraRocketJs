# Proposal: what the tests cover, and what they assume

> Design proposal / decision record. Status: **proposed**, for review. Nothing in here changes code.
> Companion to [Contributing → Which kind of test](https://thzero.github.io/AstraRocketJs/docs/contributing#which-kind-of-test),
> which says _how_ to write a test. This document says what the suites currently
> **cover**, what each one **assumes** about the world it runs in, and what a green
> run does and does not entitle anyone to believe.
>
> Measured against `dev` on 2026-09-17: 83 unit files / 909 cases, 21 e2e files / 95 cases.

## Contents

- [Why write this down](#why-write-this-down)
- [The three layers](#the-three-layers)
- [Unit and component tests](#unit-and-component-tests)
  - [What they cover](#what-they-cover)
  - [What they assume](#what-they-assume)
  - [What a green unit run means](#what-a-green-unit-run-means)
- [End-to-end tests](#end-to-end-tests)
  - [What e2e covers](#what-e2e-covers)
  - [What e2e assumes](#what-e2e-assumes)
  - [What a green e2e run means](#what-a-green-e2e-run-means)
- [The seam: which layer gets a new test](#the-seam-which-layer-gets-a-new-test)
- [Coverage, and why the number is not the goal](#coverage-and-why-the-number-is-not-the-goal)
- [What neither layer covers](#what-neither-layer-covers)
- [Open questions](#open-questions)

## Why write this down

Both suites are big enough now that "is this tested?" is no longer answerable by
looking. Worse, the two suites cover _different kinds of claim_, and the failure
mode is silent: a module can sit at 100% line coverage and still be wrong in the
browser (nothing rendered it), and a feature can pass every e2e check and still
be wrong on paper (nobody measured the PDF). Writing the division down makes the
gaps arguable instead of accidental.

## The three layers

| Layer                          | Where                                               | Size                     | Runtime                         | The claim it can support                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------- | ------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Engine parity + validation** | `engine-java/test/parity`, `engine-java/validation` | 1 harness + 5 scorecards | minutes (Gradle + TeaVM builds) | The browser engine computes the same numbers as reference OpenRocket on the JVM, bit for bit, on both the WASM-GC and JS targets; and the aero model scores against wind-tunnel anchors. |
| **Unit + component** (Vitest)  | `web/src/**/*.test.ts(x)`                           | 83 files, 909 cases      | seconds, coverage included      | A pure function, a store action, a parser, an exporter or a single component rule behaves as specified, including on inputs no user would type.                                          |
| **End to end** (Playwright)    | `web/e2e/*.spec.ts`                                 | 21 files, 95 cases       | ~3.6 min, 3 CI shards           | The wired-together app boots in a real browser and a real user flow reaches the real result.                                                                                             |

The engine gate goes first on purpose (`.github/workflows/gates.yml`), because
every app test runs against the **committed** engine binaries in
`web/src/engine/vendor/` and `web/public/engine/`. If those are stale, a green
unit suite and a green e2e run are both measuring the wrong engine. The two app
gates (`build-and-test` and `e2e`) then run in **parallel** behind it: both
declare `needs: [parity, reproducible]`, and neither waits on the other.

This document is about the middle and bottom rows. The engine layer is documented
in [Contributing → Validation & fidelity tests](https://thzero.github.io/AstraRocketJs/docs/contributing#validation--fidelity-tests).

## Unit and component tests

`npm test` (or `npm run test:coverage`) from `web/`.

### What they cover

Grouped by what is actually being asserted, not by folder:

**Geometry and the design tree** (`src/tree/`, 98.4% of lines)

Axial positioning and the `after` / `absolute` position modes, freeform outline
normalization and root chord, shape profiles and clipping, tube-fin radius and
max-count limits, cluster point layouts and offsets, assembly chain length and
bounding radius, whole-rocket scaling, and the typed property accessors
(`num` / `str` / `bool`) that guard everything above from a malformed node.

**Units and preferences** (`src/prefs/`, 95.7%)

Every conversion in both directions, the per-field override layer versus the
quantity-level default, presets, `normalizeUnits`, and the launch-condition
bridge (the one place the app stores something that is not SI: degrees, Celsius,
hPa). `useUnits.test.tsx` covers the _wiring_, that `at()` actually consults the
per-field layer while the quantity-level calls deliberately do not.

**File I/O and round-trips** (`src/services/ork*`, `wireLoadedOrk`, `xmlUtil`, `engParser`)

`.ork` export to import round-trip at full fidelity, design metadata, the
optional `<designinfo>` block, radial angles on lugs and rail buttons, recovery
device features, and the newly editable component options. Plus the rule that an
imported `absolute` position is rewritten into the parent frame for the editor
but **written back out as it came in**, so a round-trip stays byte-stable. `.eng`
motor parsing and total impulse. XML escaping in both the string and DOM paths.

**Export formats** (`csvExport`, `reportCsv`, `dxfExport`, `meshExport`,
`solidMesh`, `rasaeroExport`, `flightPathExport`, `schematicExport`, `reportPdf`)

The largest single block of assertions in the suite. `flightPathExport` alone
is 57 cases: desktop-model parity, per-stage track colors, altitude reference
modes, KML / GPX / waypoint CSV rendering, escaping, and Mustache user templates.
`solidMesh` asserts the mesh is actually watertight (it counts open and
non-manifold edges) and refuses to export a self-crossing freeform fin.
`reportPdf` pins the page arithmetic against the paper standards (A4 =
210 x 297 mm, Letter = 215.9 x 279.4 mm) rather than against values read back out
of the code, because the failure it prevents is the quiet kind: a PDF that opens
fine, looks right, and is the wrong size, found only after someone has cut to it.

**Catalogs and stores** (`motorDb`, `componentDb`, `materials*`, `motorStore`,
`templateStore`, `designLibrary`, `workspaceStore`, `idbKeyValueStore`,
`workspaceJournal`, `persistStorage`, `settings`, `remoteData`, `catalogProgress`)

Filtering and facets, `.ork` full designations versus short catalog names,
per-entry TTL freshness, custom-motor validation (specifically, rejecting what
would reach the kernel broken), the IndexedDB store plus its migration from the
old localStorage one and its behavior when IndexedDB is unavailable, the
synchronous unload journal, corrupt-blob recovery, and per-field validation of
persisted settings.

**State** (`src/state/`, 70.8%)

`store.test.ts` covers undo/redo across component edits and simulation changes
on one timeline, mount to motor reconciliation, run guards, tab and view staying
in step, two separate race-safety properties (`openDesign` and workspace
replacement across actions), and what an import does when its name is already in
the library (overwrite, keep both, the canceled-name fallback, and a refused
active-pointer write abandoning the import rather than half-applying it). `useWorkspaceEffects.test.tsx` covers what `store.test.ts`
structurally cannot: the **order and the guards** around the async edges, that is
the hydration gate, the debounced autosave, the unload journal, what triggers an
engine rebuild, and result invalidation.

**The engine boundary** (`src/engine/`, 51.3%)

Three different seams, deliberately. `openRocketEngine.test.ts` **stubs** the
kernel and asserts what the facade _hands_ it (the one place JS numbers become
physics inputs, so a dropped `?? default` in an options block would change every
simulation silently). `engineBoundary.test.ts` drives the **real** TeaVM kernel
and asserts what the Java does when handed something bad, including that error
envelopes come back as envelopes rather than as opaque exceptions from inside a
2.9 MB bundle, that the aero sweep does not fabricate zeros, and that component
masses come back ordered rather than shuffled. `simClient.test.ts` stubs `Worker`
and covers the timeout path.

**Component rules** (`.test.tsx`, 9 files)

Only where the rule lives in the component and has no service to test instead:
the unit chip's write-and-remove rules, the freeform fin editor's keyboard path
(vertices used to be pointer-only, so a keyboard or screen-reader user could not
edit a freeform fin at all), the cluster and tube-fin validators wired into the
property panel, the export dialog's selection UI over a fixed model, the
flight-path export dialog's presets and per-stage swatches (only committed on
OK), the hover-cursor hook's cleanup on unmount, and `SettingsProvider`
persistence. Two of the nine render a **hook** rather than a
component and are described above under their own subject: `useUnits.test.tsx`
(units and preferences) and `useWorkspaceEffects.test.tsx` (state).

**Translations** (`i18n/locales.test.ts`)

English is the source of truth and every other locale falls back to it
silently, so a dropped key shows as English in a Spanish UI rather than as an
error. These flatten every locale and compare key sets and interpolation
placeholders, which makes that drift loud.

### What they assume

These are the standing assumptions. A test that needs a different one has to say
so in the file, and most of the interesting ones already do.

1. **Node, not a browser, unless the file opts in.** The default environment is
   `node`. The 21 DOM-coupled files declare `// @vitest-environment jsdom` at the
   top. jsdom is not a browser: it does not lay out SVG, does not run WebGL, and
   does not paint. Anything that depends on layout is out of scope here by
   construction, which is exactly why `schematic.spec.ts` exists.
2. **The engine is stubbed everywhere except one file.** `engineBoundary.test.ts`
   is the only test that runs real physics, and it loads the vendored module
   directly rather than through `initEngine` (which wants a browser). It carries
   its own 60 s timeout; the rest of the suite runs on the 5 s default, on the
   assumption that no other test has any business taking seconds.
3. **No network, ever.** Motor, component and material catalogs are bundled, so
   the suite is fully offline. The two files that exercise fetch (`remoteData`,
   `catalogProgress`) install their own stub with `vi.stubGlobal('fetch', …)` and
   assert on the URLs it saw. `thrustcurve.test.ts` needs no stub at all: it
   drives the bundled-catalog path and asserts that no thrustcurve.org round trip
   happens. The other browser-API tests stub a different global — `navigator` for
   `persistStorage` (the storage manager) and `saveFile` (the iOS share sheet).
4. **Module singletons are hostile and get reset.** `remoteData` resolves its
   bases at module load and memoizes for the session; `simClient` caches one
   worker. Those tests reset the module registry and re-import per case. Stores
   that are singletons get a fresh in-memory instance per test to avoid bleed.
5. **Real translations, not a stubbed `t`.** `renderWithProviders` imports the
   real i18n bundle, so component assertions read the strings a user actually
   sees and a renamed key fails a test instead of showing a raw key on screen.
6. **Real settings load, seeded partially.** `seedSettings({ ... })` writes a
   _partial_ blob on purpose: `loadSettings` fills and validates the rest, so the
   test states only what it cares about and still exercises the real load path.
7. **The tree is SI.** Units are a display and entry preference. Any test that
   asserts on a stored value asserts in SI, and a unit test that needed the tree
   to hold inches would be testing the wrong thing.
8. **Fixtures are hand-built literals, not captured output.** Expected values are
   derived from the standard or the physics (paper sizes, x39.37, a thrust curve
   that is a triangle peaking at 20 N over 1 s, so the trapezoid rule owes
   exactly 10 N s and the NAR class is C), not read back out of the
   implementation. Where a test uses round geometry, it is so the conversion
   lands on a number the assertion can pin exactly.
9. **Only four files mock a project module** (`vi.mock`), all in `state/` and
   `components/report/`. Everywhere else the seam is a hand-written stub passed
   in as an argument, which keeps the boundary visible in the test.
10. **The worker pool is capped at 4.** Vitest isolates one worker per file; 83
    files on a many-core box starved the one test that drives the real kernel
    into a timeout under `--coverage` while `npm test` passed. That cap is a
    correctness fix, not a tuning knob.

### What a green unit run means

**It supports:** every pure transform in the app (parse, convert, position,
export, validate) does the right thing on the inputs the tests name, including
malformed and adversarial ones; the store's async edges cannot be reordered into
data loss; and the facade hands the kernel what it means to.

**It does not support:** that any of it is reachable. Nothing here renders the app
shell, and unit tests structurally cannot catch the class of bug this project has
actually shipped: a prop that was never passed (`exportData`, which left a whole
export service unreachable by any user), an effect with an inline arrow in its
deps (an unbounded render loop in a dialog), a row that does not wrap (a tab bar
sliding off a phone screen), or a control that is disabled to the mouse but not
to the keyboard. That is the e2e layer's job, and it is why it exists.

## End-to-end tests

`npm run e2e` from `web/`. Headless Chromium against a real Vite dev server.

### What e2e covers

**Boot and the core loop** (`smoke.spec.ts`)

The app boots with an engine-computed design, running a sim unlocks the Flight
view and clears the previous result, the sim runs **off the main thread** (the UI
stays responsive during it), a duplicated simulation survives a page reload, and
the calipers toggle from the header.

**The pre-1.0 gate** (`wip-gate.spec.ts`)

The notice blocks the app on a first visit, lets go once acknowledged, and
stays acknowledged across a reload. This is the _only_ place the gate is
exercised; every other spec has it pre-acknowledged by the fixture.

**2D schematic** (`schematic.spec.ts`, `schematic-interaction.spec.ts`)

That it draws the default airframe with labeled components and survives a zoom
re-render, plus the interaction paths jsdom cannot drive: click to select, hover
name tag, horizontal drag to roll, and the live caliper readout. The geometry
math itself is unit tested; this covers that the component actually draws.

**Aerodynamics** (`aero*.spec.ts`, 6 files, 20 cases)

The Mach sweep and its axis labeling; the per-component drag table adding up to
the whole rocket and counting every instance of a multi-instance component; the
Mach slider landing only on computed samples; component CNa summing to the rocket
with CP as its weighted mean; roll dynamics appearing once the fins are canted;
both shading modes and the fact that the legend switch is the same preference as
Settings; angle of attack moving the CP; roll rate bringing damping to life;
"Worst" finding the wind direction with the most forward CP; the power-on drag
curve appearing only for a design with a nozzle exit diameter; and that two
components sharing a name stay two rows rather than merging into one.

**Motors** (`motor-picker.spec.ts`, `motor-dashboard.spec.ts`)

Picker opens with the seated motor selected, select-then-confirm applies and
closes, delay chips including flying plugged, the diameter range defaulting to
the mount fit and persisting across reloads, manufacturer persistence, the
ignition event persisting and a launch-delayed primary ignition still simulating
end to end, and the read-only thrust-curve popup. The dashboard covers sortable
columns, a remembered column chooser, compare (overlay) and combine (cluster).

**Design and editing** (`component-editor.spec.ts`, `design-meta.spec.ts`,
`recovery.spec.ts`, `library.spec.ts`)

Newly exposed editor options render for several component types and the boolean
field kind does not crash the panel; a freeform fin can be added, shows its
outline editor and simulates; editing design metadata does **not** throw away
flight results; recovery deployment overrides persist and flow through build to
worker to engine; and the saved-designs library opens and settles instead of
refreshing forever, keeps its rename dialog open, and asks before deleting.

**Reports and exports** (`report-dialog.spec.ts`, `image-export.spec.ts`)

The report dialog opens on a multi-stage design without an update loop, Save as
PDF writes a real PDF (not an empty or truncated one), and the report can be
pinned to a unit system that is then remembered. The 2D view offers SVG and image
export and downloads a true-scale SVG; the 3D view offers a snapshot.

**Units** (`units.spec.ts`)

That a preference reaches every readout (fields, tree, rulers, stats strip) and
that an inline chip does **not**, that a non-default unit is signaled in color
_and_ in the accessible name, that a field keeps its unit across a reload, that a
preset clears per-field choices, and that a length typed in inches round-trips
through the SI tree.

**Layout** (`mobile-layout.spec.ts`, 18 cases, the largest spec)

No sideways scroll at real phone widths, in Spanish as well as English (the
longer language is the harder case); the quarter turn on a portrait screen and
back in landscape; the 3D model framed correctly inside that turn; aero charts
turning with the sketch while flight views stay upright; dialogs going edge to
edge on a phone and staying carded at the desktop breakpoint; a finished run
landing on the Results tab and a new design not stranding you there; and the
desktop workbench still offering all five views at once.

**Accessibility** (`a11y.spec.ts`)

Escape closing the export dialog, the settings tabs being a real tablist rather
than color alone, unit chips having distinct accessible names with no two on one
screen announcing the same thing, focus trapped in a modal and handed back on
close, the import and export `.ork` menu items being told apart, and each chart
crosshair being drivable from the keyboard.

### What e2e assumes

1. **One browser, one worker, serially.** Chromium only, `workers: 1`.
   `fullyParallel: false` alone only serializes within a file; Playwright still
   spreads files across half the machine's cores, and 16 headless Chromiums each
   software-rendering WebGL against one dev server produced 45 and then 19
   failures, every one a timeout or a misdirected click, none a real defect. At
   one worker the same specs passed in 3.6 min, _faster_ than the 16-way run.
   (That measurement was taken at 90 cases, which is where the 90 in
   `playwright.config.ts` comes from; the suite is 95 now.) CI gets its
   parallelism from **sharding** (3 runners, each with its own dev server and its
   own single worker), which keeps that reasoning intact.
2. **A desktop viewport by default** (1500 x 950), because the split-pane layout
   hides the stats footer and the Simulations panel behind tabs below that width.
   Mobile specs set their own viewport.
3. **Software-rendered WebGL** (the ANGLE software backend, set by launch flags
   in `playwright.config.ts`), so the 3D views come up on a CI box with no GPU.
   Nothing asserts on GPU-dependent pixels.
4. **The work-in-progress notice is already dismissed**, by a stored flag seeded
   in `addInitScript`, not by racing its button. The seed **merges** into whatever
   is already stored and has to keep doing so, because it runs on every
   navigation including `page.reload()`, and a dozen specs reload precisely to
   prove a preference survived.
5. **Fully offline.** All motor, component and material data is bundled; no spec
   makes a thrustcurve.org round trip. Only two `.ork` fixtures exist
   (`two-stage.ork`, `nozzle.ork`); everything else drives the default rocket.
6. **Assertions are on DOM and behavior, never pixels**, so an intentional styling
   change does not break the suite. Where a control's only text is a glyph, the
   spec matches on `title` or on the accessible name.
7. **Waits are on real signals, not sleeps.** `autosaved()` polls IndexedDB until
   the debounced write actually lands; the aero helper polls the reading under
   test until it _changes_, which is the only honest signal that a re-run
   finished. A sleep used to _reach_ a state is a defect: it loses on a loaded
   machine and passes in isolation. The one legitimate use is the opposite case,
   where the wait **is** the measurement window for a negative assertion, and
   there are exactly three: `library.spec.ts:42` (an open dialog issues no
   further IndexedDB reads), `library.spec.ts:68` (the rename dialog is still
   open a second later), and `smoke.spec.ts:69` (a `requestAnimationFrame`
   sampling window, to prove the sim did not stall the main thread). Nothing can
   be polled for there, because the assertion is that nothing happens.
8. **Almost nothing is swallowed.** The old `.catch(() => {})` around the gate
   click, 76 calls of it, is gone, and a spec that cannot proceed now fails where
   it is stuck. One survives, at `mobile-layout.spec.ts:337`: the Discard
   confirmation after New, which the spec does not care about either way. It is a
   loose end, not a pattern.
9. **The dev server is the artifact under test**, not the production build.
   Playwright starts Vite on a fixed port with `strictPort` so it fails loudly
   rather than drifting. This means the suite does not exercise the production
   bundle, the service worker, or PWA install behavior.
10. **Retries only under CI** (1), with `trace: 'on-first-retry'`. Locally a flake
    is a failure, which is the point.

### What a green e2e run means

**It supports:** the app boots, the engine loads, an edit reaches the engine, a
simulation runs off the main thread and its result reaches the charts, the data a
user typed survives a reload, and the flows above are reachable with a keyboard
at both phone and desktop widths.

**It does not support:** that any number on screen is _correct_. E2E asserts
relationships (the rows add up, the CP moves in the right direction, the PDF has
a real file signature and a plausible size), never absolute physics. Absolute
correctness is the parity and validation layer's claim, and only there.

## The seam: which layer gets a new test

The rule already in use, stated plainly:

- **Pure logic goes in a `.test.ts`.** If logic is hard to reach without
  rendering, that is usually a sign it should move into a module of its own, as
  the launch-condition bridge did (`prefs/launchUnits.ts`), which had been
  unreachable inside a `.tsx` and therefore untested.
- **A `.test.tsx` only when the rule lives in the component** and there is no
  service to test instead.
- **E2E for anything that needs layout, WebGL, a real download, a real reload, a
  real worker, or a real focus ring.**
- **Both, where the split is deliberate**: the schematic's geometry math is unit
  tested and its drawing is e2e tested, and both say so in their file comments.
  Likewise `reportPdf`, whose arithmetic is unit tested and whose 382-line
  drawing path (`downloadReportPdf`, `reportPdf.ts:134` to the end of the file)
  is only ever executed by `report-dialog.spec.ts`.
- **A specific non-goal is worth writing down.** `motor-picker.spec.ts` states
  that the multi-mount path is covered by unit tests because building a two-mount
  rocket through the tree UI would be brittle in a browser. That is the kind of
  sentence that stops someone re-adding it later.

## Coverage, and why the number is not the goal

`npm run test:coverage` reports, and does not enforce, a threshold. Current
baseline (Vitest only; Playwright is not instrumented):

| Area                 | Lines covered   |           |
| -------------------- | --------------- | --------- |
| `data/`              | 1 / 1           | 100.0%    |
| `i18n/`              | 14 / 14         | 100.0%    |
| `tree/`              | 250 / 254       | 98.4%     |
| `prefs/`             | 67 / 70         | 95.7%     |
| `services/`          | 2680 / 3544     | 75.6%     |
| `state/`             | 257 / 363       | 70.8%     |
| `src/` (root)        | 24 / 36         | 66.7%     |
| `components/report/` | 61 / 106        | 57.5%     |
| `engine/`            | 100 / 195       | 51.3%     |
| `components/common/` | 37 / 102        | 36.3%     |
| `components/design/` | 147 / 554       | 26.5%     |
| `components/canvas/` | 275 / 2030      | 13.5%     |
| `components/sim/`    | 28 / 605        | 4.6%      |
| `components/layout/` | 0 / 323         | 0.0%      |
| **Total**            | **3941 / 8197** | **48.1%** |

Every directory is listed, so the rows sum to the total. `src/` (root) is
`App.tsx`, `main.tsx` and `bootSplash.ts`; the first two are e2e territory.

Read that shape, not the total. The logic layers are near-saturated and the React
layers are low **by design**, because the seam rule sends component behavior to
Playwright, which no coverage tool here observes. `services/reportPdf.ts` shows
the effect exactly: it reports 10.1%, and the uncovered 90% is fully exercised by
the PDF e2e test. A threshold set on this total would push work toward rendering
tests that the seam rule deliberately avoids.

**Proposed position:** keep coverage reported and unenforced, and treat the
_per-directory_ shape as the thing worth defending. If a gate is ever wanted, the
honest one is a floor under `tree/`, `prefs/`, `services/` and `state/` only.

## What neither layer covers

Stated so the list is arguable rather than assumed:

- **Staged flight trajectories** are not validated against OpenRocket. The README
  says so; the parity harness covers single-stage scenarios, and staged flights
  simulate as independent branches.
- **The production bundle, the service worker, and PWA install / offline
  behavior.** E2E runs the dev server. Offline is a shipped feature with no
  automated test.
- **Any browser but Chromium.** No Firefox, no WebKit, no real iOS Safari, which
  is the one platform where the app deliberately takes a different code path
  (`saveFile`'s share sheet). That path is unit tested with a posed user agent and
  has never run on the device it exists for.
- **Visual regression.** Nothing compares pixels, by choice. A layout can be ugly
  and green.
- **Performance.** No budget on boot time, engine load, sim duration or frame
  rate. `smoke.spec.ts` asserts the UI stays _responsive_ during a sim, which is a
  liveness check, not a budget.
- **Long-running and large-design behavior.** No test drives a 50-component
  rocket, a 200-point freeform fin, or a library with 100 saved designs.
- **`components/layout/` at zero unit coverage**, including `AppHeader` and
  `SettingsDialog`. E2E reaches both, so this is intentional, but it means a
  regression there is caught only by whichever e2e flow happens to touch it.
- **Service modules with no test of their own,** by how much a test would buy:
  `loadOrk` (0 / 36), `componentExport` (0 / 18), `keyValueStore` (2 / 9),
  `saveOrk` (0 / 4), `uuid` (2 / 3). Several are thin wrappers, and `orkTypes` is
  type-only. `loadOrk` and `componentExport` are the two worth a look; the rest
  are a line or two of glue. `fetchProgress` also has no test file but is at
  100% (20 / 20) through `remoteData`, `thrustcurve` and `openRocketEngine`.
  `orkImport` is covered indirectly through `orkFile.test.ts` at 73%;
  `orkExport` has its own `orkExport.test.ts` and sits at 72%.
- **i18n completeness beyond key parity.** Nothing checks that a Spanish string is
  a correct translation, only that the key exists with matching placeholders.

## Open questions

1. Where should this live long term: here in `docs/`, or folded into the
   [Contributing](https://thzero.github.io/AstraRocketJs/docs/contributing) page
   next to "Which kind of test"? It is longer than that page wants, but the seam
   rule belongs beside it.
2. Is the unenforced-coverage position the right one, or is a floor under the four
   logic directories worth adding to the `build-and-test` gate?
3. Of the gaps above, which are accepted and which are a backlog item? The three
   candidates are staged-trajectory validation, a WebKit e2e project (for the iOS
   share-sheet path), and a production-build / offline smoke test.
4. Should the non-goals be recorded in the specs themselves (as `motor-picker`
   does) rather than only here, so they survive a refactor of this file?

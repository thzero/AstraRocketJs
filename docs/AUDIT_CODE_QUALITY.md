# Code Quality Audit - AstraRocketJs

**Date:** 2026-09-20
**Scope:** `web/` (React 19 + TypeScript strict + Zustand 5 + react-three-fiber + Vite), plus the test suite, e2e suite, build scripts and CI workflows. The TeaVM-compiled kernel under `web/src/engine/vendor/` is out of scope; the Java sources were consulted only to verify ports.
**Question asked:** anti-patterns, bad React, bad JavaScript/TypeScript, structural debt. This is not a security audit and not a physics audit; see `AUDIT.md` and `AUDIT_ENGINE.md` for those.
**Method:** an empirical pass first (the full React Compiler lint set, which the project deliberately does not enable, plus `eqeqeq`, `no-non-null-assertion`, a dependency-cycle scan and a pattern grep), then eight parallel reviewers, each reading every file in one slice in full: state and prefs; canvas components; sim and report components; design, layout and common components; import/export services; storage and domain services; engine bridge, tree and i18n; tests, tooling, scripts and CI. Every HIGH below was re-read against the source by the orchestrator, and the three `.ork` findings were checked against the OpenRocket Java in `engine-java/.openrocket-src`.

**Baseline at audit time:** `tsc --noEmit` clean on all three tsconfigs, `eslint --max-warnings 0` clean, `knip` clean, 1467 tests in 128 files passing in about 11 s, prettier and cspell clean. Zero `any`, zero `@ts-ignore`, no snapshot tests, no `.only`/`.skip`, every fake-timer and global stub restored. **Nothing in this report is visible to the existing gates.**

Severity per finding: **HIGH / MED / LOW**. A check mark means re-read against source by the orchestrator.

---

## Read this first

This codebase is disciplined. Strict TypeScript with `noUncheckedIndexedAccess`, one shared `NumberInput` that solves the controlled-number-input problem once, unit conversion routed through one `useUnits().at(scope)` API, Zustand selectors that never return fresh objects, async effects with cancel flags, three.js resources disposed, generation counters guarding every workspace race, and comments that cite the OpenRocket Java file and line they port. The reviewers' consistent reaction was that the file sizes suggest worse than the code delivers. Most of the ~1100 automated lint hits are benign: the 977 non-null assertions are almost all index reads immediately after a length check, and the 114 loose-equality hits are all the `== null` nullish idiom.

The real problems fall into six patterns, and most individual findings are instances of one of them.

**1. Effects used as data flow, caused by always-mounted dialogs.** Nineteen `set-state-in-effect` hits and four of the five `exhaustive-deps` disables trace to one decision: some dialogs are mounted permanently and told `open`, so each one needs a "reseed local state when `open` flips" effect. `AppHeader.tsx:470-475` already mounts six dialogs conditionally and their state resets by unmount. `MotorDialog`, `MotorSpecDialog`, `WindProfileDialog`, `RocketConfigDialog`, `ScaleDialog` and `DesignPropertiesDialog` do not. One of those effects has a real bug (the motor picker leaks the previous motor's ejection delay onto the next pick after a reopen).

**2. Copies of the same helper that have drifted.** This was the second theme of the last audit and it is still the dominant one. Catalog loading, manufacturer filter, class chips and the diameter slider are duplicated between `MotorDashboard` and `MotorDialog` (about 150 lines, same comments). The Escape-to-close listener is written sixteen times. The stability verdict tiers are hand-coded in three places with three different thresholds. `axialStart` has a private copy in `Rocket3D` that disagrees with the shared one for `absolute` positioning. "Does this motor have a usable thrust curve" has four implementations with four different thresholds, and the run button uses a looser one than the rocket builder, so a one-sample motor passes the button and is silently left unseated. "Which wind level is the surface" has two answers. There are four id generators, and the one in `treeEdit` restarts at zero on every page load, so ids collide with persisted ones.

**3. Kernel constants outside the verified table.** `kernelDefaults.ts` exists to hold every kernel fallback and has a behavioral test against the real engine. But `finPlanform.ts`, `position.ts` and `tubefins.ts` carry their own kernel values that the test never sees, and `position.ts` falls back to the parachute length (0.025 m) for every non-fin component type, which is wrong for eight of them.

**4. Round-trip tests that only round-trip the app's own output.** No `.ork` test parses a file the desktop wrote. That is how the multilevel wind altitude reference survived on the wrong XML carrier (a child element here, an attribute on `<wind>` in the Java saver and loader), and how four launch fields the app edits came to be written as constants on export.

**5. Refusal signals from the persistence layer dropped at the store.** The storage tier was rebuilt after the last audit to return `false` on a refused write, and the domain stores check it. The Zustand store does not: File > Save swallows a `storage-full` throw and returns `true`, `openDesign` ignores `setActive`'s refusal, and `create()` inside the library itself discards it.

**6. Comment drift.** This codebase leans on comments as the record of intent, which is a strength, but a dozen of them now describe behavior that no longer exists (results dropped on hydrate vs kept, a localStorage mirror that does not exist, setter functions that are documented but not exported, file and test counts from a suite half this size).

Layering is clean with three exceptions: `services/reportModel.ts` reads the Zustand store directly, `services/reportGeometry.ts` imports from `components/canvas`, and `state/store.ts` imports a value from `components/canvas/ViewToggle`. The four dependency cycles the scanner found are type-only except for the `reportModel` one.

---

## HIGH findings

**HIGH - New node ids collide with persisted ids after a reload** (verified)
`web/src/services/treeEdit.ts:11-16`. `newId` is a module-scope counter that starts at 0 on every page load and mints `<type>-<n>`. Nothing seeds it from the hydrated tree. Session 1 adds a body tube (`bodytube-1`) and autosave persists it; session 2 adds another body tube and gets `bodytube-1` again. `findNode`, `updateNode` and `removeNode` all stop at the first match, so editing or deleting the new part edits or deletes the old one, and `extraMotors` keyed by mount id maps two mounts to one motor. `orkTree.ts:3-8` has the same shape (`c<n>`) but is safe only because import replaces the whole tree. **Fix:** mint with `uuid()` (already in `services/uuid.ts`), or seed the counter from the largest existing suffix on hydrate and reject collisions in `addChild`. Add a test that runs `defaultNode` against a tree that already contains `<type>-1`.

**HIGH - The waypoint CSV escaper corrupts every negative number** (verified)
`web/src/services/flightPathExport.ts:1137`. The formula-injection guard prefixes `'` to any value matching `/^[=+\-@\t\r]/`, and the waypoint template passes the pre-formatted `latitudeStr`, `longitudeStr`, `altitude` and `distance` through it. `-80.600000` renders as `'-80.600000`. Every launch site in the Americas has a negative longitude (the KSC fallback itself is -80.6), and a landing below pad level has a negative altitude; spreadsheets and GPS Visualizer read those as text. The only CSV test uses positive coordinates. **Fix:** escape only the string-typed model fields, or exempt numeric strings (`/^[=+@\t\r]|^-(?![\d.])/`). `reportCsv.ts:31` has the same regex and is safe only because its numeric values never start with `-`; pin that with a test.

**HIGH - Multilevel wind altitude reference is read and written on the wrong XML carrier** (verified against Java)
`web/src/services/orkImport.ts:774`, `web/src/services/orkExport.ts:853`. OpenRocket writes `<wind model="multilevel" altituderef="AGL|MSL">` (`OpenRocketSaver.java:367`) and reads `attributes.get("altituderef")` (`WindHandler.java:25`). The importer looks for a child `<altitudereference>` or an attribute spelled `altitudereference`; neither matches. The exporter writes a child element the desktop ignores. The import comment ("written as a child element by the desktop") is contradicted by the Java. An AGL sounding from a desktop file silently becomes MSL here and the reverse on the way out; at a 1500 m site that is a different wind at every level. `orkWindProfile.test.ts` passes because it round-trips our own output. **Fix:** read `mlEl.getAttribute('altituderef')` with the current spellings as fallbacks, write the attribute on `<wind>`, and add a desktop-authored fixture.

**HIGH - Four launch fields the app edits are written as constants on export** (verified)
`web/src/services/orkExport.ts:815, 818, 831-834, 860`. `launchintowind` is always `true`, `launchroddirection` always `90.0`, `winddirection` and `<direction>` always `Math.PI/2`, `launchlongitude` always `-80.6`. `LaunchConditions` (`orkTree.ts:36-57`) carries all four, `LaunchPanel.tsx` edits all four (14 references), and `simulations.ts` feeds them to the kernel. The importer reads `winddirection` but not the other three. Set wind from 270 degrees, save, reopen: the wind is back to 90 and the drift flips side; the longitude is gone and the KML export substitutes Kennedy Space Center. **Fix:** write the four from `launch` (rod direction in degrees, wind direction in radians, per the saver) and read `launchroddirection`, `launchintowind`, `launchlongitude` on import. Extend the "never writes the literal string null" test to these fields.

**HIGH - `useFocusTrap` unconditionally overrides `autoFocus`, and `ConfirmDialog` confirms on Enter while Cancel is focused** (verified)
`web/src/components/common/useFocusTrap.ts:38-39`, `web/src/components/common/ConfirmDialog.tsx:30-37, 58-64`. The trap's passive effect runs after React has applied `autoFocus` in commit and moves focus to the first focusable element in DOM order regardless. In `ConfirmDialog` the Cancel button comes first, so focus visibly rests on Cancel; the window-level keydown handler maps Enter to `settle(true)` for every target. A keyboard user sees the focus ring on Cancel, presses Enter, and the destructive action (delete part, delete design, delete simulation) proceeds: the window listener fires first, then the button's own click calls `settle(false)`, which the store ignores because the request is already settled. `RocketConfigDialog:94` and `ComponentPicker:120` autofocus an input and land on the "✕" button for the same reason. The existing suite cannot see this because stock jsdom reports `offsetParent === null` for every element, so the trap's `focusable()` filter returns nothing. **Fix:** in the trap, skip the move when `panel.contains(document.activeElement)` is already true; in `ConfirmDialog`, drop the global Enter mapping and rely on native button activation. Add a trap test that stubs `HTMLElement.prototype.offsetParent`.

**HIGH - File > Save reports success when the write was refused** (verified)
`web/src/state/store.ts:601-607, 1198-1219`. `saveDesign` calls `flushActive`, whose `catch` swallows the `storage-full` error that `workspaceStore.save` throws (`workspaceStore.ts:238`), then returns `true`. The comment says "the banner already says so", but nothing in `flushActive` or `saveDesign` raises the banner; only the debounced autosave's `.catch` in `useWorkspaceEffects.ts:129` does. `AppHeader.tsx:296` treats `true` as saved. A user who edits and hits Save within the 500 ms debounce on a full store sees Save succeed with nothing written. `saveDesignAs` right below it does raise `storage.full`. **Fix:** make `flushActive` return a boolean; in `saveDesign`, on failure call `setStorageWarning(i18n.t('storage.full'), 'full')` and return a third state so the caller does not fall through to Save As.

**HIGH - Motor picker leaks the previous motor's ejection delay onto the next pick after a reopen** (reviewer-verified)
`web/src/components/sim/MotorDialog.tsx:106-108, 180-197, 202-226`. The seed effect sets `seedRef.current = true` then `setSelected({m, rowId})`. The reset effect is keyed on `selected?.rowId` only and carries an `exhaustive-deps` disable. Because `MotorRow` keeps the dialog mounted, `selected` survives a close; on the second open the seed produces the same `rowId`, the reset effect never runs, `seedRef` stays `true`, and the next real row click hits the early return and skips `setCurveIdx(0)` and the delay defaulting. The user picks motor Y and Select applies motor X's delay, which may not even be in Y's list. **Fix:** do the reset in the row click handler and the seeding as an event on the open transition; that removes both refs, the effect and the disable. Better: mount the dialog only while open, as `AppHeader` does.

**HIGH - `calculateClip` loops forever on a non-finite or overflowing transition length** (verified)
`web/src/tree/shapeProfile.ts:117-137`. The bisection's only exit is `max - min < CLIP_PRECISION`. With `length` of `NaN`, `Infinity`, or a finite value whose doubling overflows, `max - min` becomes `NaN`, the comparison is always false, and the `for (;;)` never returns. The doubling loop above it is capped at 10 iterations; the bisection is not. `outerProfile` is called from the schematic, the 3D view, the report and the mesh exporter on the main thread; today's callers pass `num()`-guarded lengths, which blocks `NaN` but not 1e308 from a hostile or corrupt `.ork`. **Fix:** guard at the top of `outerProfile` (`!Number.isFinite(length) || length <= 0` takes the flat path) and cap the bisection at 60 halvings, returning the midpoint.

**HIGH - 3D flight playback re-renders the whole React tree every animation frame** (verified)
`web/src/components/canvas/FlightPath3D.tsx:104-128, 174-205, 242-256`. The rAF loop calls `setProgress` on every frame. The render body then re-walks `scenePts` for `maxY`, scans `times` for `idx`, allocates a `Vector3`, a `Quaternion` and two clones, filters `callouts`, reconciles every piece mesh, and hands each `Legend` a fresh `onChange` so its effect re-subscribes a native listener. The `shownRef` render-time cache (lines 82-86, 182-186, 218, the four `react-hooks/refs` hits) exists only to soften this. Sixty full React reconciliations per second of a Canvas subtree plus the HTML overlay is the standard react-three-fiber anti-pattern and is the stutter the file's own docblock describes. **Fix:** drive the animation from a `useFrame` inside the Canvas that mutates the model group's position and quaternion and a `Line` ref from `progressRef`; keep React state for the HUD and slider only, throttled; memoize the derivations; wrap the Legend callbacks in `useCallback`. Compute `idx` and the sliced arrays before the early return so the ref cache goes away.

**HIGH - No `versionchange` handler, so the first schema bump strands every open PWA tab** (verified)
`web/src/services/idbKeyValueStore.ts:37-62`. `openDb` handles `onblocked` on the new-version side, but the connection it opens never sets `onversionchange`, so an older tab holds its v1 connection open indefinitely. The day `DB_VERSION` becomes 2, any user with an old tab open gets `blocked` in the new tab, which rejects, marks storage degraded, and pins that session to the 5 MB localStorage fallback until they find and close the other tab. **Fix:** in `onsuccess`, set `req.result.onversionchange = () => { req.result.close(); if (dbPromise === p) dbPromise = null; }` so the old tab yields and reconnects on its next operation.

**HIGH - The scheduled catalog sync publishes an empty or truncated motor catalog without complaint** (reviewer-verified)
`web/scripts/sync-motors.mjs:94, 120-171`, `.github/workflows/sync-catalogs.yml:116-141`. The script writes whatever `search.json` returns (`results: []` default) and the publish step checks only that the diff is non-empty. There is no minimum-count floor, no comparison against the previous catalog, and no detection of `motors.length === maxResults` truncation. A ThrustCurve glitch that returns 200 with an empty array, or a schema change that makes every row fail `totImpulseNs > 0`, is pushed with `contents: write` and goes live to every user through the CDN on their next open. In-app validation (`motorDb.ts:86-115`) checks shape, not size. **Fix:** read the existing generated file and exit non-zero if the new count is under 90% of the old, if fewer than 80% of rows have curves, or if the count equals the API page cap. Same floor in `sync-components.mjs`.

**HIGH - CI runs on pull requests only, so day-to-day work is never gated** (reviewer-verified)
`.github/workflows/ci.yml:15`, `.github/workflows/deploy.yml:19-21`. The gate set (format, spell, typecheck, lint, test, knip, e2e) runs on `pull_request` and on the deploy path only. The root `push.*` helper scripts run no local gate. A broken test or a stale engine binary is discovered only when the integration PR is opened, at which point the fix has to bisect a long series of changes. The POSIX copies of the helpers are also broken: `version.sh:5` and `pushversion.sh:5` use `cd..` (no space) and `pushversion.sh:6` passes the Windows placeholder `"%1"` instead of `"$1"`. **Fix:** a lightweight workflow on push to the development line that runs the ~2 minute web job only; add a single `npm run verify` that mirrors the CI gate list so the two cannot drift; replace the six root scripts with one implementation.

---

## Cross-cutting patterns (with every instance found)

### Always-mounted dialogs and effects as data flow

Two conventions coexist. `AppHeader.tsx:470-475` mounts six dialogs as `{open && <Dialog/>}` so state resets by unmount. These do not, and each carries a reseed effect that is one render late and that the compiler lint flags:

| Dialog                   | Mounted at                                         | Reseed effect                        | Lint hit                                                |
| ------------------------ | -------------------------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| `MotorDialog`            | `MotorRow.tsx:125`                                 | `:81-141, 176-178, 180-197`          | set-state-in-effect x4, exhaustive-deps disable at :196 |
| `MotorSpecDialog`        | `MotorRow.tsx:133`                                 | none, but state carries across opens |                                                         |
| `WindProfileDialog`      | `LaunchPanel.tsx:611`                              | `:126` (`setError(null)` on open)    | set-state-in-effect                                     |
| `RocketConfigDialog`     | `LoadedBanner.tsx:106`                             | `:26-33`                             | set-state-in-effect, exhaustive-deps disable at :33     |
| `ScaleDialog`            | `TreePanel.tsx:55`                                 | `:38-40`                             | set-state-in-effect                                     |
| `DesignPropertiesDialog` | `AppHeader.tsx:476`, `DesignLibraryDialog.tsx:123` | `:36-41`                             | set-state-in-effect                                     |

Two dialogs that are already conditionally mounted still carry a now-dead `!open` reset branch: `ExportDialog.tsx:96-101` and `DesignLibraryDialog.tsx:54`. Delete the branches and the `open` props.

Other effect-as-data-flow sites, none of them dialogs: `FlightChart.tsx:203-205, 234` (trace selection and zoom reset on flight change; the first commit after a picker change draws no lines, and a re-run with the same id keeps a stale zoom window past the new `maxT`; fix by keying `<FlightChart key={flight.id}>` and storing exclusions instead of inclusions), `AeroAnalysis.tsx:105-114, 120-122` (clamp `machPick` after the fact; clamp in the handler), `FlightPath3D.tsx:131-142` (countdown launch performed inside the effect; do it in the timer callback), `MotorDashboard.tsx:296-298` (curve index reset one render late; reset next to the two `setSelected` calls), `AppHeader.tsx:56-61` (submenu state collapsed by effect; if it lived in a `FileMenu` component it would reset by unmount).

Render-time ref writes used as workarounds: `FlightPath3D.tsx:82-86, 182-186, 218` (manual memo, see the HIGH above), `AftView.tsx:322` (`eRef.current = E` so a `[]` wheel effect sees the current extent; add `E` to the deps), `DesignLibraryDialog.tsx:45-46` (`onCloseRef.current = onClose` to dodge a loop that splitting the effect in two would avoid).

### Copies that drift

- **Catalog dialog scaffolding**, `MotorDashboard.tsx:227-261, 407-444, 467-480, 671-680` vs `MotorDialog.tsx:81-141, 315-352, 362-379, 491-500`: load effect with loading/error/retry state (same seven-line comment), manufacturer `<details>` dropdown, `Chip`, diameter slider readout. Already drifted: the dashboard's readout shows raw millimeters while the picker's converts units. Extract `useCatalog(open)` and a `MotorFilterBar`.
- **Escape-to-close listener**, sixteen copies: `MotorDashboard.tsx:300`, `MotorDialog.tsx:143`, `MotorSpecDialog.tsx:24`, `WindProfileDialog.tsx:124`, `FlightCsvDialog.tsx:38`, `ExportDialog.tsx:58`, `ResultPicker.tsx:42`, `AboutDialog.tsx:36`, `PrivacyDialog.tsx:18`, `SettingsDialog.tsx:38`, `ScaleDialog.tsx:41`, `RocketConfigDialog.tsx:35`, `DesignPropertiesDialog.tsx:44`, `DesignLibraryDialog.tsx:55`, `ComponentPicker.tsx:59`, `ConfirmDialog.tsx:30`. The five-line justification comment beginning "Seven dialogs declared aria-modal" is pasted verbatim into five of them. `useFocusTrap` already owns the dialog lifecycle; rename it `useModal({active, onClose})` and fold Escape in.
- **Motor math**: `avgOf`/`ispOf`/`massFracOf` and `G = 9.80665` in `MotorDashboard.tsx:35-43` and `MotorDetail.tsx:9, 35-39`; `MotorSpecDialog.tsx:36-43` re-derives impulse/avg/max by hand; `9.80665` again in `LaunchPanel.tsx:605-606`; `recoverySizing.ts` has a sourced `G0`. The `g`/`q` formatting helpers are re-declared in three files. Chart headroom `1.08` in four charts.
- **Stability tiers**: `Rocket3D.tsx:911-915` hard-codes `cal < 1` / `cal > 6` and three hex colors twenty lines below `MARGIN_COLOR` and a `stabilityState()` call that encode the same rule; `InfoOverlay.tsx:8` uses different tiers (`>= 1`, `>= 0`) from `TreeSchematic.tsx:42`. Changing the tiers in `simReport` leaves the 3D callout and info card disagreeing with the badge.
- **`axialStart`**: `Rocket3D.tsx:52-64` returns `pos.offset` for `absolute`; `schematicGeometry.ts:121-124` and `tree/position.ts:86-102` return `pStart + pos.offset`. Latent because `resolveFilePositions` rewrites `absolute` on load. Delete the private copy.
- **Tree-walk helpers** with private copies in the 2D and 3D views: color override (`Rocket3D.tsx:49`, `schematicShapes.tsx:12`, `AftView.tsx:27`), `MotorDims` type (`Rocket3D.tsx:104`, `AftView.tsx:22`, `TreeSchematic.tsx:70`), wheel-zoom-about-pointer (`TreeSchematic.tsx:282-303`, `AftView.tsx:77-96`), fin instance angle math.
- **"Usable thrust curve"**, four thresholds: `runnability.ts:22-23` (any length), `buildRocket.ts:53` (>= 2), `motorDb.ts:57-59` (>= 2), `motorStore.ts:77-83` (> 0 and finite). `runnability.ts` exists so the Run button and the run loop cannot disagree, yet a one-sample motor on an upper mount passes the button and is silently left unseated by the builder. Export one predicate.
- **"Surface wind level"**: `simulations.ts:227` uses `windLevels[0]` with a comment calling it the lowest; `safetyLimits.ts:43-47` says levels are not sorted and picks the lowest altitude. A profile entered top-down aims the rod into the wind at 3000 m while the safety check judges the pad wind.
- **"Skip primary or vanished mount"**: `buildRocket.ts:51-53`, `state/store.ts:378-383`, `mountMotors.ts:30-34`, verbatim.
- **Default 90 degree heading** as a literal in `settings.ts:50, 54` and `simulations.ts:227, 228, 235`.
- **Chain-type set** `{nosecone, bodytube, transition}` declared in `position.ts:168`, `assembly.ts:14`, `scaleRocket.ts:217`.
- **Per-type component defaults** in three files: nose length 0.07 (`orkImport.ts:242`, `orkExport.ts:307`), engine block thickness 0.001 in import and export but 0.00095 in `dxfExport.ts:378`.
- **Id generators**, four with different guarantees: `uuid.ts` (v4), `designLibrary.ts:94` (time + random), `orkTree.ts:6-8` (`c<n>`, session counter), `treeEdit.ts:11-16` (`<type>-<n>`, session counter). Only the first two survive a reload.
- **`Workspace` snapshot shape** assembled by hand in `store.ts:587-598`, `useWorkspaceEffects.ts:119` and `:154-163`.
- **Magnitude ladder** `a >= 100 ? 0 : a >= 10 ? 1 : ...` in `units.ts:289-295` and `useUnits.ts:7-12`.
- **`showResults` tab rule** with the same comment in `TabBar.tsx:57-80` and `WorkbenchTabs.tsx:44-61`.
- **`ToolBtn`/button style helpers** in `MotorDashboard.tsx:682-703`, `SimulationsPane.tsx:109-134`, `WindProfileDialog.tsx:27-28`.
- **Shape guards** of varying depth (`isMeta`, `isUserTemplate`, `isMaterial`, `isCustomMotor`, `isCatalogMotor`, `isFlightResult`, `workspaceStore.validate`, `loadSettings`): some check finiteness, some only `typeof`, and `componentDb.ts:87` checks nothing beyond "is an object" and then memoizes the bad shape for the session.

### Kernel constants outside the verified table

`kernelDefaults.ts` states the rule ("anything on the TypeScript side that needs a fallback reads it from here") and `kernelDefaults.kernel.test.ts` verifies it against the real engine. These bypass it:

- `finPlanform.ts:53` `KERNEL_BODYTUBE_OUTER_RADIUS = 0.012` and `:55-60` `FIN_DEFAULTS`. The values match `ComponentFactory.java:191, 205-208` today, but the comment attributes them to "what `treeEdit.ts` and `orkImport.ts` actually write", and a kernel bump cannot be caught.
- `position.ts:134` `num(n, 'length', 0.025)` for every non-fin type. The Java defaults for inner tube, launch lug, coupler, centering ring, bulkhead, engine block, mass component and tube fin set are 0.07, 0.05, 0.05, 0.002, 0.002, 0.005, 0.02 and 0.1 respectively (verified at `ComponentFactory.java:275, 362, 314, 327, 341, 351, 453, 260`); 0.025 is the parachute default. `KERNEL_DEFAULTS` already carries three of these lengths and this function does not read them. A node missing `length` lays out `middle`/`bottom` siblings against the wrong extent.
- `position.ts:78` freeform root fallback 0.05; `tubefins.ts:202` `finCount` fallback 6.

### Stringly typed component dispatch

`isAssembly(type: string)` (`assembly.ts:67`), `isFinSet(type: string)` (`tubefins.ts:241`), `LENGTH_KEYS: Record<string, ...>` and `MASS_EXPONENT: Record<string, number>` (`scaleRocket.ts:31, 119`), `CLUSTER_POINTS: Record<string, number[]>` (`cluster.ts:91`). None is keyed on `ComponentType`, so the next type added to `openRocketEngine.ts:450` compiles and is silently not scaled, or scaled by k^3 mass with no length change. Type the tables `Record<ComponentType, ...>` so a missing entry fails to compile.

### Casts in place of validation at the untrusted boundary

`position.ts:176, 203, 239` cast `child.position as ComponentPosition` and then use `pos.offset` in arithmetic; `scaleRocket.ts:176` guards `typeof pos.offset === 'number'`, so the two modules disagree on what a bad position means. `simWorker.ts:30` casts `args as SimPayload`. `openRocketEngine.ts:1019-1109` cast `JSON.parse` output straight to result types. `simClient.ts:285` casts `unknown` to `T`. `store.ts:1178-1193` `openDesign` hydrates a blob that only JSON-parses, while the boot path runs the same blob through `validate` (`workspaceStore.ts:275-284`, module-private); a corrupt design produces an unhandled rejection with the workspace generation already claimed. `reportModel.ts:168, 170` and `meshExport.ts:36` use `as unknown as` where a real type would do (the STL cast is unnecessary with current `@types/three`).

### Persistence refusals dropped in the store

`store.ts:1189` (`setActive` result ignored in `openDesign`; on quota failure the next launch reopens the previous design, which is exactly the bug `designLibrary.ts:160-167` documents), `:1245` (`rename` result dropped), `:1252` (`remove` result dropped, then the workspace is reset anyway), `:601-607` (`flushActive`, the HIGH above), `designLibrary.ts:201-207` (`create` discards `setActive`'s boolean). Related: `idbKeyValueStore.ts:72-96, 224-246` flips the session to "degraded" on any transaction failure including a single oversized write, and never clears it; `remove()` at `:293-303` swallows failure and returns void while `set`/`update` report it.

### Layering and cycles

`services/reportModel.ts:3` imports `useWorkspaceStore` and `selectActive` from the store (which is why `saveOrk` has to lazy-import it at `store.ts:1303`); make `assembleReport` take its inputs. `services/reportGeometry.ts:6` imports `axialStart` from `components/canvas/schematicGeometry`; that helper belongs in `tree/`. `state/store.ts:45-46` imports `isResultView`/`ViewMode` from `components/canvas/ViewToggle` and `MotorDims` from `Rocket3D`; move the view-mode type next to `Tab` in `state/tabs.ts`. `designLibrary.ts:25` and `workspaceStore.ts:12` import each other (one side type-only).

### Comment drift

`store.ts:347-352` says `sanitizeSims` drops results while `:365` keeps them; `useWorkspaceEffects.ts:21-23` still says hydrate nulls every result; orphaned doc blocks at `store.ts:387-388` and `:414-424` belong to functions twenty lines away; `motorDb.ts:6-7` says the catalog is mirrored into localStorage while `:80-81` says it is not; `materials.ts:3` and `data/materials.ts:6` say custom materials are "localStorage today"; `motorStore.ts:9` and `templateStore.ts:5` document `setMotorStore`/`setTemplateStore` that do not exist; `flightPathExport.ts:14` says spherical Earth while the code and test use WGS84; `vitest.config.ts:37-38` and `engineBoundary.test.ts:23, 25` cite 83 files / 854 tests; `sync-contributors.mjs:17` names a workflow file that does not exist; `PropertyPanel.tsx:27-28` says "App merges it" (now the store); `AeroAnalysis.tsx:96-99` says the parent memos stop the cards re-deriving their domain, which is not true. Change-log prose ("used to", "the old ...") in `PropertyPanel.tsx:236-246`, `MaterialPicker.tsx:45-56`, `AppHeader.tsx:464-469`, `UpdateToast.tsx:14-29` reads as a diff rather than as code.

---

## MED findings by area

### State and app shell

- **`SettingsProvider` first-run guard is defeated by StrictMode.** `SettingsProvider.tsx:20-27` skips the first effect run with a `useRef` flag. Under `<React.StrictMode>` (`main.tsx:25`) React runs every effect's setup twice on mount and refs persist across that, so the second run sees the flag set and writes `saveSettings(settings)` on mount. That is precisely the "opening an older build destroys a newer build's preference keys" scenario the comment describes, and it happens in the environment developers test in. `SettingsProvider.test.tsx:36` renders without StrictMode. **Fix:** persist from `update` and `reset`, not from an effect.
- **File > Open re-stamps both the outgoing and incoming design.** `store.ts:1187, 1193`, `useWorkspaceEffects.ts:49-59`. `skipNextSave` is set only by the boot loader; `openDesign` flushes A (stamping `updatedAt` even with no edits) then hydrates B, whose state change triggers the autosave. Opening two designs to compare them reorders the library by "most recently updated".
- **Transient run state survives workspace replacement.** `hydrate` (`store.ts:656-676`), `openOrkFile` (`:1136-1149`) and `resetWorkspace` (`:1273-1281`) each reset a different subset of fields; none clears `simRuns`, `lastRunIds`, `resultSimId` or `simBusy`; `resetWorkspace` leaves `err` and issues two separate `set` calls. Every consumer currently defends itself. One internal `replaceWorkspace(patch)` helper in a single `set`.
- **`openDesign` hydrates an unvalidated blob** (see the casts pattern above). Export `validate` and apply it.
- **Hidden module state makes the store non-resettable.** `workspaceGen`, `designsGen`, `batchAbort` and the `txn` closure live outside the store; `resetWorkspace` never aborts `batchAbort` or clears `simBusy`, so a test whose batch never settles poisons the next one (`batchParallel.test.ts:58-81` resets `simRuns` but not `simBusy`).
- **Two desktop-only columns stay mounted on phones.** `App.tsx:178-184, 214-229` render `PropertyPane` and `SimSummary` inside `hidden` sections that no class ever reveals below `lg`; both re-render on every store change on a device that never shows them.

### Canvas components

- **`ChartCard` recomputes domain, stacked bands and every path string on each pointer move.** `AeroAnalysis.tsx:1017-1061`. `hoverM` is root state; each move re-renders all three cards, which build `yMin/yMax`, the `bands` polygons and `linePath` in the render body with no memo. Memoize the block on `[series, machs, machMin, machMax, w, stacked]` and `React.memo(ChartCard)` or move hover into a small store.
- **The kernel aero sweep runs synchronously inside `useMemo` during render.** `AeroAnalysis.tsx:87-98`. Switching Max Mach to M5 freezes the UI for the whole sweep inside a render, so React cannot show a busy state; the `Num` component's comment (:846-853) documents the stall and works around it with commit-on-blur. Run it from an effect (or a worker) with a pending flag, or at minimum `useDeferredValue`.
- **The live renderer is resized for the whole duration of an async export.** `Rocket3D.tsx:863-881`. `setSize(widthPx, outH)` is applied to the on-screen renderer, then the async encode (seconds at 8K) runs before `finally` restores; the always-on frameloop keeps rendering the on-screen camera into the export-sized buffer. Render the export into an offscreen target instead.
- **`TreeSchematic` rebuilds the whole scene on hover enter/leave.** `:331-350`, because `hoverId` is a memo dependency. Return a `Map<id, extent>` once and derive the hover box outside the memo.
- **`FlightChart` wheel effect re-attaches on every zoom/pan/resize** (`:279-290`, with an `exhaustive-deps` disable that hides future stale captures); memo at `:315-327` lists `t0, t1, w` instead of the `X` it calls. Keep the latest handler in a ref and register once.
- **Linear-scan interpolation per hover per stage.** `FlightChart.tsx:656-663` via `interpolate.ts:7-11` walks the sorted time array from the start on every pointer move; the docblocks talk about six-figure sample counts. Binary search.
- **Hard-coded English in an i18n app**: `AftView.tsx:162, 179, 197, 243, 253, 306` (`<title>` text), `TreeSchematic.tsx:536-537, 885`, `Rocket3D.tsx:952-954`, and `schema.ts:12-39` `DISPLAY_NAME` (used for hover titles by `schematicShapes.tsx:200, 658` while the tree panel uses `t('part.*')`; a Spanish user sees English component names on hover).
- **Silent catches around kernel calls.** `AeroAnalysis.tsx:88-90, 131-133` turn `aeroSweep`/`componentMasses` failures into "unavailable" with no log; a kernel regression looks like a blank pane.
- `TreeSchematic.tsx:697-769, 770-842, 858-952` are `(() => {...})()` IIFEs inside JSX for whole sub-views; the `react-hooks/refs` hit at :868 is a false positive caused by this shape. Hoist into named blocks or small components.

### Sim and report components

- **A picked motor is applied after the user cancels the dialog.** `MotorDialog.tsx:230-241`. `pick` awaits a network `fetchMotorSpec`, then calls `onSelect` and `onClose`; Escape and overlay click are not blocked while loading. Generation ref or abort.
- **The seed lookup cannot distinguish the same-name motor pairs.** `MotorDialog.tsx:210-216` matches by manufacturer + designation; `MotorSpec` carries no `code`, and `MotorDashboard.tsx:26-32` documents that F67W and F67C are both "F67" in 29 mm. "Change..." on an F67C-seated mount highlights F67W.
- **Picker rows are keyed by list index**, `MotorDialog.tsx:395-396` (`rowId = mfr:designation:i`), which is the only reason the filter-reset effect exists; `MotorDashboard.keyOf` already solved this and has a uniqueness test.
- **Report assembly is a heavy side effect behind a ref latch.** `ExportDialog.tsx:84-142`. `assembleReport()` rebuilds the live engine handle and writes to the store from an effect guarded by `assembled.current`; the latch also means a design change after open does not update the checkboxes. Initialize `sel` lazily from a one-time call.
- **A failed simulation refresh still produces the PDF.** `ExportDialog.tsx:175-181` swallows `runSim` rejection and writes the report with the previous run's numbers, unmarked.
- **Combined-cluster stats ignore the unit preference.** `MotorDashboard.tsx:347, 624-627` hard-code N and N.s while the grid beside them is in the user's units.

### Design, layout and common components

- **Freeform drag never ends on pointer cancel.** `FreeformFinEditor.tsx:154-163, 80-84` handles move/up but not `onPointerCancel`; a canceled touch leaves `dragging.current` set, the undo entry open, and the next hover dragging a vertex with no button down. `PaneSplitter.tsx:153` does this correctly.
- **`AppHeader` owns submenu state and mutates rendered DOM in an effect.** `:56-61, 98-107`. `items.forEach((el) => (el.tabIndex = -1))` imperatively sets `tabIndex` on React-rendered buttons. Extract `FileMenu`, render `tabIndex={-1}` in JSX, move the undo shortcut into a hook.
- **Tree rows are `role="button"` containing nested buttons.** `ComponentTree.tsx:155-215`. ARIA `button` has presentational children, so the collapse toggle and per-part export menu are invisible to assistive tech. The arrow-key model at :307-351 already implements a tree; use `role="tree"`/`treeitem`.
- **`ScaleDialog` diameter input ignores the field's unit.** `:116-120` fixes `step={1}`, `min={0.1}`, `toFixed(2)` beside a unit-converted value; with meters the spinner steps by 1 m and a 41 mm tube reads `0.04`.
- **`NumberInput` shows full float noise the moment it is focused.** `:88-89`. Blurred value is `fmt(value)` but focus seeds the draft with `String(value)`, so `0.511811` becomes the 16-digit string on focus, the exact "field fights the user" symptom the component exists to prevent.
- **Settings persisted on every keystroke, default written mid-edit.** `SettingsDialog.tsx:286-410` wires `onChange` straight into the persisting `update` and maps a cleared field to the default; `onCommit` is unused here.

### Import/export services

- **Recovery device packed length and radius lost on export.** `orkExport.ts:601-602, 641-642, 661-662` vs `orkImport.ts:464, 491, 507`: import reads `<packedlength>`; export writes literal 0.025 and 0.0125. Packed length places the device's mass in the desktop, so CG shifts on reopen.
- **Rail button geometry and material replaced with constants.** `orkExport.ts:587-593`, `orkImport.ts:441-447`: five dimensions and a Delrin material overwritten on every save.
- **RASAero surface mapping diverges from the Java it cites.** `rasaeroExport.ts:38-46` vs `RASAeroCommonConstants.java:370-391`: SMOOTH maps to "Camouflage Paint" in Java and "Smooth Paint" here; `optimum`, `mirror`, `roughunfinished` have no entry and fall to "Rough Camouflage Paint" at :446, so an optimum-finish rocket exports as the roughest paint.
- **No bounds on file-sourced counts.** `orkImport.ts:305, 322, 343, 358, 471, 538, 912`: `fincount`, `instancecount`, `linecount`, `<finpoints>` count go through `Math.round` with no ceiling; `<fincount>1e9</fincount>` reaches the kernel's fin loop. The hostile test covers archive size, nesting and config count only.
- **A primary mount with no motor flies a C6.** `wireLoadedOrk.ts:41, 50` seeds C6 into empty mounts while `loadOrk.ts:79-87, 99-109` spends two comments arguing the app must never silently fly a default for a file's mount. Two modules, opposite policies.
- **Silent drops in the RASAero sustainer chain.** `rasaeroExport.ts:367-372`: `podset`, `parallelstage` and unknown externals are skipped with no warning, so a strap-on booster design exports as a clean single-stage rocket; `RailGuideDiameter`/`RailGuideHeight` are always 0 although `railbutton` carries a diameter.
- **Wind CSV accepts an `altitudeagl` header and drops its meaning.** `windProfileCsv.ts:33`; headers are also not unquoted, so `"altitude (m)"` fails.
- **Four functions over 350 lines built from closures**: `exportOrk` (900 lines, 435-line `emitNode` switch at `orkExport.ts:293-728`), `importOrk` (690, `orkImport.ts:29-719`), `exportCdx1` (415, `rasaeroExport.ts:141-555`), `downloadReportPdf` (390, `reportPdf.ts:136-523`). Split `emitNode` into a `Record<ComponentType, Writer>` and share a `COMPONENT_DEFAULTS` table with the importer and `dxfExport`.

### Storage and domain services

- **Unload journal has no timestamp, so a stale journal from a closed tab can overwrite a newer save from a live one.** `workspaceStore.ts:56-61, 130-151, 263-269`. `save()` at :238 is also last-writer-wins with no `updatedAt` check.
- **Custom material, template and motor lists are read-then-set, not `update`.** `materialStore.ts:73-80`, `templateStore.ts:99-106`, `motorStore.ts:158-170`: `KeyValueStore.update` was added for exactly this lost-update case and only the design index uses it.
- **Component catalog validated as "any object" and a bad shape memoized forever.** `componentDb.ts:84-104`: `{"error":"rebuilding"}` passes the gate, `catalogP` caches it, and the picker throws on every open for the session; the remote-host fallback never triggers because the shape passed.
- **`addPart` does not enforce `allowedChildren`.** `treeEdit.ts:526-541` trusts the Add menu; any second caller can nest a fin set under a parachute and the kernel builds it.
- **Quota failure reported as "IndexedDB unavailable" and never cleared** (`idbKeyValueStore.ts:72-96, 224-246`; see the persistence pattern above).
- **`loadSettings` validates some sub-objects and not others.** `settings.ts:513, 605-611, 618-629`: `partColors` is filtered to hex strings because they reach a style attribute; `phaseColors` reaches the same place unchecked, as do `report.paper`, `report.orientation`, the five `flightCsv` booleans and `railExitVelocityMin`.

### Engine bridge and tree

- **The warm-up `ping` has no timeout and can pin a pool slot forever.** `simClient.ts:311-315, 202-205`: no `timeoutMs` means no timer; `simWorker.ts:22` awaits the WASM fetch before replying. On a 2-core machine the pool is one slot, so every later sim sits in "queued" until the reaper.
- **A worker whose engine failed to load is never retired.** `simWorker.ts:15-24`, `simClient.ts:129-149`: the module-level `ready` rejection is unhandled, every request replies `ok:false` with the load error, and the client keeps dispatching to the dead engine.
- **The JSON-returning accessors bypass `callEngine`.** `openRocketEngine.ts:1019, 1026, 1036-1047, 1072, 1078-1108, 1119`: `staticInfo`, `componentInfo`, `aeroSweep`, `componentMasses`, `simulate`, `resetEngine` call `eng()` raw and `JSON.parse` bare, so a WASM trap reaches the store as an opaque `RuntimeError: unreachable` with no operation name.
- **`FlightSeries` named arrays are typed `number[]` but the wire carries `null`.** `openRocketEngine.ts:608-633`: the doc comment says NaN/Infinity arrive as `null` and the named arrays share that behavior, yet they are declared `number[]`; consumers doing `series.altitude[i] * k` silently see 0.
- **`?engine=js` and the `engine` localStorage override do not reach the sim worker.** `openRocketEngine.ts:237-247` reads `location.search` and `localStorage`; in a dedicated worker `location` is the script URL and `localStorage` is undefined. A bug report captured with the override still simulates on WASM in the worker.
- **`WorkerRequest` is not a discriminated union and results are cast, not checked.** `simProtocol.ts:25-31`, `simClient.ts:283-285`, `simWorker.ts:30`. The planned `aeroSweep`/`staticInfo` methods will multiply the cast sites.
- **`scaleRocket` silently skips unknown component types** and **`position` is cast, not validated** (see the two patterns above).

### Tests, tooling and CI

- **The 2 minute web gate is serialized behind the 20 to 60 minute Java parity job.** `gates.yml:245, 318`: `build-and-test` and `e2e` both `needs: [parity, ...]`, so a PR touching only `web/src` cannot get a lint or unit result until the JVM reference and four TeaVM builds finish. Letting all jobs gate in parallel achieves the same guarantee.
- **Coverage is emitted but never surfaces.** `gates.yml:274`: `text-summary` to the job log, `lcov` to disk, no artifact, no step summary, no floor. Totals are 58% lines, 47% branches.
- **No single local command mirrors the CI gate set.** `package.json:32`: `build` runs typecheck + lint + vite; format, spell, test and knip are separate. Add `verify` and have CI call it.
- **E2E asserts state through Tailwind classes and glyphs.** `aero.spec.ts:24, 27` (`/bg-sky-600/`), `units.spec.ts:15, 30, 64, 79, 85`, `a11y.spec.ts:132`, `mobile-layout.spec.ts:227, 253-254, 266, 313`, `motor-dashboard.spec.ts:60`, `report-dialog.spec.ts:31, 59, 87` (`/menu|☰/i`). A palette change (there is a Colors settings tab) breaks a dozen tests with no behavior change. The aero-table spec already does this right with `aria-pressed`.
- **One-shot DOM snapshots with positional `table[k]` and `!` instead of auto-waiting locators.** `aero-table.spec.ts:4-11, 29-31` (37 non-null assertions), `aero-conditions.spec.ts:11-14`, `mobile-layout.spec.ts:30`. `page.evaluate` does not retry, and a miss fails with `TypeError` rather than an assertion naming what was missing.
- **`mobile-layout.spec.ts` is 651 lines covering six unrelated features** with the `L/D` readiness wait copied 18 times; the `.ork` import-and-wait helper is copied in three other specs. Add a `ready(page)` fixture.
- **Queued `mockXOnce` values in `store.test.ts` are never reset between tests** (`:384, 395, 410, 485, 524`; first `mockReset` is `:541`), so an assertion that throws before `runSim` consumes the queued rejection leaks it into the next test.
- **No type-aware or test-aware lint rules.** `tseslint.configs.recommended` rather than `recommendedTypeChecked`; no `eslint-plugin-playwright`; so `no-floating-promises` and `missing-playwright-await` (the false-pass class) are not enforced. None found today by grep.
- **Single desktop Chromium project; phone layouts tested by resizing a desktop viewport.** `playwright.config.ts:30-37`: no touch events, no DPR, no WebKit, so the touch and hover behavior the mobile layout is about is never exercised, and the IndexedDB fallback paths never run in a real second browser.
- **Ten of the largest UI modules have 0% unit coverage and e2e coverage is not measured**: `TreeSchematic.tsx`, `FlightPath3D.tsx`, `SettingsDialog.tsx`, `SimEditor.tsx`, `ComponentTree.tsx`, `AppHeader.tsx`, `CenterView.tsx`, `AftView.tsx`, `SimulationsTable.tsx`, `App.tsx`; `AeroAnalysis.tsx` is at 14%, `FlightChart.tsx` at 8%. The pure-helper extraction already done for `flightChartAxis`/`flightChartTraces`/`schematicGeometry` is the pattern to continue (AeroAnalysis table building and heat formulas are the obvious next candidates).

---

## LOW findings (condensed)

- `restore` marks every carried result outdated regardless of what the undo touched (`store.ts:550-564`); undoing a simulation rename re-flies every simulation with `autoRunOutdated` on.
- A second `runSims` orphans the first batch from Cancel (`store.ts:957-958, 1054-1057`); only reachable from `ExportDialog`'s `runSim`.
- `main.tsx:20-22` swallows the engine boot error with no trace.
- `UpdateToast.tsx:83` calls `Date.now()` in render; redundant with the snooze timer effect, so `snoozed === null` is the whole answer.
- `TreeSchematic.tsx:64` `rulers` default is a fresh object literal per render (latent; the only caller passes a stable object).
- `FlightChart.tsx:566-588` reassigns `dMin`/`dMax` inside a `.map`, which blocks compiler memoization of `Panel`.
- drei `<Line points>` given array literals in `Rocket3D.tsx:767, 1088-1091` rebuilds `LineGeometry` on each render (cheap today).
- `FlightPathExport.tsx:296-316, 270-283`: `buildFlightPathModel` and `store.list()` run outside their `try`; `change()` at :197-201 merges from the closed-over `opts`.
- `MotorSpecDialog.tsx:52-58` attaches the focus trap to the backdrop, not the panel, and has no `aria-labelledby`; `ComponentPicker.tsx:95` same.
- `LaunchPanel.tsx:316-317, 544-545`: direction fields display 90 when unset but write 0 when cleared.
- `WindProfileDialog.tsx:215-218` and `AftView.tsx:376, 440-442` use index keys on deletable/rebuilt lists (currently safe).
- `MaterialPicker.tsx:434-443, 355` bypasses `NumberInput` with a raw `<input type="number">` plus `parseFloat`; `:375` maps every remove failure to "storage full".
- `DesignLibraryDialog.tsx:101` formats timestamps with the browser locale, not the app language.
- `ComponentTree.tsx:356, 365` and `useSelectedComponent.ts:86` compute `findNode(tree, selectedId)` three times; `PropertyPanel.tsx:250, 431` duplicate the default-shape expression; `:340-480` inlines six field-kind branches that build the same `NumberField`; `SettingsDialog.NumRow` at :510-526 renders itself to add a hint; `t` is passed as a prop in `ComponentTree.tsx:121, 134` and `UpdateToast.tsx:96-99`.
- `thrustcurve.ts:77` throws a timeout without `cause`; `:247-250` `isSpec` validates cached specs by array length only, so a spec cached before the NaN fix still passes.
- `orkExport.ts:381-455` writes `<angleoffset>0.0` and `<rotation>` with different values; the desktop applies both to the same property and ours survives only by document order.
- `orkImport.ts:765-768, 1014` mix `parseFloat(x) || 0` (passes `Infinity`) and `Number(textContent ?? '0')` with the `numTag` idiom used elsewhere; `:94-102` duplicate `configid`s are not deduplicated.
- `reportPdf.ts:503-504` spreads a freeform outline into `Math.max`, the exact overflow `dxfExport.ts:93-96` avoids.
- `orkExport.ts:731` and `schematicExport.ts:47` write `creator="ArsRocketJs Sim"`; the i18n storage key at `i18n/index.ts:35` and the thrustcurve cache prefix at `thrustcurve.ts:224` carry the `astrarrocketjs` double-r (persisted, so leave them); the `engine` override key at `openRocketEngine.ts:241` is not namespaced at all.
- `flightPathExport.ts:1169-1177` mutates `Mustache.escape` globally per render (restored in `finally`; pass it per call instead).
- `settings.ts:483, 633` return the shared mutable `DEFAULT_SETTINGS` on the empty and error paths.
- `remoteData.ts:108` does not abort a non-2xx body; `:144-156` memoizes `{}` on a transient manifest failure; progress restarts at 0 when falling back to a second base.
- `idbKeyValueStore.ts:179-188` exports `__resetIdbForTests` from the production module; `treeEdit.idCounter` and `componentDb.catalogP` have no reset at all.
- `treeEdit.ts:18, 32-41` deep-clones the whole tree with `structuredClone` per keystroke; path-copy the spine.
- `simClient.ts:129-146` has no `messageerror` handler (a clone failure waits the full timeout, then kills a healthy worker); `openRocketEngine.ts:256-273` honors only the first caller's `onStatus`; `EngineCallError` stores the cause in `engineCause` instead of `cause`; `openrocket-engine.d.ts:3-51` declares an unused handle-based builder API and an unexposed `setStubbyNoseDrag`.
- `i18n/index.ts:11-23` maintains `LANGUAGES` and `resources` by hand; five `en.json` keys are unreferenced (`sims.title`, `limits.blocked`, `motor.selected`, `aero.hoverHint`, `aero.other`) and the parity test cannot see that.
- `vite.config.ts:113` `optimizeDeps.exclude` with a relative source path is a no-op; `:63, 78-90` precaches 2.6 MB of catalogs that are then fetched again from the CDN and cached a second time.
- Three tsconfigs at three `lib`/`target` levels (ES2020 / ES2022 / ES2023); the runtime floor is WASM-GC browsers, so ES2022 everywhere is safe.
- `three-stdlib` is a runtime dependency used only in a type position (`Rocket3D.tsx:923`).
- `cspell.json` misses `web/index.html`, the workflow files and `website/src`.
- `playwright.config.ts:23-24` retries in CI with no flaky-test reporting; three hard sleeps remain in `library.spec.ts:42, 68` and `smoke.spec.ts:71`.
- `sync-components.mjs:18` defaults to a personal absolute path and fails with a bare ENOENT.
- `index.css:3-5, 118-129` declares `:root` in two blocks.

---

## Evaluation of the automated hits

Run with every `react-hooks` rule the compiler plugin ships, plus `eqeqeq`, `no-non-null-assertion`, `no-console`, `preserve-caught-error`. Counts exclude the vendored engine.

| Rule                                                               |                          Hits | Verdict                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------ | ----------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-non-null-assertion`                                            | 977 (about 500 outside tests) | Benign with two exceptions: `TreeSchematic.tsx:357-363` (`marginPct!` when `info.length <= 0` yields null), `store.ts:775` (`extraMotors[mountId]!` relies on an invariant maintained in another module). `Rocket3D.tsx:164` `outline[0]!` could not be proven safe if `finPlanformPoints` can return `[]`. Everything else is an index read after an explicit length check. |
| `eqeqeq`                                                           |                           114 | All `== null` / `!= null` nullish idiom. Not a problem; if the team wants strict-only, `NumberInput` never emits `undefined` so `=== null` would be correct at its consumers.                                                                                                                                                                                                |
| `set-state-in-effect`                                              |                            19 | 4 real (`MotorDialog` x2, `FlightChart` x2), 5 dead code (`ExportDialog:98`, `DesignLibraryDialog:54` and the three always-mounted dialog reseeds once they mount conditionally), 6 standard fetch-status patterns (benign), the rest one-render-late resets that belong in handlers.                                                                                        |
| `refs`                                                             |                             9 | 4 real (`FlightPath3D`), 2 workarounds (`AftView:322`, `DesignLibraryDialog:46`), 3 false positives (`App.tsx:177, 213` pass a ref object through a render helper; `TreeSchematic:868` is inside an `onClick` within a JSX IIFE).                                                                                                                                            |
| `memo-dependencies`                                                |                             4 | `FlightChart:318` real but equivalent (lists `t0,t1,w` instead of `X`); `AftView:142` and `ComponentTree:270, 293` benign.                                                                                                                                                                                                                                                   |
| `immutability`, `preserve-manual-memoization`, `purity`, `globals` |                        1 each | `FlightChart:584` blocks compiler memoization; `TreeSchematic:410` benign; `UpdateToast:83` redundant `Date.now()`; the `globals` hit is in a test file.                                                                                                                                                                                                                     |
| `no-console`                                                       |                             2 | Both intentional (`[engine]` backend banner and WASM fallback warning).                                                                                                                                                                                                                                                                                                      |
| `preserve-caught-error`                                            |                             1 | `thrustcurve.ts:77`.                                                                                                                                                                                                                                                                                                                                                         |
| `exhaustive-deps` disables                                         |                             5 | `MotorDialog:196` hides the HIGH bug; `RocketConfigDialog:33` hides that `tree` is frozen at open with no comment; `FlightChart:205, 290, 327` are safe today but brittle.                                                                                                                                                                                                   |

Recommendation on the lint config: enable `react-hooks/set-state-in-effect` and `react-hooks/refs` as `warn` once the dialog-mounting cleanup lands; they would have flagged the render loops that `library.spec.ts:12-18` and `report-dialog.spec.ts:5-11` now regression-test. Add `eslint-plugin-playwright` for `e2e/**`.

---

## What is done well

- **Type discipline.** Strict TypeScript with `noUncheckedIndexedAccess`, no `any`, no `@ts-ignore`, and only ten `as unknown as` casts, each at a genuine boundary (worker globals, TeaVM globals, navigator).
- **Zustand.** Every selector returns a primitive or a stored reference; the ones that would build a fresh value are documented as not-for-subscription (`store.ts:296-320`) and consumers derive with `useMemo` (`RunButton.tsx:17-22`, `SimEditor.tsx:52-60`, `CenterView.tsx:83-117`). `getState()` is used in global keyboard handlers to avoid stale closures.
- **Race handling.** `claimWorkspace`/`observeWorkspace` generation tokens, `designsGen`, identity checks at install time (`store.ts:990-1001`), controller identity in `finally`, `hydrationGen` to distinguish restore from edit, and all of it tested with held-open promises (`batchParallel`, `batchFailures`, `batchSkip`).
- **Shared primitives.** `NumberInput` (string draft while focused, `null` for empty, `onCommit` on blur, `parseFieldValue` exported and tested), `useUnits().at(scope, q)` returning a bound `FieldUnit`, `chartAxes.tsx` de-duplicating the SVG scaffolding across three charts, `PaneSplitter` deriving width from pointer position with `pointercancel` handled and `useSyncExternalStore` for resize, `confirmStore` as a promise bridge usable from non-React code.
- **Resource discipline in the canvas.** Geometry and textures disposed on change, every `ResizeObserver` and native listener has a cleanup, rAF is canceled, non-passive `wheel` listeners for `preventDefault`, `useId` for SVG ids, pointer capture with the pan-slop fix, `alive` guards on async export restore. The expensive geometry is extracted into pure, exported, tested functions (`computeSchematicLayout`, `calloutLayout`, `buildFlightScene`, `buildPieces`, `fitCameraToBox`, `buildLinePath`).
- **Storage tier.** `idbKeyValueStore.tx` resolves writes on `oncomplete`, not `onsuccess`, with the real failure it fixed written down; `txUpdate` keeps get and put in one transaction; refused writes propagate as booleans through every store that holds the user's only copy; `DesignLibrary.remove` orders the index write before the blob deletes and documents why; `remoteData` and `thrustcurve` split time-to-first-byte from body budgets, meter bytes received against a cap, and never cache a rejection.
- **Parsers and exporters.** Zip-bomb, entry-count, nesting-depth and configuration-count caps with tests that assert the cap's own message; one `escapeXml` applied to every file-sourced string; array-plus-`join` for every large output; machine formats use `toFixed`/`Number`, never locale formatters; `validateSolid` as the single mesh choke point with `makeWatertight` rolling back on a failed loop walk.
- **Engine bridge.** Engine generation counter and `StaleDesignError` turn use-after-reset into a typed error; `assertFiniteCurve` names the motor and field; one call per worker so a hang kills one flight; timeout starts at dispatch; `release` settles before `pump`; reaper timers `unref`'d for the test runner.
- **Kernel parity tests.** `finPlanform.kernel.test.ts` reads the committed Java, re-derives the formulas independently, and includes a recurrence guard that fails if any other module grows its own `Math.sin(Math.PI...)`; `kernelDefaults.kernel.test.ts` is behavioral and asserts its own sensitivity; `engineBoundary.test.ts` and `.wasm.test.ts` drive the real kernel on both backends and pin the error-behavior difference.
- **Tests and CI.** No snapshots, no `.only`/`.skip`, every fake timer and stub restored, `e2e/base.ts` replaced 76 swallowed clicks with one fixture and polls IndexedDB instead of sleeping, `gates.yml` is one `workflow_call` shared by PR and deploy so master cannot drift from the PR gate, exact Temurin pin plus byte-diff of committed engine artifacts, `sync-catalogs.yml` pins the third-party ref and never cancels a half-finished publish.
- **Provenance comments.** Physical constants carry their source (`recoverySizing`, `safetyLimits`, `windTurbulence`, `settings`), and unit conventions cite the Java file and line (degrees vs radians, Kelvin, Pascal, intensity ratio). That is what made verifying the `.ork` findings against the source possible.
- **Accessibility.** Focus traps, `aria-pressed`/`aria-current`/`menuitemradio`, an always-mounted `role="status"` region for geolocation, indeterminate header checkbox, no color-only status, keyboard paths for crosshairs, calipers and the export menu.

---

## Recommended order of attack

### 1. Small, independent, shippable today

- `treeEdit.newId` to `uuid()`, plus a collision test.
- `flightPathExport.ts:1137` escaper: exempt numeric strings; add a negative-longitude test; pin `reportCsv.ts:31`.
- `useFocusTrap.ts:38-39`: skip the move when the panel already contains the active element. `ConfirmDialog.tsx:30-37`: drop the global Enter mapping. Add a trap test that stubs `offsetParent`.
- `shapeProfile.ts:117-137`: finite guard and an iteration cap.
- `idbKeyValueStore.ts:41`: `onversionchange` handler.
- `simClient.ts:311-315`: give the warm-up ping a generous timeout.
- `store.ts:601-607`: `flushActive` returns a boolean; `saveDesign` raises the banner on refusal.
- `store.ts:1189, 1245, 1252` and `designLibrary.ts:201-207`: check the refusal booleans.
- `SettingsProvider.tsx:20-27`: persist from `update`/`reset`; add a StrictMode test.
- `sync-motors.mjs`: count floor and truncation check.

### 2. The `.ork` round-trip cluster (do it as one change with a desktop-authored fixture)

`altituderef` attribute, the four hard-coded launch fields, recovery packed length/radius, rail button geometry, fin `angleoffset`, count ceilings on `fincount`/`instancecount`/`finpoints`, the `wireLoadedOrk` C6 policy. One `.ork` saved by OpenRocket 24.12 with a multilevel AGL wind, a rail button and a parachute with a real packed length would have caught most of these.

### 3. The dialog-mounting convention (one change, removes most lint hits)

Mount `MotorDialog`, `MotorSpecDialog`, `WindProfileDialog`, `RocketConfigDialog`, `ScaleDialog` and `DesignPropertiesDialog` only while open, as `AppHeader` already does. Delete the reseed effects, the two refs in `MotorDialog`, the dead `!open` branches in `ExportDialog` and `DesignLibraryDialog`, and the `open` props. Fold Escape into `useFocusTrap` (rename `useModal`) and delete the sixteen copies. Then enable `set-state-in-effect` and `refs` as warnings.

### 4. Consolidate the drifted copies

`useCatalog` + `MotorFilterBar` + one `Chip`; one motor-math module with a sourced `G0`; `stabilityState` everywhere; delete `Rocket3D.axialStart`; one `hasUsableCurve`, one `surfaceLevel`, one `activeExtraMounts`, one `DEFAULT_HEADING_DEG`, one `CHAIN_TYPES`; `COMPONENT_DEFAULTS` shared by `orkImport`, `orkExport` and `dxfExport`; move `FIN_DEFAULTS`, `KERNEL_BODYTUBE_OUTER_RADIUS` and per-type lengths into `KERNEL_DEFAULTS` and have `axialLength` read them; type the `scaleRocket`/`cluster`/`assembly`/`tubefins` tables on `ComponentType`; one `positionOf` reader in `nodeProps.ts`.

### 5. Canvas performance

`FlightPath3D` playback to `useFrame`; `ChartCard` memoization and hover state out of the root; the aero sweep off the render path; `TreeSchematic` hover map; offscreen export target in `Rocket3D`; binary search in `lerpAt`.

### 6. Gates and tests

A lightweight workflow on every push; `npm run verify`; the web gate unblocked from the Java parity job; coverage to the step summary with a floor; `eslint-plugin-playwright`; ARIA-based e2e selectors replacing Tailwind class assertions; split `mobile-layout.spec.ts`; a `ready(page)` fixture; `simulateMock.mockReset()` in `store.test.ts`; a mobile Chromium project; an unreferenced-key test for `en.json`.

### Deliberately deferred

The four 350+ line exporter/importer functions and the six 500+ line components (`AeroAnalysis`, `Rocket3D`, `TreeSchematic`, `MotorDashboard`, `PropertyPanel`, `AppHeader`) are large but mostly declarative, and each already delegates its expensive logic to pure tested helpers. Splitting them is worth doing but is a refactor with no behavior at stake; do the duplication consolidation in section 4 first, which shrinks them for free.

---

## Fixed in this round (2026-09-20)

Same day as the audit. Six parallel passes, one per section of the order of attack, each with its own file set; the orchestrator did section 1 by hand and the cross-pass follow-ups. Every fix carries a regression test and a rationale comment at the site, in the file's existing style.

### Section 1: the small independent fixes (all done)

- `treeEdit.newId` mints a UUID; a test loads a fresh module instance against a tree holding `bodytube-1` and proves the new part cannot alias it.
- `flightPathExport` CSV escaper exempts numeric strings; negative longitudes and altitudes render as numbers, formula triggers are still quoted.
- `useFocusTrap` leaves focus where `autoFocus` put it; `ConfirmDialog` no longer maps a window-level Enter to confirm. `ConfirmDialog.test.tsx` stubs `offsetParent` so jsdom sees the focusable elements.
- `shapeProfile.calculateClip` guards non-finite input and caps the bisection at 60 halvings.
- `idbKeyValueStore` sets `onversionchange` so an old tab yields to a schema bump.
- `simClient.warmSimWorker` pings with a 120 s ceiling.
- `flushActive` returns a boolean; `saveDesign` returns `true | 'unnamed' | false` and raises the storage banner on refusal; `AppHeader` only opens Save As for `'unnamed'`. `openDesign` validates the blob the way the boot path does and stops on a refused `setActive`; `renameDesign` and `deleteDesign` check their booleans; `DesignLibrary.create` throws on a refused pointer write.
- `SettingsProvider` persists from `update` and `reset`, not from an effect; a StrictMode test pins it.
- `sync-motors.mjs` refuses to write a catalog that is empty, lost more than 10% of rows, has under 80% curves, or hit the API page cap; `sync-components.mjs` has the same floor.

### Section 2: the `.ork` round-trip cluster (all done)

`altituderef` is read and written as the attribute on `<wind>` with the old spellings kept as read fallbacks; the four launch fields are written from `launch` and read back; recovery packed length and radius, rail button dimensions and material, and the fin `angleoffset`/`rotation` pair round-trip; count ceilings on `fincount`, `instancecount`, `finpoints` and `linecount` with hostile-test cases; one `finiteNum()` parser; the RASAero finish table transcribed from the Java with the desktop's warning text; `podset`/`parallelstage` in the sustainer chain now throw; rail buttons map to the RailGuide fields; `windProfileCsv` returns the AGL/MSL reference and unquotes headers; the `thrustcurve` timeout carries `cause` and cached specs are finite-checked; `reportPdf` and `finPlanform.finSpan` loop instead of spreading; the creator string comes from `appInfo`. A primary mount with no motor in the file now seats an empty placeholder that the run gate blocks, matching the stated `loadOrk` policy, instead of a silent C6. New `componentDefaults.ts` holds the fallbacks shared by `orkImport`, `orkExport` and `dxfExport`, re-exporting kernel values from `kernelDefaults.ts`; the bodytube thickness, transition length, engine block wall and bulkhead length fallbacks that had drifted between the three files now all read the kernel value. `orkDesktopFixture.test.ts` is an inline `.ork` written element for element from the Java savers (multilevel AGL wind, aluminum rail button, 60 x 20 mm packed chute, non-default launch fields); it fails against the pre-fix code.

### Section 3: the dialog-mounting convention (all done)

`MotorDialog`, `MotorSpecDialog`, `WindProfileDialog`, `RocketConfigDialog`, `ScaleDialog` and `DesignPropertiesDialog` mount only while open; the reseed effects, the `open` props, the two refs in `MotorDialog`, the dead `!open` branches and every `exhaustive-deps` disable they justified are gone. `useFocusTrap(active, { onEscape })` owns Escape and the sixteen window listeners are deleted (`ResultPicker` keeps its own because it is a menu, not a modal). The `MotorDialog` delay leak has a test (seat X with delay 7, reopen, pick Y, the delay is Y's default); the pick race drops a result that lands after close; rows are keyed on `keyOf(m)`.

### Section 4: the drifted copies (all done)

`useCatalog`, `MotorFilterBar`, one `Chip`, `motorFormat.ts`, `services/motorMath.ts` with a sourced `G0`, `CHART_HEADROOM`; `stabilityState` and `STABILITY_GLYPH` used by the 3D callout and the info overlay (which previously graded a 7 cal design green and now reads amber "over" like the badge); `Rocket3D.axialStart` and the `schematicGeometry` copy replaced by the `tree/position` one; `colorOf`, `MotorDims`, `zoomAbout` and a `useWheelZoom` hook shared by the 2D views; `hasUsableCurve` (two finite samples) used by the run gate, the builder, `motorDb`, `motorStore` and `api.buildRocketTree`; `surfaceLevel` used by `simConditions` and the safety check; `activeExtraMounts`; `DEFAULT_HEADING_DEG`; `componentKinds.ts` with `CHAIN_TYPES`, `ASSEMBLY_TYPES`, `FIN_SET_TYPES` and every dispatch table typed `Record<ComponentType, ...>`; `positionOf` validates `method` and `offset`; `KERNEL_DEFAULTS` is `Record<ComponentType, ...>` with per-type lengths, the fin defaults and the body tube radius, each cited and each pinned by a behavioral case in `kernelDefaults.kernel.test.ts` (33 new cases plus a completeness check); `axialLength` reads it, so a bulkhead missing its length now lays out at the kernel's 2 mm rather than a parachute's 25 mm. `addPart` enforces `allowedChildren`; `updateNode` path-copies the spine. Storage: the three custom-item stores go through `kv.update`; the component catalog gate checks that `components` is an array and filters rows; the unload journal is stamped and skipped when the index is newer; a `QuotaExceededError` no longer marks the session degraded; `loadSettings` validates `phaseColors`, `report.paper` and `orientation`, the `flightCsv` flags and `railExitVelocityMin`, and clones the defaults. Engine bridge: `simProtocol` is a discriminated union with per-method result types; a worker whose engine failed to load replies `fatal` and is retired; `onmessageerror` kills the slot; the JSON accessors go through `callEngine` and `parseEnvelope`; `simulate()` sanitizes the named series at the boundary; the backend preference reaches the worker; `EngineCallError` sets `cause`; the override key is namespaced. Layering: `ViewMode` and `isResultView` live in `state/tabs.ts`; `reportGeometry` imports from `tree/position`. `store.replaceWorkspace(patch)` resets the transient block in one `set` and aborts a running batch; `hydrate`, `openOrkFile` and `resetWorkspace` use it. i18n: 13 dead keys removed from both locales, a `keys.test.ts` that greps every key (with an audited dynamic-prefix allowlist), `LANGUAGES` and `resources` derived from one array, and every hard-coded English string in the canvas routed through `t()`.

### Section 5: canvas performance (all done)

`FlightPath3D` playback runs in one `useFrame` inside the Canvas: the model is posed in place, the trail is revealed by `instanceCount` on one uploaded line, the follow camera is folded in, and React state is only the HUD at 10 Hz; `indexForProgress` and `modelPoseAt` are pure and tested. `AeroAnalysis`: the sweep runs from an effect with a pending state and `aria-busy`, `ChartBody` is memoized without `hoverM`, the clamp and last-hover effects are gone, kernel failures are logged with their operation, and the table and heat logic is in `aeroTables.ts` (16 tests). `TreeSchematic` builds a hover extent map once, the caliper IIFEs are components, `DEFAULT_RULERS` is module scope, the margin assertion is folded. `FlightChart` stores exclusions, clamps zoom at read time, is keyed on `flight.id` in `CenterView`, registers the wheel listener once, and the three disables are gone. `lerpAt` is a binary search tested against the linear scan. `Rocket3D` freezes the frameloop during export and restores it in `finally` (an offscreen target was judged too risky for an 8K second context). Not verified headless: playback smoothness, the export under a frozen loop, and the 2D hover overlay position.

### Section 6: gates and tests (done, with the src-dependent part listed under Still open)

`.github/workflows/dev.yml` runs the web gates on every push to the development line; `gates.yml` no longer serializes the web job behind the Java parity job, appends coverage totals to the step summary, and uploads `lcov.info` and the Playwright HTML report; `npm run verify` mirrors the CI gate list (format, spell, typecheck, lint, knip, test); a 55% line floor (measured 62%); `eslint-plugin-playwright` and `@vitest/eslint-plugin` are on; the POSIX version scripts are fixed; `tsconfig` targets ES2022; `three-stdlib` is a dev dependency; cspell covers the workflows and `index.html`. E2E: `base.ts` has `ready`, `importOrk`, `defined`, `box` and `tableUnder`; the glyph selectors use accessible names; `mobile-layout.spec.ts` is five specs; the aero specs read tables by heading and name what is missing; the library sleeps are `expect.poll`; a Pixel 7 project runs the phone specs (which found a DPR bug in the 3D buffer check). `store.test.ts` resets the sim stub before every test.

### Gates after this round

`npm run verify` passes end to end: `tsc` on all three projects, `eslint --max-warnings 0`, `prettier --check`, `knip` and `cspell` are clean, and the unit suite is 146 files / 1725 tests (was 128 / 1467). The Playwright suite passes 146 / 146 across the desktop and Pixel 7 projects; two specs needed their reads polled because the aero sweep now lands one render after the input that triggers it.

### Second pass, same day: the deferred items

Everything the first pass listed as open was closed in a second pass.

- **E2E assertions on palette classes.** All eight now assert through ARIA (`aria-pressed` on the view and sweep buttons, `aria-current` on the bottom tab), computed style (`toHaveCSS` for no-wrap), or a data hook (`data-ruler-unit` on the ruler caption, `data-crosshair` on the two crosshair lines). The unit chip test asserts the accessible name only; the tint is presentation. No `toHaveClass` remains in the suite.
- **React Compiler lint rules.** Twelve rules are on as errors in `eslint.config.js` (`set-state-in-effect`, `refs`, `purity`, `immutability`, `memo-dependencies`, `preserve-manual-memoization`, `globals`, `error-boundaries`, `static-components`, `component-hook-factories`, `use-memo`, `set-state-in-render`) with zero suppressions. The fetch-status pattern in `useCatalog`, `ComponentPicker` and the aero sweep is now derived state (`{ landed, attempt }` or `{ sweep, run }`) instead of a setState at the top of an effect; the recursive closures inside `useMemo` in `AftView` and `ComponentTree` are module-level functions; `App.tsx` renders a `SideSplitter` component instead of passing a ref through a helper.
- **Offscreen 3D export.** `useRocketExport` renders the scene into a multisampled `WebGLRenderTarget` clamped to the renderer's maximum texture size, applies tone mapping and the sRGB transfer in a second full-frame pass (three only does that when rendering to the canvas), un-premultiplies alpha, reads the pixels back, and flips rows into an offscreen 2D canvas for the existing header and encode path. The on-screen canvas is never resized or frozen; the old path remains as a logged fallback. A new e2e downloads the PNG, decodes it, and asserts real pixel variance and that the fallback warning never fired; it passes in headless Chromium.
- **The large functions and components are split.** `exportOrk` is a `Record<ComponentType, NodeWriter>` table plus named block writers under `services/ork/`; `importOrk` a reader table plus named capture functions; `exportCdx1` eight files under `services/rasaero/`; `downloadReportPdf` page-section functions over a `PdfPage` cursor under `services/report/`. Golden tests written before the refactor (with a counter-mocked `uuid` and a recording jsPDF stub) pin byte-identical output; the four entry files are now 69, 71, 107 and 77 lines. `AeroAnalysis` (1185 to 332), `TreeSchematic` (1033 to 554), `Rocket3D` (1174 to 247), `FlightChart` (779 to 268), `MotorDashboard` (765 to 250), `PropertyPanel` (641 to 229) and `AppHeader` (243 to 114) each compose extracted pieces with a docblock saying what each piece owns. Every original export name is still importable from its original path.

Note on the golden tests: the audit praised the absence of snapshot tests, and the goldens are snapshots. They exist for one purpose, to prove a pure refactor changed nothing, and that is the one job a snapshot does well. If an exporter's output is changed on purpose, the snapshot is updated in the same change and the diff shows the reviewer exactly what moved.

### Gates after the second pass

`npm run verify` passes: prettier, cspell, `tsc` on all three projects, `eslint --max-warnings 0` with the compiler rules, `knip`, and 154 files / 1771 unit tests. Playwright passes 147 / 147 across the desktop and Pixel 7 projects.

### Still open

Nothing from this audit. Two things are worth a manual look because no headless run can judge them: the exported 3D image should match the on-screen look at 1920 and 7680 wide (tone mapping and sRGB are applied by hand in the offscreen pass), and 3D playback smoothness on a long flight.

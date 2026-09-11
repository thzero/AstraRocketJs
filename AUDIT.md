# Engineering Audit — `web/` (fakerocket)

**Date:** 2026-09-09
**Scope:** `web/` — browser re-creation of OpenRocket (React 18 + TypeScript + Vite + Vitest + three.js).
**Method:** fan-out review, five parallel agents (parsers/export, state layer, components, tree/geometry, dead-code/tooling), each reading its files in full. Findings ranked by severity.

**Verification status:** the orchestrator independently re-checked against source — ✅ the zip-bomb (`orkImport.ts:22`), ✅ the XML-injection export sites + their untrusted source (`orkExport.ts` / `orkImport.ts:56`), ✅ the `num()` finiteness divergence (`nodeProps.ts:11` vs `scaleRocket.ts:29`), and ✅ every 🟢 dead-code claim by grepping all of `web/src`. Other findings are grounded in the reviewing agents' full-file reads.

Legend: 🔴 security · 🟠 architecture + tooling (incl. perf) · 🟡 correctness + tests + a11y · 🟢 dead code. Severity per finding: **HIGH / MED / LOW**.

---

## 🔴 Security

**HIGH** | `services/orkImport.ts:22` | `unzipSync(bytes)` inflates the user's `.ork` zip with **no decompressed-size or entry-count cap** (fflate ships none), and eagerly decompresses every entry, not just the one `.ork` it reads. | A malicious `.ork` (nested/high-ratio zip bomb, or millions of entries) shared to a user decompresses to gigabytes and **OOM-crashes their tab on open**. ✅ verified. | Before unzipping, reject archives whose declared uncompressed size / entry count exceed a sane cap; or stream the single needed entry with a running byte budget and abort past it.

**MED** | `services/orkExport.ts:711` (also `:155,234,246,688,744,771`) | Flight-config ids (`c.id`, `defaultId`) are written into XML attributes **and** element text without `escapeXml` — the *only* interpolations in the whole writer that skip it. The ids come straight from `getAttribute('configid')` on import (`orkImport.ts:56`), unvalidated. | A crafted `.ork` with `configid='x"><name>evil</name><y z="'` round-trips into injected XML — corrupts the file and can attack the desktop OpenRocket parser that reopens it. ✅ verified. | Run `escapeXml` on every `c.id`/`defaultId` interpolation.

**LOW** | `services/thrustcurve.ts:53-54,134` | `res.json()` has no size cap; only `totalWeightG`/`propWeightG` are finiteness-checked — `diameter`/`length` are not. | A malformed/compromised API response yields `motor.diameter/1000 = NaN` reaching kernel geometry; an oversized body exhausts memory. | Validate `diameter`/`length` finite & positive; bound the response body size.

**LOW** | `services/flightPathExport.ts:557-558` | The CSV escaper only doubles quotes; it does not neutralize a leading `= + - @`, and the template emits file-sourced `{{rocketName}}`/`{{motor}}`/`{{label}}`. | A rocket named `=HYPERLINK(...)` exports a `.csv` that executes as a formula in Excel/Sheets. | Prefix values beginning with `=+-@` (tab or `'`) before quote-doubling. Same fix for `csvExport.ts:68` (also leaves `\r\n`/`"` untouched).

**LOW** | `services/remoteData.ts:44-46` | Catalog `fetch(url)` has no timeout and no response-size cap (unlike `thrustcurve.ts`). | A slow/oversized `public/data/*.generated.json` hangs the picker or exhausts memory on parse. | Add a timeout + size bound.

---

## 🟠 Architecture + Tooling (incl. perf)

### Architecture — logic trapped in the store/effects (untestable)
**HIGH** | `state/useWorkspaceEffects.ts:85-103` | The whole static-info pipeline (`buildConfiguredRocket → staticInfo() → dragSweep cd inject → error/applyBuild(null)`) is inline in an effect. | Core physics-orchestration only runs inside a mounted component — untestable. | Extract pure `computeStaticInfo(tree, motor, extraMotors, ignition) => {info,rocket}|{error}`.

**HIGH** | `state/store.ts:525-546` vs `:569-590` | `saveOrk`/`saveRasaero` contain byte-for-byte-identical export-mapping (~35 lines) inline in two actions. | Pure transformation trapped + duplicated → drifts, untestable. | Extract one `buildExportMotorMap(...)`; both call it.

**HIGH** | `state/store.ts:459-494` | `openOrkFile` embeds all import wiring (primary/extra split, `delete extra[primary]`, ignition lift onto `sim0`) inline. | The load-mapping — most likely to regress on odd `.ork` — is untestable. | Extract pure `wireLoadedOrk(res) => {tree, extraMotors, sim0, loadedMeta}`.

**HIGH** | `services/reportModel.ts:125-127` | Multi-stage report rebuilds the engine per stage then restores the live handle with no `try/finally`. | Any throw between builds leaves the live 3D/stability handle on the wrong (last-stage) build. | Build into throwaway instances / restore in `finally`.

**MED** | `sim/MotorDetail.tsx:131`, `sim/MotorDashboard.tsx:591,686`, `canvas/FlightChart.tsx:284` | Four near-identical hand-rolled SVG chart scaffolds, already drifted. | Every fix made 4×. | Extract a shared line/area chart primitive.

**MED** | `tree/nodeProps.ts:11` vs `scaleRocket.ts:29`, `flightPathExport.ts:162`, `sim/MotorDashboard.tsx:20`, `orkImport.ts:725` | Five divergent `num` helpers; the canonical one is shadowed. | Re-learn `num` per file; finiteness divergence is an active bug (🟡 HIGH). | Rename locals, reuse `nodeProps.num`.

### Perf — expensive work in the render body / hot paths
**MED** | `canvas/TreeSchematic.tsx:356-374` | `buildSchematicShapes` walks the tree + builds all SVG nodes in the render body, unmemoized, while zoom/pan ride an SVG transform. | Every zoom/pan/caliper pointermove re-walks + re-creates hundreds of elements → drag jank. | `useMemo` on layout/roll/motors/selectedId/hoverId/uid/vertical; exclude zoom/pan.

**MED** | `canvas/AftView.tsx:101-300` | Cross-section rebuilt every render; roll/zoom/pan ride the `<g transform>`. | Roll/zoom/pan re-walk the tree each pointermove needlessly. | Memoized builder keyed on tree+motors.

**MED** | `state/store.ts:293` | `patchSelected` runs `reconcileMounts` (full walk) on every keystroke/slider tick, even for non-structural edits. | Per-frame walk on the hot edit path. | Only reconcile on structural edits.

**MED** | `state/useWorkspaceEffects.ts:85-103` | Rebuild effect has no `hydrated` guard (autosave at `:51` does). | On load: builds default rocket + drag sweep, then rebuilds real one — two full engine builds on startup. | Skip until `hydrated.current`.

**LOW** | perf misc | `ComponentTree.tsx:236` (`branchIds` walks tree/render); `PropertyPanel.tsx:360` (`mergePalette` unmemoized/keystroke); `TreeSchematic.tsx:405-442` (ruler ticks recomputed when off); `store.ts:135` (`selectActive` O(n) find ×7). | Wasted work on unrelated re-renders. | `useMemo`/gate; derive `activeSim`.

### Tooling
**HIGH** | `web/tsconfig.json` | `noUncheckedIndexedAccess` OFF while `strict` on. | Array-indexed geometry everywhere returns non-optional types → OOB reads are silent `undefined` (see 🟡 OOB). | Enable it; bounded pass of `!`/guards at ~30 sites.

**HIGH** | `.github/workflows/deploy-pages.yml:6-9` | CI triggers only on `push` to `master` (+ manual) — no PR/branch trigger. | `build` (`tsc --noEmit && eslint .`) + `npm run test` run only at deploy; PR/dev work gets zero CI feedback. | Add a `pull_request` trigger running `npm ci && npm run test && npm run build`.

**MED** | `web/tsconfig.json:20` | `exclude: ["src/**/*.test.ts"]` drops tests from `tsc`; vitest/esbuild don't typecheck. | Type errors in ~40 test files caught by nothing. | Drop exclude / add `tsconfig.test.json`.

**MED** | `web/package.json:26,29` | `eslint .` runs without `--max-warnings 0`; `no-unused-vars`/`exhaustive-deps` are `warn`. | Warnings never fail CI → regressions accumulate. | Add `--max-warnings 0`; consider `exhaustive-deps: error`.

**LOW** | tooling misc | No knip/ts-prune (this audit found ~13 dead/test-only exports by hand). `eslint-disable exhaustive-deps` at `MotorDialog.tsx:170`, `FlightChart.tsx:130,161` (suppress a warn-level rule). `prefs/units.ts:4` `fmtSi` is a live-imported no-op stub. Mixed default+named exports. | Latent drift. | Add knip; prefer refs/useCallback; fix `fmtSi`; standardize named exports.

---

## 🟡 Correctness + Tests + A11y

### Correctness — NaN / degenerate geometry
**HIGH** | `tree/nodeProps.ts:11` | Shared `num(n,key,fb)` returns any `typeof==='number'`, so **`NaN`/`Infinity` pass**, while `scaleRocket.num` (`:29`) requires `Number.isFinite`. | A non-finite dimension flows through the shared reader into ALL geometry → NaN coords; the NaN sources in this audit (`cd=Number('xyz')`, workspace round-trip, negative `NumberInput`) all land here. ✅ verified. | Add `&& Number.isFinite(...)` to `nodeProps.num`.

**MED** | `services/orkImport.ts:413,434` | parachute/streamer `cd = Number(cdText)` with no finiteness guard. | `<cd>xyz</cd>` → `NaN` into physics, re-exports as `<cd>NaN</cd>`. | `const v=Number(cdText); if(Number.isFinite(v)) n['cd']=v;`

**MED** | `common/NumberInput.tsx:51-56` | `onChange` emits `parseFloat(raw)` with no min clamp; `min` is only an HTML hint. | Negative length/radius/angle passes into geometry+sim despite `min={0}`. | Clamp in `onChange`.

**MED** | `services/solidMesh.ts:141,197,230` | Nosecone `aftRadius=0`/`length=0` → zero-radius/height lathe that `dropDegenerate` empties (tubes floor len; revolves don't). | Empty non-manifold export, silent. | `solidForNode` return `null` when `radius<=0||length<=0`.

**MED** | `services/solidMesh.ts:200,213` | `oneFinSolid` unguarded degenerate planform (`height=0`, freeform <3 pts) → zero-area `THREE.Shape` → broken extrude. | Non-manifold/empty fin. | Return `null`/skip.

**MED** | `services/solidMesh.ts:68` | `makeWatertight` keys `directed` by start vertex; two edges sharing a start overwrite. | Dropped boundary edge → output not watertight; unnoticed (`countBoundaryEdges` never called — see 🟢). | Multimap per start / detect fan-out.

**MED** | `services/recoverySizing.ts:87,94` | Guard `area`/`cd`/`rho>0` but not `massKg>0`; `descentMass` (`:83`) can be negative. | Negative mass → `sqrt(neg)` → NaN descent rate/diameter. | Add `!(massKg>0)` or clamp `descentMass>0`.

**MED** | `tree/shapeProfile.ts:65` | `shapeRadius` (exported) divides by `length` with no guard (length=0 → Inf/NaN; haack `acos` → NaN; ogive → NaN at radius=0). | Direct callers get NaN/Infinity silently. | Guard `length>0` (and `radius>0` for ogive).

**MED** | `services/reportGeometry.ts:82` vs `:26`/`solidMesh.ts:198` | `rocketSideView` draws elliptical fins as a 4-point trapezoid vs the true 32/40-step half-ellipse used by template + solid. | Side view ≠ printed 1:1 template ≠ 3D. | Reuse the ellipse sampler.

**MED** | `services/keyValueStore.ts:24-30` (via `workspaceStore.ts:52`) | `setItem` in `try{}catch{}` silently swallows `QuotaExceededError`; whole design+sims writes through it. | Large design silently fails to persist; user reloads to reverted work. | Reject on quota so `save()` can surface it.

**MED** | `canvas/FlightPath3D.tsx:93,209` | `Math.max(1, ...rows.map())` / `Math.max(...pts)` spread the full series. | Long/fine-step flight → arg-stack `RangeError` blanks the 3D view (`FlightChart` loops). | Replace spreads with `reduce`/loop.

**LOW** | more validation | `orkImport.ts:508` uncapped recursion + `loadOrk.ts:69` no try/catch → deep nesting throws uncaught. `workspaceStore.ts:41` trusts parsed blob (+ NaN/Inf→null). `settings.ts:145` no `timeStep>0` clamp (hangs RK4). `position.ts:14` freeform `axialLength` 0/neg/NaN. `shapeProfile.ts:153` steps=0 → NaN. `cluster.ts:82` radius 0. `AftView.tsx:303` ref-write in render; `:316` magic-hex motor detection. `PropertyPanel.tsx:530` angle no max clamp. | Silent-wrong / crash-on-edge. | Guard/clamp each; explicit `motor` flag on Shape.

### A11y
**RESOLVED** | `design/ComponentTree.tsx:150-217` | Rows are now `role="button"` with `tabIndex`/`onKeyDown` (Enter/Space to select) **plus roving-tabindex arrow navigation** (↑/↓/Home/End between rows, ←/→ collapse/expand) — the whole tree is one tab stop and keyboard-selectable. | — | Done.

**MED** | `canvas/TreeSchematic.tsx:537-542` | Editing SVG is `role="img"` with children carrying onClick/onPointerDown. | `role="img"` hides the interactive subtree from AT; 2D editor inaccessible. | Drop `role="img"` for the editable view / add keyboard path.

**MED** | `sim/MotorDashboard.tsx:250-260`, `sim/MotorDialog.tsx:239-249`, `layout/SettingsDialog.tsx:62-70` | Modals set `role="dialog"` but never trap/restore focus. | Focus stays behind the overlay. | `useFocusTrap`.

**MED** | `canvas/FlightPath3D.tsx:331-336` | Play/pause/cancel button is glyph-only, no `title`/`aria-label`. | Unlabeled primary transport control for SR users. | State-tracking `aria-label`.

**LOW** | a11y misc | `TreeSchematic.tsx:895,904` + `AftView.tsx:426-434` icon buttons have `title` but no `aria-label` (inconsistent). `AppHeader.tsx:164-291` `role="menu"` with no arrow-key roving. | `title`≠accessible name; menu roles unfulfilled. | Add `aria-label`s; add arrow keys or drop menu roles.

### Tests (untested math / seams)
**HIGH** | `services/solidMesh.ts` | Watertight revolve/fin path (`revolveSolidX`, `oneFinSolid`, `solidForNode` nose/transition/fin) has NO coverage (`solidMesh.test.ts` only does `discSolid`). | Poles/degenerate-drop/capping/winding regressions ship untested. | Watertight/boundary-edge assertions per part.

**HIGH** | `services/reportGeometry.ts` | No test — `finPlanformMm`/`profileMm`/`rocketSideView` (mm 1:1 template math) untested. | Wrong mm factor silently prints mis-scaled cut templates. | Pin known planform/profile point sets.

**MED** | tests | `services/reportModel.ts` (multi-stage rebuild/restore) + `components/canvas/schematicGeometry.ts` (`niceStep`/`calloutLayout`/`finTabFront`/`axialStart`/`computeSchematicLayout`) untested — the latter is the hero-canvas layout, imported by `reportGeometry`. | Silent scale/tab drift; corrupted multi-stage handle. | Add tests.

**LOW** | async | `canvas/FlightPathExport.tsx:138-156` + `sim/LaunchPanel.tsx:159-172` `setState` after await/geolocation callback, no mounted guard (other load sites guard). | React warn + wasted write on unmount. | Mounted flag / AbortController.

---

## 🟢 Dead code (all grep-verified in `web/src`)

**Truly dead — delete** (exported, 0 importers, 0 tests):
- **MED** `services/appInfo.ts:38` `appLabel`
- **MED** `engine/kernelLogSink.ts:39,44,49` `kernelLog`/`clearKernelLog`/`setKernelLogEcho` (`import './kernelLogSink.js'` is side-effect-only)
- **MED** `services/componentExport.ts:42` `isExportable`
- **MED** `services/componentDb.ts:90` `componentsDate`
- **MED** `canvas/Rocket3D.tsx:483` `calloutGadget`
- **LOW** `services/recoverySizing.ts:120` `BANDS`
- **MED** `services/solidMesh.ts:30` `countBoundaryEdges` (never called → watertight output validated by nobody; see 🟡)

**Test-only exports** (def + own `.test.ts` only — wire up or remove):
- **MED** `services/treeEdit.ts:432` `isFirstStage` (EditorPanel uses its own local)
- **MED** `services/materials.ts:44` `findMaterial`
- **MED** `tree/position.ts:64` `resolveAbsolutePositions`
- **MED** `tree/tubefins.ts:25,36` `tubeFinMaxRadius`/`tubeFinMaxCount`
- **MED** `tree/cluster.ts:59,65` `CLUSTER_OPTIONS`/`clusterCount` (likely a pending picker UI)
- **MED** `tree/shapeProfile.ts:44` `shapeUsesParameter`

**Superfluous `export`** (module-internal only — drop `export`):
- **LOW** `canvas/Rocket3D.tsx:515,546,555,575,663` `piecesBounds`/`isFittableBox`/`FIT_MARGIN`/`fitCameraToBox`/`exportCamera`

**Unused DI seams** (keep only if the swap-seam is deliberate):
- **LOW** `services/motorStore.ts:177`, `templateStore.ts:105`, `workspaceStore.ts:64` `setMotorStore`/`setTemplateStore`/`setWorkspaceStore`

---

## Recommended order of attack

*Front-loads small, verified, isolated fixes; defers the large refactors. Each parser/geometry fix should land with a unit test.*

**1 — One-line/small fixes with outsized blast radius (do first)**
1. `nodeProps.num` → reject non-finite (`tree/nodeProps.ts:11`). Kills the whole NaN-into-geometry class + back-stops cd/workspace/NumberInput. 🟡 HIGH.
2. `escapeXml` the config ids in `orkExport.ts` (6 sites). 🔴 MED.
3. Cap the unzip in `orkImport.ts:22` (size + entry budget). 🔴 HIGH.
4. Clamp `NumberInput` to `min` in `onChange`. 🟡 MED (cross-cutting).
5. Neutralize CSV formula injection (`flightPathExport.ts:557`, `csvExport.ts:68`). 🔴 LOW.
6. Guard degenerate geometry: `solidMesh` null for `radius/length<=0`/`height<=0`; `recoverySizing` `massKg>0`; `shapeRadius` `length>0`. 🟡 MED.
7. Surface storage-quota failure; clamp `timeStep>0` (`settings.ts:145`). 🟡 MED/LOW.

**2 — Delete verified dead code (mechanical, safe).** 7 truly-dead exports + drop superfluous `Rocket3D` exports; decide the 6 test-only + 3 DI seams. 🟢.

**3 — A11y quick wins.** `ComponentTree` rows → `<button>`; drop `role="img"` on editable `TreeSchematic`; `aria-label` icon/transport buttons; `useFocusTrap` in the 3 dialogs. 🟡 MED.

**4 — Perf memoization.** Memoize `buildSchematicShapes` + `AftView` cross-section (exclude zoom/pan/roll); `FlightPath3D` min/max via loop (also fixes RangeError); gate `patchSelected` reconcile; add `hydrated` guard; memoize `branchIds`/palette. 🟠 MED.

**5 — Close the tooling gates.** PR CI trigger (`npm ci && npm run test && npm run build` + knip); enable `noUncheckedIndexedAccess`; drop the test-file `tsconfig` exclude; `--max-warnings 0`; add knip. 🟠 HIGH/MED.

**6 — Backfill untested math.** `solidMesh` watertightness, `reportGeometry` 1:1, `reportModel` multi-stage, `schematicGeometry` layout. 🟡 HIGH/MED.

**7 — Large refactors (defer; each behind tests on the extracted pure fn).** Extract `computeStaticInfo`/`buildExportMotorMap`/`wireLoadedOrk`; fix `reportModel` handle lifecycle; shared chart primitive; consolidate the 5 `num()` helpers. 🟠 HIGH.

---

### Tooling recommendation (concrete)
- **knip** — `npm i -D knip`, `web/knip.json`:
  ```json
  { "entry": ["src/main.tsx","src/engine/simWorker.ts","vite.config.ts","playwright.config.ts","src/**/*.test.ts"],
    "project": ["src/**/*.{ts,tsx}"], "ignore": ["src/engine/vendor/**"] }
  ```
  Add `"knip": "knip"`; non-blocking first, then `--strict`. Flags every dead/test-only/superfluous export above.
- **`noUncheckedIndexedAccess: true`** in `web/tsconfig.json`; one `tsc --noEmit` pass, guard/`!` each site.
- **CI gate**: add a `pull_request` (+ non-master `push`) trigger running `npm ci`, `npm run build`, `npm run test`, `npm run knip`; `--max-warnings 0`; typecheck test files.

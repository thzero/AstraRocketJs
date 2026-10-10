# AUDIT_PROMPT_DUPLICATION - `web/` duplication and reuse audit (AstraRocketJs)

Companion to `docs/AUDIT_PROMPT.md`. That audit covers security, correctness, architecture, tests, dead code and tooling, and touches duplication only in passing. This one looks at nothing else: code that is written more than once, inline logic that should be a helper, and JSX or hook patterns that should be a shared component.

Paste the block below to a capable agent. Run from the repo root (`AstraRocketJs/`); all paths are repo-root-relative.

---

Audit the **`web/src`** tree of this repo (React 19 + TypeScript + Vite + zustand + three.js) for duplication and missed reuse. Do not report security, correctness, accessibility or style findings unless they are a direct consequence of duplication (two copies that disagree). `web/src/engine/vendor/` is generated TeaVM output; do not audit it.

## What counts as a finding

Each finding has exactly one category:

| Category    | Meaning                                                                                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DRIFT`     | Two or more copies of the same logic that already disagree (different clamping, rounding, finiteness handling, defaults, units, labels, edge cases). Say which copy is right and why. This is the most valuable category.               |
| `DUP`       | Two or more copies of the same logic that still agree. Name every copy.                                                                                                                                                                  |
| `BYPASS`    | Code that reimplements something a shared module already provides (`components/common/*`, `i18n/format.ts`, `prefs/units.ts`, `services/files/xmlUtil.ts`, `services/flight/interpolate.ts`, and so on). Name the helper it should call. |
| `HELPER`    | Inline logic, written once but non-trivial and generic, that belongs in a utility module so it can be named and tested (a pure function buried in a component, a store action or an effect).                                           |
| `COMPONENT` | A repeated JSX structure or hook pattern (dialog scaffolding, labeled field rows, tables, chart axes, map layers, file pickers, async-load-with-status hooks) that should be one shared component or hook.                                |

Severity:

- **HIGH**: any `DRIFT` with a user-visible difference, and any duplication of physics, unit conversion, file-format reading or writing, or persistence keys, where a fix applied to one copy would silently miss the other.
- **MED**: three or more copies, or more than about 30 duplicated lines, or a `COMPONENT` pattern repeated in four or more places.
- **LOW**: two small copies that agree.

## What does NOT count

Reject these before they reach the report:

- **Coincidental similarity.** Two blocks that look alike but change for different reasons (the `.ork` reader and the `.rkt` reader each mirror their own format's spec; a 2D schematic and a 3D mesh can share a profile but not a renderer). Merging them couples unrelated changes.
- **Consolidations that cost more than they save.** If the shared version needs more parameters, flags or callbacks than the lines it removes, say so and drop it.
- **Ported kernel math consolidated by majority vote.** `web/src/tree/*` and the geometry services re-implement OpenRocket math. If two copies of a port disagree, the right one is whichever matches the Java under `engine-java/src/java/info/openrocket/core/`, not the older or the more common one. Open the Java and compare term by term. Fin planform geometry is already centralized in `web/src/tree/finPlanform.ts`; any other module that samples a fin outline is a `DRIFT` finding.
- **App-side physics as the "shared" home.** CP, CG, calibers and the stability margin come from the kernel. Never propose a shared app-side formula for them; if you find copies, the fix is to read the kernel figure.
- **Test-only exports** that exist so a unit test can reach an internal helper. Intentional.
- **Generated or vendored code**, locale JSON, and CSS. (CSS duplication is out of scope for this audit.)
- Pure style or naming preferences.

## Method

**Fan out; do not read it all in one context.** Launch parallel review agents, one per slice below, plus one cross-cutting agent. Agents are read-only: no edits to the repo.

**Start from a mechanical baseline, but do not stop there.** Run a token clone detector once and hand its output to every agent:

```
cd web && npx --yes jscpd@4 src --ignore "**/vendor/**,**/*.test.ts,**/*.test.tsx,**/*.json,**/*.css" --min-tokens 30 --min-lines 4 --reporters json --output <scratch dir>
```

jscpd finds exact token clones only. On 2026-10-05 it found 0.64% duplicated lines at 50 tokens and 2.4% at 30, which says little: the expensive duplication here is near-copies with renamed variables, the same algorithm written twice in different shapes, and code that ignores a helper that already exists. Treat each jscpd hit as a lead to triage, not a finding.

**Each slice agent:**

1. Reads every file in its slice in full.
2. Before reporting a `DUP` or `COMPONENT`, greps **all of `web/src`** for other instances, not just its own slice. A finding's copy list must be complete.
3. Before reporting a `HELPER`, greps for an existing helper that already does it. If one exists, the finding is a `BYPASS`.
4. For every `DUP` and `DRIFT`, diffs the copies line by line and states the differences, or states that there are none.
5. Reports findings as
   `SEV | CATEGORY | copies (file:line for each) | what is duplicated | drift (exact differences, or "none") | proposed home (existing module or new path) and shared signature | lines removed (estimate) | risk of consolidating`
   ranked by severity, findings only, no preamble.

**The cross-cutting agent** builds an inventory of every shared module that exists today (`components/common/*`, `i18n/format.ts`, `prefs/*`, `services/files/{xmlUtil,decodeText,saveFile,importNote}.ts`, `services/files/ork/numbers.ts`, `services/flight/interpolate.ts`, `services/app/*` (including `numbers.ts` and `errorMessage.ts`), `tree/treeWalk.ts`, `tree/shapeProfile.ts` (`profileEnds`, a nose cone's or transition's two end radii, which every reader that places a profile uses), `services/design/autoRadius.ts`, `services/design/discGeometry.ts` (`boreAround`, `ringBore`), `presetShoulder` in `services/design/treeEdit.ts` (a catalog row's shoulder, for nose cones and transitions), `services/storage/jsonListStore.ts`, `components/common/map/*`, `components/common/{MasterDetail,SortHeader}.tsx`, `components/common/chartPalette.ts`, the `use*` hooks (`useAsyncLoad`, `useMenuPopover` and the rest), and any other module imported from three or more directories; on the test side, `web/tests/testing/kernelGeometry.ts` is the one reader of the kernel's resolved geometry), then greps the whole tree for code that reimplements each one. It also sweeps for these idioms, which tend to be hand-rolled per file:

- number formatting and rounding (`toFixed`, `Math.round(x * 10 ** n)`, locale formatting outside `i18n/format.ts`), clamp, `Number.isFinite` guards with defaults, degree/radian conversion, unit conversion outside `prefs/units.ts`
- file download (Blob, object URL, anchor click), file pick (hidden `<input type="file">`), `FileReader`, text decoding
- fetch with timeout, abort, size cap or progress outside `services/app/fetchProgress.ts` and `services/app/remoteData.ts`
- `localStorage` and IndexedDB access outside `services/storage/*`, and storage keys not built with `storageKeys.ts`
- dialog scaffolding outside `components/common/Dialog.tsx`, focus traps outside `useFocusTrap`, Escape and click-outside handlers, menus and popovers
- SVG chart axes, ticks, gridlines, crosshairs and zoom, and map tile and layer setup, written per chart or per map
- table header, sort and row-selection logic
- `useEffect` patterns that load something async and track loading, error and result
- zustand selectors repeated verbatim across components

**Then synthesize.** Merge findings that name the same copies. Independently re-read the cited lines for every HIGH and MED finding and for every `DRIFT` at any severity before it goes in the report; agents misquote line numbers, so re-resolve each citation by content. Drop anything that fails the "does not count" list above.

## Slices

1. **Canvas, design views** - `web/src/components/canvas/*` except the files in slice 2: the schematic (`TreeSchematic`, `schematic*`, `Schematic*`, `AftView`), the 3D model (`Rocket3D`, `RocketModel`, `rocketPieces`, `rocketCallouts`, `rocketExportCamera`, `offscreen*`, `ImageExportMenu`), aero analysis (`Aero*`, `aeroTables`, `useAeroSweep`), stability (`Stability*`, `stabilityGadget`), and the center frame (`Center*`, `View*`, `InfoOverlay`, `LoadedBanner`, `DesignWarnings`, `StageColorDialog`, `useWheelZoom`, `useViewPrefs`, `useMaximizeCenter`).
2. **Canvas, flight views** - `web/src/components/canvas/{Flight*,flight*,PathExport*,pathExport*,GroundTrack,FlightGroundMap,DriftSweepPanel,Environment*,ExportFormatPicker,useChart*,useExport*,useResultFlight,useRecoveryMass,useRocketExport,useAutoRunOutdated}`.
3. **Simulation, tools and configuration components** - `web/src/components/{sim,tools,config}/*`. The motor dialog family, the weather and wind dialogs, the location picker and site map, and the landing estimator and off-the-rail tools all draw maps, charts and forms; compare them with each other and with slice 2.
4. **Design, layout, common and report components** - `web/src/components/{design,layout,common,report}/*`, `web/src/App.tsx`, `web/src/main.tsx`. Weight `components/common/*` as the place things should already live: for each common component, find callers that hand-roll it instead.
5. **File formats, exports and report services** - `web/src/services/{files,exports,report}/**`. `.ork`, `.rkt`, RASAero, DXF, CSV, 3MF, mesh and PDF writers each have their own escaping, number formatting and unit handling. Compare them, but apply the coincidental-similarity rule strictly: two formats with different specs are not duplicates just because both write XML.
6. **Flight, motor, part and app services** - `web/src/services/{flight,landing,weather,map,tools,motors,parts,materials,app}/**`. Atmosphere, wind, interpolation, drift and landing math appear in several of these; for any physics or unit duplication, check whether the kernel already provides the figure.
7. **State, storage, design services, tree, prefs, i18n, engine facade** - `web/src/{state,tree,prefs,i18n}/**`, `web/src/services/{storage,design}/**`, `web/src/engine/*.ts` (not `vendor/`). `state/store.ts` is about 1,620 lines, with `state/viewSlice.ts` and `state/fileSlice.ts` beside it; look for store actions that repeat the same clone-mutate-commit sequence, and for tree walks written more than once across `tree/`, `services/design/treeEdit.ts` and the store.
8. **Cross-cutting** - as described above.

## Codebase notes

- `App` and `i18n` use default exports intentionally; everything else is named exports.
- A previous audit already closed one round of duplicated helpers (two `Stat` components, the `finTabFront` copy, the `num()` and `round()` readers), and `docs/AUDIT_DUPLICATION.md` (2026-10-05) fixed D1 to D101 (D31 was not reachable; D77 leaves some items on purpose). Verify that those stayed fixed, and do not report them again unless they came back.
- `components/common/Dialog.tsx` and `useFocusTrap.ts` are the dialog base. A dialog that does not use them is a `BYPASS` unless it has a stated reason in a comment.
- `web/scripts/lib/presetVolume.mjs` repeats the geometry `catalogPatch` (`services/design/treeEdit.ts`) gives a catalog row, on purpose: a Node script cannot import the TypeScript. `web/tests/services/parts/catalogPatch.kernel.test.ts` ("a stated catalog mass") guards the pair by requiring every row with a stated mass to fly within 0.5% of it. It is not a finding unless that guard is gone.
- Proposed new modules go next to their callers' layer: pure functions in `services/` or `tree/`, React in `components/common/`, hooks next to their only callers until a second directory needs them.

## Output

Overwrite `docs/AUDIT_DUPLICATION.md`. Date-stamp it and name the commit it ran against. Lead with a table of totals by category and severity and the jscpd baseline numbers. Group findings by category, `DRIFT` first. Give each finding an id (`D1`, `D2`, ...), a severity, a VERIFIED or REPORTED tag, the full copy list, the drift, the proposed home and signature, and the estimated lines removed. End with a recommended order of attack that front-loads `DRIFT` fixes and small mechanical consolidations, and defers large component extractions.

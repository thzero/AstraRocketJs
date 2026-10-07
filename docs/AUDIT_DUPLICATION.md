# AUDIT_DUPLICATION - `web/` duplication and reuse audit

<!-- cspell:ignore jscpd Rumpf -->

Date: 2026-10-05. Branch `test` at 09225ae. Run per `docs/AUDIT_PROMPT_DUPLICATION.md`: eight parallel review agents (seven directory slices plus one cross-cutting sweep), merged here. Every HIGH finding and every DRIFT finding tagged VERIFIED below was re-read against the source before entry.

Scope: `web/src`, excluding `engine/vendor/`, tests, locale JSON and CSS.

**Status, 2026-10-05.** Step 1 of the order of attack is done: D1, D2, D6, D7, D8, D22, D23, D28, D29 and D45 are fixed, each with a test that was run against the unfixed code and watched to fail. D7 moved the kernel's `getClusterPoints` rule into `tree/cluster.ts` (`clusterPoints`), so the `.rkt` writer and `splitCluster` now share one copy. D31 turned out not to be reachable (see its entry). Step 2 is done too: D3, D4, D5, D67 and D30 (in part), each with a test watched to fail first. Step 3 is done: D9, D10, D13, D14, D15, D17, D20, D24, D25, D32 and D72. Step 4 is done: D11, D12, D21, D35, D36, D42 and D57. Step 5 is done: D16 (resolved through the kernel's own coordinates), D18, D26, D27, D41, D49, D73 to D76, D78 to D80, and D77 in part.

## How to read this

- **Categories.** `DRIFT`: copies that already disagree. `DUP`: copies that still agree. `BYPASS`: code that reimplements an existing shared helper. `HELPER`: inline logic that should be a named utility. `COMPONENT`: a repeated JSX or hook pattern that should be one shared component or hook.
- **VERIFIED** means the cited lines were read and the claim confirmed independently of the agent that raised it. **REPORTED** means an agent raised it with citations and it is plausible, but it was not re-read. Where two or more agents raised the same finding independently, that is noted.
- Line numbers are from 09225ae. If one does not match, search for the quoted expression.

## Totals

| Category  | HIGH   | MED    | LOW    | Total   |
| --------- | ------ | ------ | ------ | ------- |
| DRIFT     | 26     | 15     | 7      | 48      |
| DUP       | 1      | 11     | 6      | 18      |
| BYPASS    | 0      | 10     | 1      | 11      |
| HELPER    | 0      | 3      | 0      | 3       |
| COMPONENT | 0      | 17     | 4      | 21      |
| **Total** | **27** | **56** | **18** | **101** |

Some rows group several small items under one id (D48, D64 to D66, D77, D98 to D101). Each of those counts once.

## Mechanical baseline

jscpd 4, token clones, `web/src` minus vendor, tests, JSON and CSS, 523 files:

| Threshold                 | Clone pairs | Duplicated lines |
| ------------------------- | ----------- | ---------------- |
| 50 tokens                 | 45          | 500 (0.64%)      |
| 30 tokens, 4 lines        | 212         | 1,873 (2.38%)    |

The exact-clone rate is low. Almost none of the HIGH findings below show up in jscpd: they are near-copies with different variable names, the same rule written in a different shape, or code that ignores a helper that already exists. Of the largest jscpd pairs, most were rejected as mirrored geometry (the two caliper orientations), declarative field tables, or prop and import blocks.

## Prior duplicate fixes

The 2026-10-01 audit closed three duplicated helpers. Checked again:

- **One `Stat` tile.** Held. `components/common/Stat.tsx` is the only tile. Two private `Stat` components in `tools/LandingEstimator.tsx` and `tools/OffTheRail.tsx` are dt/dd rows, not tiles; see D99.
- **`finTabFront`.** Held. `finTabFrontEdge` exists only in `tree/finPlanform.ts`.
- **One `num()` reader family.** Came back. `services/files/rasaero/units.ts:16` `nnum` checks only `typeof`, and several writers do the same inline. See D21.

---

## DRIFT

### D1. The flight path export dialog closes on Escape twice (HIGH, VERIFIED) - FIXED 2026-10-05

- `components/canvas/FlightPathExport.tsx:112-118` adds a window `keydown` listener, `if (e.key === 'Escape') onClose();`, while the dialog already renders inside `<Dialog onClose={onClose}>` (:172), which handles Escape through `useFocusTrap`.
- `components/canvas/useMaximizeCenter.ts:19` decides whether a modal is open with `document.querySelector('[role="dialog"]')`.

**Drift.** `useFocusTrap` answers Escape only for the topmost `[data-modal-surface]`. The raw listener skips that check. With the stage-colors dialog open over the export dialog (`FlightPathExport.tsx:439`), one Escape cancels the color dialog and also closes the export dialog under it, losing the color drafts. `useFocusTrap.ts:31-37` describes this exact two-surface bug as fixed. Separately, `AlertDialog` uses `role="alertdialog"`, so `useMaximizeCenter` does not see a confirm: in maximize mode, Escape cancels the confirm and also restores the side panes.

**Fix.** Delete the listener in FlightPathExport. Export `hasOpenSurface(): boolean` from `useFocusTrap.ts` and use it in useMaximizeCenter. About 8 lines.

### D2. Launch lug fallback dimensions (HIGH, VERIFIED) - FIXED 2026-10-05

- `components/canvas/schematicShapes.tsx:527-528` `num(child, 'length', 0.01)`, `num(child, 'outerRadius', 0.002)`
- `components/canvas/AftView.tsx:200` `num(child, 'outerRadius', 0.002)`
- `components/canvas/rocketPieces.ts:282-283` `0.05`, `0.0022`
- Authority: `tree/kernelDefaults.ts:71` `launchlug: { length: 0.05, outerRadius: 0.0022 }` (ComponentFactory, case "launchlug")

**Drift.** A lug with no keys is drawn 10 mm by 2.0 mm radius in 2D and the aft view, and 50 mm by 2.2 mm in 3D, the `.ork` writer, RASAero and the kernel. The kernel is right.

**Fix.** Read `KERNEL_DEFAULTS.launchlug` (or `axialLength(child)`) at every site. Literal swaps only.

### D3. Inner tube extent drawn three ways (HIGH, VERIFIED) - FIXED 2026-10-05

- `components/canvas/schematicGeometry.ts:359-364` `internalExtent`: `num(node, 'length', 0.025)`, `Math.min(parentRadius * 0.85, ...)`, used for innertube by `schematicShapes.tsx:581-583`
- `components/canvas/rocketPieces.ts:302-303` length `0.05`, radius `0.0095`
- `components/canvas/AftView.tsx:218` radius `0.0095`, uncapped
- Authority: `tree/kernelDefaults.ts:61` `innertube: { length: 0.07, outerRadius: 0.0095 }`; `ork/exportWriters.ts:219` writes 0.07

**Drift.** With no length key, the side view draws 25 mm, 3D draws 50 mm, and the kernel, `.ork` and caliper snaps use 70 mm. The side view also caps the radius at 85% of the parent, while the aft view and 3D draw the raw radius, and the side view's own cluster offsets use the uncapped radius.

**Fix.** Give innertube its own branch in schematicShapes and read `axialLength(n)` and `KERNEL_DEFAULTS.innertube.outerRadius` everywhere. Keep the 85% cap for packed recovery parts, which is what its docblock is for.

**Done, 2026-10-05.** `innerTubeExtent(node)` in `schematicGeometry.ts`, used by the side view, the 3D view and the aft view.

### D4. The aft view sizes discs by its own rule (HIGH, VERIFIED) - FIXED 2026-10-05

- `components/canvas/AftView.tsx:246` `Math.min(pRadius * 0.98, num(child, 'outerRadius', pRadius * 0.95))`
- vs `schematicShapes.tsx:580` `discDims(child, tubeRadii(parent), ...)` and `rocketPieces.ts:358` `resolveDisc(tree, child.id)`

**Drift.** For couplers, centering rings, bulkheads and engine blocks with no explicit radius, the aft view uses 95% of the parent's outer radius. Every other view, the DXF and the print solids use `plateOuter`: the enclosing tube's bore. The aft view also ignores the inner bore. `discGeometry` is right; it is shared with the cut sheet.

**Fix.** Call `discDims` in `AftView.walkChildren` and draw `innerR` as a second circle. About 2 lines.

**Done, 2026-10-05.** The REPORTED `resolveDisc` split in `rocketPieces.ts` below is still open.

A smaller related split (REPORTED): `rocketPieces.ts:358` calls `resolveDisc(tree, id)`, which re-walks the tree and inherits the grand-enclosing bore, while the 2D path uses the direct parent. When `discDims` returns null, 2D draws a box and 3D drops the part. `discGeometry.ts:103-111` says walkers should call `discDims` directly.

### D5. A nose cone with no shape key is conical in one module and ogive everywhere else (HIGH, VERIFIED, raised by three agents) - FIXED 2026-10-05

- `tree/shapeProfile.ts:267` `stationRadius`: `typeof node['shape'] === 'string' ? ... : 'conical'` for nosecone and transition alike
- `components/canvas/schematicGeometry.ts:144` `n.type === 'transition' ? 'conical' : 'ogive'`
- `rocketPieces.ts:406, :463`; `services/exports/solidMesh.ts:490, :502`; `services/report/reportGeometry.ts:60, :97, :184` (default passed in)
- Kernel: `engine-java/src/api/java/api/ComponentFactory.java:156` `str(node, "shape", "ogive")` (nose), `:194` `"conical"` (transition)

**Drift.** `stationRadius` feeds `services/design/finTabAuto.ts:202`, so an auto fin tab on a shape-less nose cone is sized against a cone the kernel does not fly. Every other copy matches the kernel. The same block also re-reads `clipped` and `shapeParameter` in 7 or more places; `stationRadius` reads `shapeParameter` with a bare `typeof` where the others use `numOpt`.

**Fix.** In `tree/shapeProfile.ts`: `nodeShape(node): string` (kernel default by type), `nodeClipped(node)`, and `nodeProfile(node, foreR, aftR, segments?, extraX?)`. Callers keep their own segment counts. Add the shape defaults to `KERNEL_DEFAULTS` so the kernel test pins them. About 20 lines removed.

**Done, 2026-10-05.** `nodeShape(node)` in `tree/shapeProfile.ts` over a new `KERNEL_SHAPES` table in `tree/kernelDefaults.ts`, pinned by a case in `kernelDefaults.kernel.test.ts` that builds each part with the key absent and present (and was watched to fail with the table wrong). Every profile reader goes through it: the 2D, 3D and PDF views, the printable solid, the `.ork` and RASAero writers. That also fixed a fourth copy the agents missed: `ork/exportParts.ts` `shapeParamXml` fell back to `'ogive'` for a transition too, writing ogive's shape parameter beside a conical shape. `nodeClipped` and `nodeProfile` were not added; the clipped read is still repeated.

### D6. Inner tube and coupler wall default (HIGH, VERIFIED) - FIXED 2026-10-05

- `services/design/discGeometry.ts:30-33` `tubeRadii` and `:173-175` `boreAt`: bodytube, innertube and tubecoupler all fall back to `COMPONENT_DEFAULTS.bodytube.thickness`
- vs `discGeometry.ts:129-130` `discDims` (`tubecoupler.thickness`), `rocketPieces.ts:314` (`innertube.thickness`), `ork/exportWriters.ts:227, :247`
- Kernel: `ComponentFactory.java:385` `tube.setThickness(dbl(node, "thickness", 0.0005))` for innertube, and the same for tubecoupler

**Drift.** As the enclosing tube, a coupler or inner tube with no thickness key has a bore 0.2 mm larger than the same part has as a part in its own right. That bore sizes rings and bulkheads (`autoRadius.parentDerived`), the DXF and the print solids.

**Fix.** A per-type `WALL_DEFAULT` record in `discGeometry.ts`, used by both `tubeRadii` and `boreAt`. About 4 lines.

### D7. The `.rkt` writer rotates cluster tubes by the wrong angle (HIGH, VERIFIED) - FIXED 2026-10-05

- `services/files/rktExport.ts:396-401` `clusterOffsets(..., numOpt(n, 'clusterRotation') ?? 0)`
- `services/design/componentActions.ts:184-189` `splitCluster`: `num(node, 'clusterRotation', 0) - dir`
- Kernel: `engine-java/src/java/info/openrocket/core/rocketcomponent/InnerTube.java:265` `cluster.getPoints(clusterRotation - getRadialDirection())`

**Drift.** For a cluster with a nonzero radial direction, the `.rkt` file places every motor tube rotated by `+radialDirection` from where the kernel, the desktop and the app's own split put it. `splitCluster` is right.

**Fix.** `clusterMemberOffsets(node)` in `tree/cluster.ts`, a port of `getClusterPoints`, called by both. About 20 lines.

### D8. `.rkt` tube fins clamp to 12, the kernel to 8 (HIGH, VERIFIED) - FIXED 2026-10-05

- `services/files/rktImport.ts:549` `clampCount(num(el, 'TubeCount') ?? 6, 1, 12)`; `:450` planar fins `..., 1, 8)`
- vs `ork/importTags.ts:75-77` `finCountTag` with `MAX_FIN_COUNT` (`tree/nodeProps.ts:40`, 8)

**Drift.** A `.rkt` with 9 to 12 tube fins imports, and then the engine build rejects it (`nodeProps.ts:36-40` documents the 8 limit at the engine boundary for every fin type). The `.ork` path is right. The planar-fin literal agrees today but bypasses the constant.

**Fix.** Use `MAX_FIN_COUNT` at both `.rkt` sites.

### D9. Two stability classifications on one screen (HIGH, VERIFIED) - FIXED 2026-10-05

- `services/flight/simReport.ts:6-9` `stabilityState`: under below 1 cal, ok 1 to 6, over above 6. Used by `InfoOverlay.tsx`, `SchematicOverlay.tsx:47`, `StabilityCallout.tsx:44`
- `simReport.ts:15-21` `stabilityTone` / `stabilityVerdictKey`: stable at 1 or more, marginal 0 to 1, unstable below 0, no over-stable tier. Used by `StabilityBadge.tsx:74, :165-166`

**Drift.** A 7-cal design reads "stable" in green in the stats strip and "over-stable" in amber in the drawing and the info card. At 0.5 cal the strip says "marginal" in amber and the drawing says under-stable in red. `InfoOverlay.tsx:8-14` documents this hazard. (The SimSummary rail-exit use of `stabilityTone` is a different quantity and can keep its tiers.)

**Fix.** Key tone and verdict by `StabilityState`: `stabilityToneOf(state)` and `stabilityVerdictKeyOf(state)` in `simReport.ts`. Delete InfoOverlay's local `STABILITY_TONE`.

**Done, 2026-10-05.** Every on-pad readout colors by `stabilityToneOf(stabilityState(cal))`. The strip keeps its finer words (unstable below 0, marginal 0 to 1, stable 1 to 6) and gained the over-stable tier above 6, reusing the translated `schematic.overStable`, so no new locale strings. `stabilityTone` stays for the rail-exit tile only.

### D10. The 3D stability callout uses its own glyphs (HIGH, REPORTED) - FIXED 2026-10-05

- `SchematicOverlay.tsx:50-57` and `InfoOverlay.tsx:44` use `STABILITY_GLYPH` (⚠ under, △ over, ✓ ok) and append the verdict word
- `StabilityCallout.tsx:46-56` prints ⚠️ for both under and over, nothing for ok

`schematicGeometry.ts:379` says the tiered glyphs are used "wherever a view prints one". **Fix.** `marginText(info, t): { state, text } | null` next to `STABILITY_GLYPH`. About 12 lines.

**Done, 2026-10-05.** `marginText(cal, pct, t)` in `schematicGeometry.ts`, used by the 2D overlay and the 3D callout.

### D11. Three lists of whole-rocket static-info rows (HIGH, VERIFIED for the CSV and designInfo) - FIXED 2026-10-05

- `services/report/designInfo.ts:40-69` `statsFor` (the `.ork` `<designinfo>` block)
- `services/report/reportCsv.ts:36-61` `summaryRows`
- `services/report/pdfPage.ts:203-223` `summaryRows`

**Drift.** designInfo omits CP and both stability rows when the design has no normal-force slope (`hasAero`, :54-55), omits Fineness when the reference diameter is 0 (:49) and omits CNα without aero (:65). The CSV writes all of them unconditionally (`reportCsv.ts:50, :53-55`), Fineness as 0. So a finless design's CSV has CP and stability rows that the `.ork` written beside it does not. The PDF has no pitch or roll inertia rows. The CSV hard-codes `'Drag Coeff. (Ma 0.3)'` where designInfo builds it from `CD_MACH`. designInfo's gating is the documented OpenRocket behavior.

**Fix.** `staticInfoRows(info): { key, si, quantity?, unit }[]` in `designInfo.ts` with the gating applied once; the three callers keep only their formatting. About 40 lines.

**Done, 2026-10-05.** The PDF gained the pitch and roll inertia rows (through the existing `stats.*` labels) and drops a missing Cd rather than printing a dash; its golden was updated for the added row.

### D12. Negative separation altitude reads two ways in `.ork` import (HIGH, VERIFIED) - FIXED 2026-10-05

- `ork/importTags.ts:279-286` `readSeparation`: `numTag(sepEl, 'separationaltitude', NaN)`, kept only if `alt >= 0 && alt !== 200`, so a negative value falls back to 200
- `ork/importConfigs.ts:148-149` `captureSeparations`: `nonNegTag(src, 'separationaltitude', 200)`, so a negative value becomes 0

**Drift.** A file with `<separationaltitude>-5` opens the design at 200 m and records 0 m as that configuration's override. The deployment pair (`readDeployment` / `captureDeployments`) agrees; its comment shows a floor fix already had to be applied to both.

**Fix.** `readDeploymentTags(src)` and `readSeparationTags(src)` in `importTags.ts`; the node readers and the per-config capture both call them. About 20 lines.

**Done, 2026-10-05.** A negative separation altitude floors to 0 in both, as deployment already did.

### D13. What the rocket is called depends on where you look (HIGH, VERIFIED, raised by two agents) - FIXED 2026-10-05

- `state/store.ts:527` `selectDesignName`: tree name, then loaded file name, then `defaultDesignName()`. The same chain at `store.ts:2010, :2025, :2042, :2062` (save `.ork`, `.rkt`, print, RASAero)
- `services/report/reportModel.ts:166`: loaded file name first
- `components/canvas/useExportData.ts:23`: loaded file name first, then `appName()`
- `components/canvas/FlightPathExport.tsx:65` `rocketName: tree.name ?? ''`, no fallback
- `services/storage/workspaceStore.ts:134` and `designLibrary.ts:350`: hard-coded English `'My Rocket'`

**Drift.** After renaming an imported rocket, the header and the `.ork`, `.rkt`, 3MF and CDX1 downloads carry the new name, while the PDF report and the 2D and 3D image headers carry the old file name. An unnamed design gets `AstraRocketJs` in images and `AstraRocketJs design` elsewhere, and a blank rocket name in KML and GPX. `selectDesignName` is right; its doc says it exists so every download carries the same name.

**Fix.** A pure `designNameOf(tree, loadedMeta)` beside `selectDesignName`, used by all of the above. For the library entries, only replace `'My Rocket'` with a translated default.

**Done, 2026-10-05.** `designNameOf` in `services/app/appInfo.ts`; `selectDesignName`, the four store save actions, the PDF report, the image exports, the KML/GPX dialog, the part export (`exportComponent` now takes the name) and both library naming paths call it. A source guard in `appInfo.test.ts` fails if the chain is written anywhere else. The Save As dialog still pre-fills with the imported file's name on purpose.

### D14. Unnamed stages: four labels (HIGH, VERIFIED) - FIXED 2026-10-05

- `services/report/reportModel.ts:173` `` (st.name as string) || `Stage ${i + 1}` `` (English in every locale); `components/report/ExportDialog.tsx:133` (same, unreachable fallback)
- `FlightChart.tsx:46`, `GroundTrack.tsx:132`, `FlightEventsTable.tsx:88`, `FlightCsvDialog.tsx:221`: `` `${t('flight.stage')} ${i + 1}` ``
- `StageColorDialog.tsx:104` `t('pathExport.stageN', { n: i + 1 })`
- Default stage names when writing: `ork/exportWriters.ts:461` "Sustainer" / "Booster n", `importReaders.ts:530`, `rktImport.ts:917`, `orkTree.ts:17`

**Drift.** The PDF says "Stage 2" in every language. The charts glue a translated word to a number, which is wrong for languages that put the number first (ja `stageN` is "第 {{n}} 段"). The interpolated key is right. The report's `<designinfo name=...>` says "Stage 1" while the `<stage><name>` in the same `.ork` says "Sustainer".

**Fix.** `stageLabel(name, index, t)` in `i18n/format.ts` on an interpolated key moved out of `pathExport.*`; `defaultStageName(i)` in `orkTree.ts` for file writers.

**Done, 2026-10-05.** Display: `stageLabel(t, index, name?)` on `flight.stageN` (moved from `pathExport.stageN` in all 10 locales; `flight.stage` dropped as unused), guarded in `format.test.ts`. Files: `defaultStageName` and `stageFileName` in `orkTree.ts`, used by the `.ork` reader and writer and the `.rkt` reader, and by the report model, whose stage names go into the `.ork` `<designinfo>` and the design CSV, so one file no longer names a stage two ways. `treeEdit`'s default name for a newly added stage is stored data and was left alone.

### D15. A part's display name (HIGH, VERIFIED for AftView) - FIXED 2026-10-05

- `components/canvas/AftView.tsx:80` `n.name ?? t(...)`: an empty name (what clearing the Name field writes) shows blank
- `SavePartButton.tsx:41`: the only copy that trims
- `DeploymentSection.tsx:37`, `SeparationSection.tsx:58`, two others: no `defaultValue`, so an unknown type shows the raw key
- `state/store.ts:135-143` `repairNotes` passes the raw type (`"bodytube"`) into the banner, while `services/flight/runnability.ts:136` translates it (REPORTED)
- Also `ComponentTree.tsx:128/176`, `ComponentActions.tsx:35`, `StageRecovery.tsx:39`, `useSelectedComponent.ts:57`, `PrintExportDialog.tsx:27`, `markingSection.ts:129, :171`, `partsSection.ts:42`, `ConfigsTable.tsx:100-101`

**Fix.** `partDisplayName(node, t)` in `tree/nodeProps.ts`: trimmed name, else `t('part.<type>', { defaultValue: type })`. About 15 lines.

**Done, 2026-10-05.** As `partLabel(t, node)` in `i18n/format.ts`, used by 13 sites. `repairValues` and `badDimensions` now hand over the raw name (empty when none) and the type, and the banner and blocker texts localize at display (`repairedText`), which also stops a part literally named "bodytube" being translated. Type-only labels and `ConfigsTable`'s indexed label were left as they are.

### D16. Meters to latitude and longitude: sphere vs WGS84 (HIGH, VERIFIED, raised by two agents) - FIXED 2026-10-05

- `services/landing/descentDrift.ts:69-78` `EARTH_RADIUS_M = 6_371_008.8`, `offsetToLatLon`; used by `landing/terrain.ts:30-31` and `EnvironmentLanding.tsx:60`
- `services/exports/flightPathExport.ts:728-742` `metersPerDegree` (WGS84 series `111132.92 - 559.82 * cos(2φ) + ...`, pole guard)

**Drift.** The in-app landing coordinate and the KML/GPX export of the same flight differ by about 9 m on a 3 km drift and about 30 m on 10 km. The kernel's spherical strategy uses a third radius (`WorldCoordinate.java:10`, 6371000). The WGS84 series is the more accurate one and the export comment says the desktop path builder uses it (one agent could not find it in `engine-java` core; check before citing).

**Fix.** `services/map/geodesy.ts`: `metersPerDegree(latDeg)` and `offsetToLatLon(lat, lon, p)` on the WGS84 series. Landing and terrain tests need new expected values.

**Done differently, 2026-10-05.** Neither app copy matched the kernel. The kernel records latitude and longitude (φ, λ, degrees) at every step with the Earth model the simulation chose (flat, spherical or WGS84; `SimulationStatus.java:640-641`), and ordinary runs return those series. So the Environment tab now reads the kernel's φ/λ at landing (`groundTrack.landingLatLon`) and projects only for an older saved result without them. Where no kernel run exists (the landing tool, the terrain grid, that fallback), `services/map/geodesy.ts` is a term-for-term port of the kernel's default SPHERICAL `addCoordinate`, tested against closed-form points. The landing tests kept their expected values within tolerance. The KML/GPX export reads the same kernel φ/λ for every path point, waypoint and landing, and projects with `geodesy.ts` only for a result saved without them or for a launch site left unset (exported about the Kennedy Space Center, where the kernel's coordinates describe (0, 0)). Its WGS84 series is gone; exported coordinates moved by a few meters, and the export tests were updated to the kernel's figures.

### D17. Latitude and longitude display (HIGH, REPORTED, raised by three agents) - FIXED 2026-10-05

`services/map/slippyMap.ts:127` `formatCoord` prints hemisphere letters ("104.8000° W") because a dropped minus sign is the error it exists to catch. Six other sites print signed values with `toFixed` at 3, 4 or 5 places, none locale-aware: `EnvironmentLanding.tsx:61`, `LandingEstimator.tsx:284`, `EnvironmentView.tsx:121`, `LocationsDialog.tsx:180`, `WeatherDialog.tsx:279`, `WeatherSourceLine.tsx:68`. The landing coordinate a user walks to is one of the signed ones.

**Fix.** `formatCoord(lat, lon, places = 4)` everywhere (5 for landing points), with `formatLat` / `formatLon` for single-axis use, digits through `fmtNum`.

**Done, 2026-10-05.** All six sites, with a source guard in `slippyMap.test.ts`. Each keeps its own precision (5 for landing points, 4 for sites, 3 for weather points).

### D18. Site-local time formatting (HIGH, VERIFIED) - FIXED 2026-10-05

- `EnvironmentView.tsx:124-138` `siteTime` and `WeatherSourceLine.tsx:41-55`: identical, with a try/catch that falls back to the viewer's zone
- `WeatherDialog.tsx:209-221`, `LandingEstimator.tsx:149-159`, `OffTheRail.tsx:143-153`, `EnvironmentLanding.tsx:104-109`: no try/catch

**Drift.** An unrecognized zone string (it comes from Open-Meteo and from the saved weather source) throws a RangeError during render in four views. OffTheRail also drops the year. All six use `i18n.language`; `i18n/format.ts` uses `resolvedLanguage`.

**Fix.** `fmtSiteTime(at, timeZone, opts?)` in `i18n/format.ts` with the fallback. About 45 lines.

**Done, 2026-10-05.** Six sites; the off-the-rail tool's missing year and the hour table's time-only form are explicit options now. A guard fails on any `Intl.DateTimeFormat` with a `timeZone` in the components.

### D19. Map imagery "offline" verdict, four rules (HIGH, VERIFIED, raised by three agents) - FIXED 2026-10-05

- `components/canvas/GroundTrack.tsx:319-341`: 3 failures mark the layer unavailable only if no tile has loaded; onLoad keeps the same state object; pressing the layer retries
- `components/tools/LandingMap.tsx:122-131`: onLoad only resets the counter, so 3 failures in a row after successful loads blank the imagery
- `components/sim/SiteMap.tsx:338`: `setReached({ src: source, state: 'ok' })` creates a new object per tile, the re-render pattern `GroundTrack.tsx:321-326` records stalling the tab; `pickSource` (:105-109) never clears 'unavailable' and the buttons are hidden, so there is no retry
- `components/canvas/FlightGroundMap.tsx:179-180`: the failure count is never reset on success, so any 3 coverage holes among dozens of loaded tiles drop the 3D imagery

GroundTrack is right. **Fix.** `useTileVerdict(source): { imagery, onTileLoad, onTileError, retry }` in a new `components/common/map/`, and a shared `TILE_FAILURES_OFFLINE = 3`. See D86 for the rest of the map stack.

**Done, 2026-10-05.** GroundTrack's rules for every map: `useTileVerdict(source)` in `components/common/map/useTileVerdict.ts`, with `TILE_FAILURES_OFFLINE = 3` in `mapStyle.ts`. A loaded tile makes the source reachable, so later failures are coverage holes; the state object is kept when the verdict does not change; pressing a layer is a retry. The 3D ground map reports each tile to the same hook instead of counting on its own. The site map keeps its layer buttons up while offline, so the retry is reachable there too.

### D20. Landing distance: unit scope and rounding (HIGH, REPORTED, raised by three agents) - FIXED 2026-10-05

The same flight's landing distance uses the apogee-scoped unit on Ground Track (`GroundTrack.tsx:128`) and the plain distance unit in the Environment tab (`EnvironmentLanding.tsx:35`, and its `LandingMap` rings). After the user sets the apogee unit chip, the two views of one flight show different units. The `>= 100 ? 0 : 1` decimals rule is written four times (`GroundTrack.tsx:267-271`, `EnvironmentLanding.tsx:56`, `LandingMap.tsx:93-96`, `LandingEstimator.tsx:146`). LandingEstimator, a standalone tool, is right to stay on the plain unit.

**Fix.** `fmtGroundDistance(fu, m)` beside `FieldUnit` in `prefs/useUnits.ts`; EnvironmentLanding takes the apogee scope; LandingMap takes the `FieldUnit` as a prop.

**Done, 2026-10-05.**

### D21. Non-finite numbers written into files (HIGH, VERIFIED) - FIXED 2026-10-05

- `services/files/rasaero/units.ts:16-17` `nnum`: `typeof node[key] === 'number' ? ... : fb`, 33 calls across the RASAero writers, so NaN and Infinity pass. `:20-23` `fmt` has no finite guard, so the `.CDX1` gets the text "NaN"
- `services/exports/threeMf.ts:63-66` `fmt`: no finite guard, writes "NaN" into the 3MF
- `rktExport.ts:77-81` writes "0"; `csvExport.ts:23-26` and `reportCsv.ts:16` write ""
- The same `typeof`-only read at `ork/exportParts.ts:213-214, :245, :368-369`, `reportModel.ts:89-91`, `shapeProfile.ts:270`, `rktImport.ts:862`, `parts/customParts.ts:43-46`

`tree/nodeProps.ts` `num` / `numOpt` check `Number.isFinite`, a check its comment calls load-bearing. **Fix.** Delete `nnum` and use `num`. Add `plainDecimal(v, digits, nonFinite)` as the locale-free counterpart to `fmtNum`, with each writer passing its precision and its non-finite text. About 50 lines.

**Done, 2026-10-05.** `nnum` is gone; the RASAero writers read through `num`. `plainDecimal` lives in `services/files/numberText.ts` (not `i18n/format.ts`, since it is file text), built on `toFixed` because the golden exports pin `toFixed`'s rounding of a halfway value; the RASAero, 3MF and `.rkt` writers pass `'0'` for a non-finite value, the CSVs an empty cell. The remaining `typeof`-only reads (`.ork` writer, report model, `.rkt` reader, `mountFit`) go through `num`/`numOpt` too.

### D22. The image export header misspells the app name (HIGH, VERIFIED) - FIXED 2026-10-05

`services/exports/schematicExport.ts:47` writes `` `ArsRocketJs Sim v${...}` `` into every 2D SVG/PNG and 3D snapshot. `orkExport.ts:29` uses `appName()`, and its comment names this exact hazard. **Fix.** Call `appName()`.

### D23. CP percentage labels are English in the tables (HIGH, VERIFIED) - FIXED 2026-10-05

`AeroComponentTables.tsx:311-312` hard-codes `CP (% body)` and `CP (% length)`. The chart toggle for the same figure uses `t('aero.pctBody')` / `t('aero.pctLength')` (`AeroAnalysis.tsx:326`), translated in all 10 locales (de "% Rumpf"). **Fix.** Build the headers from the same keys.

### D24. Simulation figures: two precisions (HIGH, VERIFIED) - FIXED 2026-10-05

`SimSummary.tsx:228, :280, :296, :302` pass explicit digits (1, 1, 0, 0). `SimulationsTable.tsx:228-243` passes none, so `ladderDigits` applies. A 6.2 m/s landing reads "6.2" on the tile and "6.20" in the table; 85 m/s² reads "85" against "85.0". The unit scopes are also built twice (`SimSummary.tsx:180-188`, `SimulationsTable.tsx:77-81`).

**Fix.** `SIM_RESULT_FIGURES: { key, scope, quantity, digits? }[]` in `services/flight/`, read by both.

**Done, 2026-10-05, more simply.** The tiles dropped their fixed digits and use the ladder, as the table does; a fixed digit count does not survive a unit change (0 digits turns 8.67 g into "9"). The shared table was not built.

### D25. CG marker colors in 3D (HIGH, VERIFIED) - FIXED 2026-10-05

`Rocket3D.tsx:90` marker `#2b6cff` (blue), `:238` leader `#dbe3ea` (near white), `:268` legend dot `#aab2bd` (gray). The legend matches neither drawn element. CP uses `#e34948` consistently. **Fix.** `CG_INK` / `CP_INK` constants in `stabilityGadget.ts`.

**Done, 2026-10-05.** The legend dot now uses the marker ink. The CG leader and label stay near-white for legibility on the dark background.

### D26. The same UTF-16 motor file is accepted in one path and refused in another (HIGH, REPORTED, raised by three agents) - FIXED 2026-10-05

`MotorDialog.tsx:254` `importCustomMotors(await file.text())`; `WindProfileDialog.tsx:220` and `useExportTemplates.ts:55` the same. `File.text()` is UTF-8 only. A `.rse` embedded in an `.ork` goes through `decodeFileText` (`ork/importUnpack.ts:59`) and decodes. Imported directly, the same file arrives with NULs and fails as "Not a valid .rse file".

**Fix.** `readFileText(file)` in `services/files/decodeText.ts` (`decodeFileText(new Uint8Array(await file.arrayBuffer()))`), called at all three sites.

**Done, 2026-10-05.** With a guard against `file.text()` anywhere in `src`.

### D27. Weather error text, four copies (MED, VERIFIED) - FIXED 2026-10-05

`WeatherDialog.tsx:84-95` and `LandingEstimator.tsx:102-113` `errorText` are identical; `OffTheRail.tsx:112-119` inlines the same. `EnvironmentLanding.tsx:91-96` lacks the `weather.dateRefusal.*` branch, so a refused date shows the generic error, and falls back to `env.landing.failed` instead of `weather.error.offline`. OffTheRail renders its error in rose with no live region; the others use amber in `role="status"`. **Fix.** `weatherErrorText(err, t, fallbackKey?)` in `services/weather/`.

**Done, 2026-10-05.** The Environment tab keeps `env.landing.failed` as its own fallback, since its run also flies the simulations. The rose, no-live-region styling in OffTheRail is not changed here.

### D28. Downrange distance from independent samples (MED, VERIFIED) - FIXED 2026-10-05

`SimSummary.tsx:17` `lastFinite` takes the last finite Px and the last finite Py separately (:203-205), so they can come from different samples. `services/flight/groundTrack.ts:79` `landingPoint` keeps only samples where both are finite. When either series has a trailing null, the Downrange tile and the ground-track readout disagree. **Fix.** `distanceFromPad(landingPoint(series))`.

### D29. The thrustcurve fetch does not abort on an error reply (MED, VERIFIED) - FIXED 2026-10-05

`services/motors/thrustcurve.ts:48-91` says it is "Staged, the way remoteData.fetchJson does it", but on a non-2xx reply it throws at :63 without aborting, so an error page keeps streaming until the body timer fires. `services/app/remoteData.ts:122-126` aborts first and throws `HttpError`. `services/weather/openMeteo.ts:455-458` has a single budget and no size cap. **Fix.** `fetchJsonCapped<T>(url, init, { ttfbMs, bodyMs, maxBytes, onProgress })` in `services/app/fetchProgress.ts`, with `HttpError` moved there.

### D30. Tube bore read three ways (MED, REPORTED) - FIXED 2026-10-05

`motorPicker.ts:59-68` `mountFit` treats a missing thickness as 0 (bore = OD) and lets NaN through (every motor "fits"); `parts/componentFit.ts:235-241` returns no bore; `discGeometry.ts:28-33` subtracts the default wall. A bay with two inner tubes resolves to the widest in componentFit (:284-288) and to the first in `discGeometry.mountBore` (:57-62). **Fix.** `tubeRadii(node)?.innerR` everywhere and one documented `mountBore` rule.

**Done, 2026-10-05, in part.** `mountFit` and `componentFit.innerDiameter` now take the type's kernel wall when the key is missing (`tubeWall` in `discGeometry.ts`), and `mountFit` no longer lets a NaN wall through. An explicit zero wall is still refused as a bad value, as before. First vs widest mount was left alone: a centering ring's drawn hole is its one mount, and the picker's constraint is the widest tube in the bay, as `componentFit`'s own comment explains. They answer different questions.

### D31. Report drops loose parts in a mixed tree (MED, VERIFIED) - NOT REACHABLE

`reportModel.ts:167-170` wraps the top level in a stage only when there are zero stages, so in a tree with some stages and some loose parts, the loose parts drop out of every report section. `services/design/orkTree.ts:14-18` `asStageNodes` wraps the whole list when any top-level node is not a stage, which matches what the exporters write. **Fix.** Call `asStageNodes(tree)`.

**Not reachable, 2026-10-05.** The engine facade rejects a mixed top level (`OpenRocketEngine.java:309-311`: "with stages, EVERY top-level node must be a stage"), so a mixed tree never builds and `assembleReport` returns null before this line. The two copies still disagree, so `asStageNodes` remains the right call when the file is next touched, but there is no user-visible bug.

### D32. Displayed numbers outside `i18n/format.ts` (MED, VERIFIED for two sites) - FIXED 2026-10-05

`SiteMap.tsx:470` `big.toFixed(...)`, `WindProfileDialog.tsx:112`, `ScaleDialog.tsx:116`, `StabilityBadge.tsx:54-58` (`toPrecision(4)` / `toExponential(3)` for the inertia tiles), `AeroComponentTables.tsx:113, :286`. In de/fr/es/pt these show "." beside "," everywhere else on the same screen. `FlightEventsTable.tsx:60` joins angle value and symbol with no space, so with radians selected it reads "1.2rad". **Fix.** `fmtNum`; add `fmtSig(v, sig)`; use `withUnit` (see D72).

**Done, 2026-10-05.** The inertia tiles now read in Intl scientific form below 1e-4 ("1.234E-5").

### D33. Color pickers bound to settings write on every drag tick (MED, REPORTED) - FIXED 2026-10-05

`FlightPath3D.tsx:777-815` `Legend` commits on the native `change` and blur, with a comment that per-tick writes caused "dozens of writes per gesture". `SettingsDialog.tsx:562-603` `ColorRow` and `report/ExportDialog.tsx:443-458` write the whole settings object to storage on every input tick, for the same `settings.phaseColors`. **Fix.** `ColorField({ value, onCommit })` in `components/common/` on Legend's pattern. About 30 lines. (`AppearanceSection.tsx` writes to the store with an undo entry, which is a different contract.)

**Done, 2026-10-05.** `ColorInput` in `components/common/`, on Legend's pattern (commits on the native `change` event or blur). Used by the settings `ColorRow`, the export dialog's fill and stroke, and the 3D legend.

### D34. SVG path builders without the gap guard (MED, REPORTED, raised by four agents) - FIXED 2026-10-05

`components/canvas/aeroTables.ts:66-85` `buildLinePath` skips non-finite samples and restarts with `M`; its comment explains that an index-based `M` on a NaN first sample makes the browser drop the whole path. `components/sim/chartAxes.tsx:35-36` `linePath`, `WindProfileDialog.tsx:82`, `EnvironmentView.tsx:205-214` still take the letter from the index. `FlightChartPanel.tsx:113-117` is safe only because it pre-filters. Latent: thrust curves and wind levels are finite today. **Fix.** One `linePath(pts, X, Y, breakIf?)` built from `buildLinePath`, in `chartAxes.tsx` or `components/common/svgPath.ts`.

**Done, 2026-10-05.** `polylinePath(pts, style, breakBefore?)` in `components/common/svgPath.ts`: skips non-finite points and restarts with `M` after a gap. The aero tables, `chartAxes.linePath`, the wind profile, the environment profiles (with their wrap breaks) and the flight chart all use it; output for finite data is unchanged.

### D35. Hex color parsing (MED, REPORTED) - FIXED 2026-10-05

`flightPathExport.ts:406-409` `hexToRgbInt` uses `parseInt` on any prefix, so `'#abc'` becomes `0x000abc` in the KML. The other parsers are strict on 6 digits (`ork/exportParts.ts:149-155`, `report/layout.ts:11-16`, `settings.ts:422-423`) except `threeMf.ts:55-60`, which also accepts `#rgb`, so a 3-digit color reaches the 3MF and is dropped from the `.ork`. Fallbacks differ (skip, gray-900, neutral, black). **Fix.** `parseHexColor(s)` and `hexOf(rgb, hash)` in `services/design/colorHex.ts`; callers keep their fallback.

**Done, 2026-10-05.** One reading everywhere: `#rrggbb`, bare `rrggbb`, `#rgb` (the `#` required, so a word like "bad" is not a color) and `#rrggbbaa` with the alpha dropped. Three tests that recorded the old quirks as "recorded rather than endorsed" were updated.

### D36. Download filenames built by hand (MED, VERIFIED for the fin CSV) - FIXED 2026-10-05

`saveFile.ts:126` `exportFilename` documents one rule: rocket plus what it is, blank parts dropped. `FreeformFinActions.tsx:34-35` writes `Fin_set.csv` with no rocket name and no trim. `SchematicControls.tsx:75, :95`, `useRocketExport.ts:80` and `reportCsv.ts:92` give `rocket-2d.svg` for an unnamed design where the rule gives `2d.svg`. `rocketPrintExport.ts:131` writes `Bertha.3mf` with no document word. **Fix.** `exportFilename([...], ext)` at every site.

**Done, 2026-10-05.** The fin outline is now `Bertha-Fin_set-points.csv` and the whole-rocket print file `Bertha-print.3mf`. The other sites already produced the same names (the rocket name is never blank since D13) and now route through `exportFilename`.

### D37. Override field labels differ between deployment and separation (MED, VERIFIED) - FIXED 2026-10-05

`DeploymentSection.tsx:51, :76, :99` build accessible names with an em dash between the part name and the field; `SeparationSection.tsx:77, :91, :111, :131` use a hyphen. Screen readers announce the same kind of field two ways. Select widths also differ (w-40, w-44). See D93 for the shared card.

**Done, 2026-10-05.** Both cards build their labels through `overrideFieldLabel` (`components/config/OverrideFields.tsx`), with a plain hyphen. The select width is a prop; separation keeps its wider list.

### D38. Sortable headers: one announces the sort, one does not (MED, REPORTED, raised by three agents) - FIXED 2026-10-05

`ComponentPicker.tsx:600-618` sets `aria-sort`; `MotorGrid.tsx:113-126` does not. The toggle rule is the same. **Fix.** `SortHeader({ active, dir, onClick })` in `components/common/`.

**Done, 2026-10-05.** `SortHeader` in `components/common/`; `aria-sort` is set only on sortable columns. Used by the motor grid and the component picker.

### D39. Menu popovers dismiss four ways (MED, REPORTED, raised by four agents) - FIXED 2026-10-05

`ImageExportMenu.tsx:43-50, :70-78` (pointerdown; Escape only with focus inside; returns focus), `ResultPicker.tsx:35-47` (pointerdown; window Escape; no focus return), `ComponentExportButton.tsx:29-41` (mousedown; window Escape; no focus return; `role="menu"` without roving), `FileMenu.tsx:320-336` (mousedown; window Escape; focus return; arrow roving). None goes through the topmost-surface rule, so Escape inside a dialog also closes them. FileMenu is the most complete. **Fix.** `useMenuPopover(open, setOpen, refs)` in `components/common/`.

**Done, 2026-10-05.** `useMenuPopover()` in `components/common/`: outside pointerdown closes, Escape closes and returns focus to the trigger. Escape is taken in the capture phase and marked handled, and the maximized canvas skips a handled Escape, so closing a menu does not also leave the maximized view. FileMenu keeps its arrow-key roving.

### D40. Store edits record empty undo steps (MED, REPORTED) - FIXED 2026-10-05

`state/store.ts:1100-1177`: `scaleDesign` and `applyTreeAction` skip the undo step when nothing changed; `removeSelected` and `moveSelected` always record one, and `moveNode` always returns a fresh clone, so a move at the sibling boundary records an empty step and triggers a rebuild. `addPartToTree` and `addStageToTree` record before computing, so a throw leaves a no-op entry. **Fix.** A local `commitTree(next, extra?)` that returns early when `next === tree`; `moveNode` returns its input when nothing moves.

**Done, 2026-10-05.** `commitTree(next, extra)` in the store installs a whole-tree edit as one undo step with the configurations reconciled, and records nothing when the edit returns the tree it was given. The edit is computed before it runs, so one that throws leaves no step. `moveNode` returns its input at either end of the siblings. Scale, tree actions, remove, move, add part and add stage all go through it.

### D41. Synchronous localStorage preferences, four validators (MED, VERIFIED for one) - FIXED 2026-10-05

`MotorDialog.tsx:27-44` `loadMfrs` does `new Set(JSON.parse(r))` with no array check, so a stored string `"abc"` becomes `{a, b, c}`. `loadDia` (:51-66) accepts any 2-element array. `motorColumns.ts:153-168` and `common/dialogSize.ts:98-122` check shape. `weather/weatherKey.ts:13-31` repeats the try/catch. **Fix.** `readLocalJson(key, valid, fallback)` and `writeLocalJson(key, value)` in `services/storage/`.

**Done, 2026-10-05.** In `services/storage/localPref.ts`, used by the motor picker (its loaders moved to `components/sim/motorPrefs.ts`), the motor column chooser and the dialog size memory. `weatherKey.ts` stores a plain string, not JSON, and was left.

### D42. `<radialposition>` for a centered part (LOW, VERIFIED) - FIXED 2026-10-05

`ork/exportWriters.ts:70-75` `radialXml` writes `0.0` as the desktop does; the inner tube (:224) and mass component (:371) write it inline as `0`. File bytes only. **Fix.** Call `radialXml`. Needs a golden re-bless.

**Done, 2026-10-05.** Confirmed against the desktop-written fixture in `orkDesktopFixture.test.ts`, whose inner tube carries `0.0`. The golden `.ork` was re-blessed; its diff was only these two tags.

### D43. Fin outlines outside `finPlanform.ts` (LOW, REPORTED) - FIXED 2026-10-05

`rktImport.ts:431-443` builds the trapezoid outline itself; its zero fallbacks are right for RockSim (`FinSetHandler.java:72-87`), so the fix is to share the point builder, not the defaults. `rasaero/sustainer.ts:16-24` falls back to sweep 0 where the kernel and `FIN_DEFAULTS` use 0.02 (RASAero is export-only; this affects only a fin with no sweep key). **Fix.** Export `trapezoidPoints(root, tip, sweep, height)` from `finPlanform.ts`.

**Done, 2026-10-05.** `trapezoidPoints` exported from `finPlanform.ts`, used by the planform and the `.rkt` reader (which keeps RockSim's zero fallbacks). The RASAero writer reads the fin through `trapezoidDims`, so a fin with no sweep key writes the kernel's 0.02 m. No golden fixture had such a fin.

### D44. Curve interpolation at step knots (LOW, REPORTED) - FIXED 2026-10-05

At a duplicated-time knot, `motorCombine.ts:21-44` `thrustAt` returns the last sample, `services/tools/railExit.ts:61-69` `at` returns the first mid-curve and the second at t=0, and `interpolate.ts:14` `lerpAt` returns the first. Effect on rail exit is one 0.5 ms step. **Fix.** railExit uses `thrustAt` and `lerpAt`.

**Done, 2026-10-05.** Rail exit reads thrust through `thrustAt` (the value going forward from a step) and motor mass through `lerpAt`.

### D45. Cached motor spec accepted with one sample (LOW, REPORTED) - FIXED 2026-10-05

`thrustcurve.ts:278-293` `isCachedMotorSpec` accepts one sample; `motorCurve.ts:66-75` `hasUsableCurve` requires `MIN_CURVE_SAMPLES` (2). A legacy one-sample cache entry is served and then refused at Run. **Fix.** `isCachedMotorSpec = hasUsableCurve`.

### D46. Key-order-sensitive equality (LOW, REPORTED) - FIXED 2026-10-05

`flight/simDiff.ts:22-33` and `weather/weatherSource.ts:75` compare with `JSON.stringify`; `simulations.ts:110-121` `stableJson` sorts keys because `sanitizeSims` reorders blocks. A level object with a different key order is flagged "differs" while `resultKey` calls it equal. **Fix.** Export `stableJson` and use it.

**Done, 2026-10-05.** `stableJson` moved to `services/app/stableJson.ts` and used by the simulation diff and the weather source comparison. List order still counts; key order does not.

### D47. Report motor statistics (LOW, REPORTED) - FIXED 2026-10-05

`report/rocketReport.ts:31-46` `motorStats` recomputes impulse, burn, average and peak; `motorMath.ts:35-50` `curveStats` already does. The peak uses `Math.max(...spec.thrusts)`, which can overflow the stack on a very long curve. **Fix.** `curveStats(samples)`.

**Done, 2026-10-05.** `motorStats` reads `curveStats`. A million-sample curve overflowed the stack before; a test covers it.

### D48. Small LOW drifts (LOW) - FIXED 2026-10-05

| What | Sites | Drift | Fix |
| ---- | ----- | ----- | --- |
| "User is typing" check (REPORTED) | `layout/useUndoShortcuts.ts:21-26`, `sim/MotorGrid.tsx:89-90` | MotorGrid misses contentEditable (none in the app today) | `isTextEntry(el)` in `components/common/` |
| Roll readout (VERIFIED) | `canvas/CenterCanvas.tsx:206` `Math.round((roll * 180) / Math.PI)` | Ignores the angle unit | `u.fmt('angle', roll, 0)` with `withUnit` |
| Plan-view extent floor (REPORTED) | `tools/LandingMap.tsx:61-65` vs `flight/groundTrack.ts:136` `trackExtent` | 55 m minimum frame vs 50 m | Call `trackExtent` |

**Done, 2026-10-05.** `isTextEntry` in `components/common/` for the undo shortcuts and the motor grid. The roll slider's readout, tooltip and end labels follow the angle unit (an e2e test sets radians). The landing map frames through `trackExtent`, so both plan views have the same 50 m floor.

---

## DUP

| ID  | Sev  | Tag      | What                                                                   | Copies                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Proposed home and signature                                                                                                                                       | Lines |
| --- | ---- | -------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| D49 | HIGH | FIXED 2026-10-05 | Default-material settings key format and the material-type list         | `design/materialSlots.ts:63` `${partType}:${materialType}`; `storage/settings.ts:608` `/^[a-z]+:(bulk\|surface\|line)$/`; `materials/materialTypes.ts:14, :55`. A new type or key change silently drops saved defaults on load                                                                                                                                                                                                                             | `parseDefaultMaterialKey(key)` in materialSlots; export `isMaterialType` from materialTypes                                                                        | ~3    |
| D50 | MED  | FIXED 2026-10-05 | Tree walks: find node, find with parent, collect by predicate, sibling array, structural-sharing map | `treeEdit.ts:44-49, :51, :140-153, :166-203, :496-553, :790-794`; `componentActions.ts:59-88`; `finTabAuto.ts:211-224`; `rocketPrintExport.ts:73-87` (`nodeById` = `findNode`); `finPlanform.ts:117-131`; `schematicGeometry.ts:118-128`; `reportPdf.ts:54-60`; `report/layout.ts:27-37`; `reportModel.ts:242-263`; `componentFit.ts:41-54`; `FlightPath3D.tsx:50-70`; `rasaero/{surface,recovery,engines}.ts`; `ork/importNotes.ts:17-24`; `scaleRocket.ts:263-293`; `requiredComponent.ts:95-108`; `autoShoulder.ts:49-79`, `autoRadius.ts:110-163`, `repairValues.ts:58-73` | New `tree/treeWalk.ts`: `walkNodes(nodes)`, `findNode`, `findWithParent`, `findSiblings`, and `mapTreePreserving(nodes, fn, order)` (order is load-bearing: autoShoulder is post-order). Keep walks that thread state (discGeometry, printableParts) | ~130  |
| D51 | MED  | FIXED 2026-10-05 | List persisted as one JSON blob in a KeyValueStore                      | `exports/templateStore.ts:61-125`, `parts/presetStore.ts:79-135`, `materials/materialStore.ts:51-99`, `storage/launchLocationStore.ts:85-125`, `motors/motorStore.ts:193-245`; parse half also `storage/designLibrary.ts:106-144`. Only presetStore and motorStore guard a rejecting `kv.get`                                                                                                                                                                  | `services/storage/jsonListStore.ts`: `JsonListStore<T>(key, isItem, sameItem, kv?, normalize?)` with `list`, `upsert`, `remove`; domain stores wrap it          | ~100  |
| D52 | MED  | FIXED 2026-10-05 | Unwrap a FlightResult into branches                                     | `flight/flightEvents.ts:203-205`, `flight/recoveryFlown.ts:52-58` (no `?? []`), `canvas/flightChartTraces.ts:130-135`, `exports/flightPathExport.ts:748-753`, `flight/forecastHours.ts:87`, `EnvironmentLanding.tsx:48`, `store.ts:1668`                                                                                                                                                                                                               | `flightBranches(result, fallbackName = '')` beside `branchSeries` in `flightColumns.ts`                                                                          | ~20   |
| D53 | MED  | FIXED 2026-10-05 | Trapezoid total impulse, three input shapes                             | `motors/motorMath.ts:41-44`, `motorCombine.ts:47-53`, `engParser.ts:19-26`, `thrustcurve.ts:161-166`, `tools/railExit.ts:78-85` (average divides by `t[last] - t[0]`, others by `t[last]`; same while curves start at 0)                                                                                                                                                                                                                               | `trapezoidImpulse(times, thrusts)` and `cumulativeImpulse` in `motorMath.ts`                                                                                     | ~20   |
| D54 | MED  | FIXED 2026-10-05 | A chain member's outer radius                                           | `schematicGeometry.ts:210, :242, :265, :289`, `AftView.tsx:101`, `tree/assembly.ts:24-31`, `scaleRocket.ts:263-276`, `discGeometry.ts:40-42`                                                                                                                                                                                                                                                                                                          | `chainOuterRadius(n)` in `tree/nodeProps.ts`                                                                                                                     | ~15   |
| D55 | MED  | FIXED 2026-10-05 | Persisted workspace snapshot                                            | `store.ts:861-874` `snapshotOf`; `useWorkspaceEffects.ts:141, :184-194`. The `Workspace` type makes a mismatch a compile error                                                                                                                                                                                                                                                                                                                       | Export `workspaceSnapshot(s)` from the store                                                                                                                    | ~12   |
| D56 | MED  | FIXED 2026-10-05 | Set or delete one key of an override map, drop an empty map             | `store.ts:1214-1245` (`setDeployment`, `setSeparation`), `:1368-1379` (`setSimPref`), `:1444-1450` (`setRun`)                                                                                                                                                                                                                                                                                                                                        | `withKey(obj, key, value \| null)` local to store.ts                                                                                                            | ~18   |
| D57 | MED  | FIXED 2026-10-05 | CSV formula-injection trigger set                                       | `exports/csvExport.ts:249-254`, `report/reportCsv.ts:30-33`, `exports/flightPathExport.ts:1498`. The quoting and leading-minus differences are documented and intentional; the trigger set should live once                                                                                                                                                                                                                                       | `neutralizeFormula(s, { keepNumericMinus })` in `services/exports/csvCell.ts`; quoting stays per format                                                          | ~6    |
| D58 | MED  | FIXED 2026-10-05 | Axial chain (stages flattened)                                          | `schematicGeometry.ts:204`, `rocketPieces.ts:496`, `reportGeometry.ts:78`; variants `discGeometry.ts:81`, `tree/position.ts:197`                                                                                                                                                                                                                                                                                                                    | `axialChain(tree)` in `tree/position.ts`                                                                                                                         | ~5    |
| D59 | MED  | FIXED 2026-10-05 | Motor seat position in a mount                                          | `rocketPieces.ts:323, :448`, `schematicShapes.tsx:720, :816`. All four match `InnerTube.java:432` / `BodyTube.java:520`                                                                                                                                                                                                                                                                                                                             | `motorSeatStart(mount, mountStart, mountLen, motorLen)` in `tree/`                                                                                               | ~4    |
| D60 | MED  | FIXED 2026-10-05 | Override-over-design resolution and design defaults for deploy and separation | `config/DeploymentSection.tsx:32`, `configColumns.tsx:62, :95, :97`, `SeparationSection.tsx:55, :133`; the 200 m default also at `ork/exportParts.ts:369`, `ork/importTags.ts:285`                                                                                                                                                                                                                                                     | `effectiveDeployment(config, device)`, `effectiveSeparation(config, stage)`, `DEFAULT_SEPARATION_ALTITUDE_M` in `flightConfigs.ts`                                | ~12   |
| D61 | LOW  | FIXED 2026-10-05 | Mesh edge counting and weld sequence                                    | `exports/solidMesh.ts:32-58, :71-86`, `meshValidate.ts:48, :124-132`; weld at `solidMesh.ts:323-333, :371-377, :410-414`                                                                                                                                                                                                                                                                                                                             | Export `edgeKey` / `undirectedEdgeCounts` from meshValidate; `weldSolid(geo)` in solidMesh                                                                       | ~20   |
| D62 | LOW  | FIXED 2026-10-05 | RockSim tube wall and radial angle, read and write                      | `rktImport.ts:358-362, :385-403, :468-469, :550-556, :745-746`; `rktExport.ts:208-211, :240-243, :291-294`                                                                                                                                                                                                                                                                                                                                          | Local `readTubeWall`, `readRadialAngle`, `writeTubeWall`                                                                                                         | ~20   |
| D63 | LOW  | FIXED 2026-10-05 | Untrusted-file limit checks and notes                                   | `ork/importReaders.ts:493-526`, `rktImport.ts:814-841, :911-948`, `orkImport.ts:69-81`. Only the format word differs                                                                                                                                                                                                                                                                                                                               | `countComponent(ctx, format)`, `checkDepth(depth, format)` in `ork/importLimits.ts`                                                                              | ~12   |
| D64 | LOW  | FIXED 2026-10-05 | In-file repeated rows                                                   | `SimEditor.tsx:350-397` (4 Override blocks), `SettingsDialog.tsx:354-418` (4 speed rows), `DriftSweepPanel.tsx:124-151`, `DimensionFields.tsx:365-491`, `componentFields.ts` separation and deploy triplets                                                                                                                                                                                                                                         | Local row helpers or `const SEPARATION_FIELDS` / `DEPLOY_FIELDS`                                                                                                  | ~90   |
| D65 | LOW  | FIXED 2026-10-05 | Small agreeing pairs (one row each)                                     | `confirmStore.ts:29-44` / `promptStore.ts:31-46`; flight CSV defaults `csvExport.ts:76-86` / `settings.ts:497-506`; `store.ts:806` / `workspaceStore.ts:99` `lean`; storage-full banner `store.ts:958, :1862-1911`, `SettingsProvider.tsx:112`; `BackendPref` in `openRocketEngine.ts:294` and `simProtocol.ts:29`; `idbKeyValueStore.ts:271-318` demote; `treeEdit.ts:375-387` / `defaultRocket.ts:205-217` preset link; `stageNodes` inline at `treeEdit.ts:213, :228, :874`; deployable predicate at 5 sites; `componentExport.ts:39-48` / `rocketPrintExport.ts:63-70`; PDF paragraph at `templatesSection.ts:25-28`, `markingSection.ts:47-50, :131-134`; drift-sweep and active-result selectors | Per row, in the owning module                                                                                                                                    | ~110  |
| D66 | LOW  | FIXED 2026-10-05 | Small agreeing pairs in services                                         | `helpDocs.ts:122` / `helpSearch.ts:166` page title; `appInfo.ts:37-90`, `remoteData.ts:42` trailing slash; `weatherProposal.ts:78, :135` humidity clamp; `motorDb.ts:311, :373` maker match; `openMeteo.ts:109-132` zone-tolerant parts; `simDiff.ts:36-67` diff keys; `forecastHours.ts:19, :66` / `landingEstimate.ts:31, :38` hour window; `flightEvents.ts:134` / `recoveryFlown.ts:61` / `SimSummary.tsx:200` series lookup; `rseParser.ts:239-244` / `importUnpack.ts:70-79` XML parse; `windSweep.ts:278` / `WindProfileDialog.tsx:209` / `LaunchPanel.tsx:619` turbulence retune | Per row, private helpers in the owning module                                                                                                                    | ~60   |

## BYPASS

D67, done 2026-10-05: chain parts now take the kernel's length when the key is missing (`partLength` in `tree/position.ts`, used by the 2D, 3D and PDF views and the printable solid), and the agreeing literals read `KERNEL_DEFAULTS`. The fairing's `width` and `height` were added to the table with kernel cases, and `FIN_DEFAULTS` gained `thickness`. Transition fore and aft radii keep their 12 mm and 9 mm placeholders: the kernel has no default there, since a missing radius means automatic.

| ID  | Sev | Tag      | Reimplements                                   | Sites                                                                                                                                                                                                                                                                                                                       | Use instead                                                                                                     |
| --- | --- | -------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| D67 | MED | FIXED 2026-10-05 | `KERNEL_DEFAULTS` (its header names the per-call-site `num(node, 'key', fallback)` pattern it replaces) | About 25 literals in `schematicShapes.tsx`, `schematicGeometry.ts`, `rocketPieces.ts`, `AftView.tsx`, `reportGeometry.ts:210-225`, `solidMesh.ts:499-500`. They agree with each other, but chain `length` falls back to 0 where the kernel uses nose 0.07, body 0.3, transition 0.05, so a keyless chain part is drawn as nothing and flown at full length | `KERNEL_DEFAULTS[type].key`, `kernelLength(type)`, `axialLength(n)`                                             |
| D68 | MED | FIXED 2026-10-05 | `ringInstanceOffsets` (`tree/assembly.ts:59`)  | Even fin and tube-fin angles: `schematicShapes.tsx:157-166`, `AftView.tsx:142, :162`, `rocketPieces.ts:224, :249`                                                                                                                                                                                                            | `ringInstanceOffsets(count, r, rotation + frameOffset)`                                                          |
| D69 | MED | FIXED 2026-10-05 | `tree/componentKinds.ts`, `tree/tubefins.ts`, `tree/assembly.ts` predicates (componentKinds' header forbids these idioms) | `finTabAuto.ts:141, :145`, `schematicGeometry.ts:208, :217, :279`, `ComponentTree.tsx:134`, `ComponentActions.tsx:37, :52`, `rasaero/sustainer.ts:60, :200`, `rasaero/booster.ts:42`, `rktImport.ts:861`                                                                                                                  | `isChainType`, `isFinSet`, `isPlanarFinSet`, `isAssembly`                                                        |
| D70 | MED | FIXED 2026-10-05 | `useLatest` (its header says it replaced MotorDialog's `pickGen`, which is still there) | `MotorDialog.tsx:137-143, :220-233`, `design/useSavedParts.ts:25-46`, `sim/useLocationList.ts:27-45`, `MaterialPicker.tsx:101-107`, `useRocketExport.ts:41-47`                                                                                                                                                            | `useLatest().claim` / `.observe`                                                                                 |
| D71 | MED | FIXED 2026-10-05 | `distanceFromPad` / `bearingFromPad` (`flight/groundTrack.ts:65, :68`) | `EnvironmentLanding.tsx:57-58, :124, :167`, `landing/descentDrift.ts:143-144`, `landing/landingEstimate.ts:156`, `flight/driftEllipse.ts:160`, `flightPathExport.ts:1005-1009`, `LandingMap.tsx:141`; normalizers `windSweep.ts:33`, `EnvironmentView.tsx:141`                                                         | The existing exports, plus `norm360(deg)` beside them                                                           |
| D72 | MED | FIXED 2026-10-05 | `withUnit` (`i18n/format.ts:50`)               | About 40 hand-joined `` `${u.fmt(q, v)} ${u.sym(q)}` `` across canvas, design, sim and tools; the CG/CP station label is also built 4 times                                                                                                                                                                                  | `FieldUnit.fmtWith(si, digits?)` in `prefs/useUnits.ts`, built on `withUnit`                                     |
| D73 | MED | FIXED 2026-10-05 | `LAUNCH_SI` (`prefs/launchUnits.ts`: "these fields convert here and nowhere else") | `WeatherDialog.tsx:178-179`, `WindProfileDialog.tsx:304-311`, `recoverySizing.ts:90-91`, `simulations.ts:384-395`; the -90 to 70 °C bounds as literals at `LaunchPanel.tsx:506-507` and `ParachuteTool.tsx:108-109`. Format boundaries (`exportSimulation.ts:125, :179`, `importLaunch.ts:158-183`) may keep their own | `LAUNCH_SI.degC`, `.hPa`, `.deg`; add `temperatureC` to `LAUNCH_SITE_LIMITS`                                     |
| D74 | MED | FIXED 2026-10-05 | `prefs/units.ts` conversions                   | `flightPathExport.ts:679-689` `UNIT_FACTOR`, `SiteMap.tsx:455-456`, `recoverySizing.ts:27` `FT_S`, `safetyLimits.ts:24` `MPH_TO_MS`. All agree today                                                                                                                                                                        | `siToUi` / `uiToSi`                                                                                              |
| D75 | MED | FIXED 2026-10-05 | `OpenMeteoCredit` (`tools/ToolGroup.tsx:14`), a license-required line | `WeatherDialog.tsx:343-361`, `WeatherSourceLine.tsx:88-101`                                                                                                                                                                                                                                                                 | Move to `components/common/` and use in all three                                                               |
| D76 | MED | FIXED 2026-10-05 | `DEFAULT_HEADING_DEG` (`flight/simulations.ts:18`, whose comment says it replaces the literal) | `LaunchPanel.tsx:300, :364, :663`, `WindProfileDialog.tsx:36, :199`, `ork/exportSimulation.ts:47, :69`                                                                                                                                                                                                   | Import the constant                                                                                             |
| D77 | LOW | PARTLY FIXED 2026-10-05 | Assorted existing helpers                       | `ladderDigits` (`FlightChartPanel.tsx:105-110`, `prefs/units.ts:320`); `clampEntry` (`repairValues.ts:50`); `findRecoveryDevices` (`FlightPath3D.tsx:51-70`); `LAYERS` (`FlightPath3D.tsx:77-81`); `hasCurve` (`MotorComparePane.tsx:27`); `CSV_MIME` (4 literals); `escapeXml` (`flightPathExport.ts:1481-1487`, adds `&apos;`); `UNKNOWN_PART_COLOR` (`threeMf.ts:52`, `meshExport.ts:28`); `G0` (`recoverySizing.ts:24`, `motorsSection.ts:55`, `exportSimulation.ts:58`); `M_TO_MM` (4 sites); `finiteNum` (`ork/importReaders.ts:80-83`, `importTags.ts`, `orkImport.ts:41`, `importLaunch.ts`); `numOpt` (`customParts.ts:43-46`); `uuid` (`customParts.ts:215`, `designLibrary.ts:93`, new ids only); `useMediaQuery` (`useHelpContents.ts:10`, `md`); `NumberInput` (`FlightPathExport.tsx:262-272`, `FlightCsvDialog.tsx:156-163`, where clearing the box writes the fallback mid-edit); `progressPercent` (`CatalogLoading.tsx:27`, `ComponentPicker.tsx:130`) | Per item                                                                                                        |

D72, done 2026-10-05: `fmtSym` on `Units` and `FieldUnit`, joining through `withUnit`; 39 hand joins replaced. A degree reading now closes up ("20°") where a few hand joins wrote "20 °".

Step 5 notes, 2026-10-05:

- **D77, in part.** Done: `ladderDigits` in the flight chart, `clampEntry` in `repairValues`, `hasCurve` in the compare pane, `CSV_MIME`, `UNKNOWN_PART_COLOR` in the mesh export, `G0`, `escapeXml` in the path export, `progressPercent`, and `findRecovery` (moved to `flightScene.ts` on `findRecoveryDevices`, which also fixed a keyless streamer drawn at 0.4 m against the kernel's 0.5 m). Left: `FlightPath3D`'s `LAYERS`, which its comment keeps on purpose and which would pull the ground-track component into the 3D chunk; `fmtSi`'s ladder in `prefs/units.ts`, since importing `i18n/format` there would pull i18n into the unit table everything imports; the `.ork` reader's `finiteNum` sites, `customParts`' reader, the hand-made ids, the `md` breakpoint, and the two integer inputs (those belong with D89).
- **D74.** The scale bar's promotion map now names only which unit promotes to which; the unit table does the arithmetic.
- **D79.** 31 simple forms replaced; the conversions wrapped around a function call stay inline, with the same arithmetic order, so `.ork` bytes did not change.

## HELPER

| ID  | Sev | Tag      | What                         | Sites                                                                                                         | Proposed home                                                         |
| --- | --- | -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| D78 | MED | FIXED 2026-10-05 | Unknown error to message     | About 30 `e instanceof Error ? e.message : String(e)` across store, engine, services and dialogs; two local named copies (`report/ExportDialog.tsx:40`, `engine/simWorker.ts:31`) | `errorMessage(e: unknown): string` in `services/app/errorMessage.ts` |
| D79 | MED | FIXED 2026-10-05 | Degree and radian conversion | About 65 inline `* Math.PI / 180` and `* 180 / Math.PI`; three private copies (`simulations.ts:256`, `descentDrift.ts:70`, `rktExport.ts:161`). Keep the operation order in the `.ork` writers so bytes do not change | `degToRad`, `radToDeg` in `prefs/units.ts`                            |
| D80 | MED | FIXED 2026-10-05 | Round to n places            | `weatherProposal.ts:168`, `scaleRocket.ts:169-172`, `motorName.ts:16`, `openMeteo.ts:199`, `loadOrk.ts:250`, `componentFit.ts:252`, `OffTheRail.tsx:110`, plus the file writers covered by D21. Also `isFiniteNumber` written four times (`designLibrary.ts:46`, `componentDb.ts:117`, `openMeteo.ts:293`, `flightPathExport.ts:741`) | `roundTo(x, dp)`, `isFiniteNumber(v)` in `services/app/numbers.ts`    |

## COMPONENT

| ID   | Sev | Tag      | Pattern                                                                                                                            | Sites                                                                                                                                                                                                                                                    | Proposed home                                                                                                          | Lines |
| ---- | --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----- |
| D81  | MED | FIXED 2026-10-05 | Map imagery stack: layer state, remember-and-reset pick, None/Satellite/Street buttons, tile `<img>` grid, attribution, offline note | `GroundTrack.tsx:53-65, :257-263, :282-346, :515-557`; `LandingMap.tsx:45, :85-134, :191-214` (imports LAYERS and styling from a canvas component); `FlightPath3D.tsx:77-138, :379-405`; `SiteMap.tsx:52-55, :105-109, :310-432`                          | `components/common/map/`: `useTileLayer`, `TileLayerButtons`, `TileImagery`, `MapCredit`, `mapStyle.ts`. Includes D19 | ~150  |
| D82  | MED | FIXED 2026-10-05 | North-up plan view: frame math, range rings, cardinal cross, N, pad, landing ring                                                | `GroundTrack.tsx:198-217, :433-510`; `LandingMap.tsx:49-83, :157-188` (ring r 4 vs 5)                                                                                                                                                                   | `PlanView({ size, extent, mapOn, children })` with an "under" slot for sweep regions                                   | ~70   |
| D83  | MED | FIXED 2026-10-05 | Measure a host element (ref plus ResizeObserver)                                                                                  | `GroundTrack.tsx:198-207`, `LandingMap.tsx:49-58`, `FlightChart.tsx:82-88`, `AeroCharts.tsx:89-96`, `SiteMap.tsx:111-120`, `TreeSchematic.tsx:261-271`. The `typeof ResizeObserver` guard is missing in three                                         | `useElementSize(ref)` in `components/common/`; callers keep their clamps                                               | ~35   |
| D84  | MED | FIXED 2026-10-05 | Labeled checkbox row                                                                                                              | `PathExportControls.tsx:17-40` (`Check`, the shared form already), `SettingsDialog.tsx:461-492` (`CheckRow`), plus about 20 hand-rolled in `report/ExportDialog.tsx`, `PrintExportDialog.tsx`, `FlightCsvDialog.tsx`, `WeatherDialog.tsx`, `WindProfileDialog.tsx`, `OverridesSection.tsx`, `DimensionFields.tsx`; disabled styling differs | `components/common/Check.tsx` with `hint` and `className`                                                              | ~60   |
| D85  | MED | FIXED 2026-10-05 | Dialog action buttons                                                                                                             | About 20 Cancel and primary buttons across 13 dialogs; the disabled primary looks different in nearly each, `report/ExportDialog.tsx` uses `rounded-md bg-sky-500`, and two dialogs use a lighter Cancel                                              | `DialogButton({ variant })` and `DialogActions` in `components/common/`                                                | ~60   |
| D86  | MED | FIXED 2026-10-05 | Async load with status and retry                                                                                                  | `ComponentPicker.tsx:96-127` and `sim/useCatalog.ts:18-61` (same attempt/landed machine), `MaterialPicker.tsx:118-136` (no retry for the same remoteData failure), `AboutDialog.tsx:26-38`, `ExamplesDialog.tsx:37-46`, `useHelpPage.ts:29-39`             | `useAsyncLoad(load, deps): { status, data, error, retry }` seeded from `useCatalog`                                    | ~60   |
| D87  | MED | FIXED 2026-10-05 | Master-detail library dialog                                                                                                      | `SavedPartsDialog.tsx` and `LocationsDialog.tsx` (dirty flag, guarded select, phone one-pane switch, selected-row classes); editor footers `SavedPartEditor.tsx:170-192`, `LocationEditor.tsx:242-280`; meta fields `SavePartButton.tsx:63-105`, `SavedPartEditor.tsx:94-151` | `useGuardedSelection(message)`, `MasterDetail`, `EditorFooter` in `components/common/`; `PartMetaFields` in `design/` | ~120  |
| D88  | MED | FIXED 2026-10-05 | Segmented single-choice toggle                                                                                                    | `AeroInputs.tsx:72-103` (`Seg`), `ViewToggle.tsx:27-44`, `AeroComponentTables.tsx:48-61`, `ConfigsPane.tsx:112-129` (`aria-current`), `MotorDashboard.tsx:236` (local `ToolBtn` that shadows the common one), `MotorFilterBar.tsx:142`, `MotorDialog.tsx:472-473`, and the four map layer button groups | `Segmented<T>` / `ToggleButton` in `components/common/`                                                                | ~40   |
| D89  | MED | FIXED 2026-10-05 | Labeled number row with optional hint                                                                                             | `LaunchPanel.tsx:37-92` (`Num`), `SimEditor.tsx:405-450` (`Override`), `SettingsDialog.tsx:535-560` (`NumField`), `AeroInputs.tsx:41-70` (own draft buffer), the override rows in D93                                                                 | `NumberRow` in `components/common/`; add `commit="blur"` to `NumberInput` for NumField and AeroInputs                  | ~85   |
| D90  | MED | FIXED 2026-10-05 | Min and max filter bounds in a user unit                                                                                          | `ComponentPicker.tsx:465-466, :536-556`, `MotorFilterBar.tsx:267-305`. Raw controlled inputs re-derived per keystroke, the round trip NumberInput removes                                                                                               | `UnitRangeInputs({ quantity, value, onChange })` on NumberInput                                                        | ~35   |
| D91  | MED | FIXED 2026-10-05 | Launch site fields and forecast date/hour                                                                                         | `tools/SiteFields.tsx:57-127` vs `LaunchPanel.tsx:373-474` (lat/lon step 1, while `LocationEditor.tsx:185` uses 0.0001); `SiteFields.tsx:130-160` `WhenFields` vs `WeatherDialog.tsx:250-273`                                                      | One `SiteFields` with `mixed` / `req` / `onCommit`; `WhenFields` with a layout prop                                    | ~65   |
| D92  | MED | FIXED 2026-10-05 | Abortable latest-wins request plus date defaults                                                                                  | `WeatherDialog.tsx:76-122`, `LandingEstimator.tsx:84-143`, `OffTheRail.tsx:83-122`, `EnvironmentLanding.tsx:45-69`; `nextHour` / `today` redeclared in three                                                                                          | `claimSignal()` on `useLatest`; `todayYmd()`, `nextHourMs()` in `openMeteo.ts`. Pairs with D27                         | ~30   |
| D93  | MED | FIXED 2026-10-05 | Configuration override card                                                                                                       | `DeploymentSection.tsx:40-110`, `SeparationSection.tsx:62-146`. See D37 for the label drift                                                                                                                                                         | `OverrideCard`, `OverrideSelect`, `OverrideNumber` in `components/config/`                                             | ~50   |
| D94  | MED | FIXED 2026-10-05 | Tool form state kept for the page's life                                                                                          | `LandingEstimator.tsx:35-83`, `OffTheRail.tsx:36-82`, `ParachuteTool.tsx:16-40`; default site at `LandingEstimator.tsx:61-65` and `OffTheRail.tsx:67-71`                                                                                            | `useRememberedForm(slot, init)` and `defaultToolSite(settings)` in `components/tools/`                                 | ~40   |
| D95  | MED | FIXED 2026-10-05 | Hidden file input with trigger and value reset                                                                                    | `AppHeader.tsx:122-140`, `FreeformFinActions.tsx:79-105`, `MotorDialog.tsx:324`, `WindProfileDialog.tsx:372-386`, `ExportFormatPicker.tsx:58-61`                                                                                                     | `useFilePick(accept, onFile)` in `components/common/`; pairs with D26                                                  | ~25   |
| D96  | MED | FIXED 2026-10-05 | Property-panel section block                                                                                                      | `AppearanceSection.tsx:41-42`, `PlacementSection.tsx:49-50`, `OverridesSection.tsx:112-117` (whose comment records a past heading drift), `PropertyPanel.tsx:166-167`, `StageRecovery.tsx:42-43` (`space-y-2`), `DimensionFields.tsx:124-125`, `EnvironmentLanding.tsx:113` | `PanelSection({ title })` in `design/`                                                                                 | ~12   |
| D97  | MED | FIXED 2026-10-05 | Error boundary outside Suspense around a lazy view, and named lazy import                                                       | `CenterCanvas.tsx:20-21, :128-160`, `PropertyPanel.tsx:9, :13, :206-223`, `HeaderDialogs.tsx:15, :96-102`; the ordering rule is restated in a comment at each                                                                                        | `LazyBoundary`, `lazyNamed(loader, key)` in `common/ErrorBoundary.tsx`                                                 | ~12   |
| D98  | LOW | FIXED 2026-10-05 | Chart pieces                                                                                                                      | Categorical palette `AeroAnalysis.tsx:42` / `motorSeries.ts:9`; legend swatch and peak label `MotorDetail.tsx:153, :193`, `MotorCombinePane.tsx:52-86`, `MotorComparePane.tsx:191-218`; altitude-profile frame `EnvironmentView.tsx:174-269` / `WindProfileDialog.tsx:48-116`; heat ramp `AeroComponentTables.tsx:37-41, :416-420`; 3D callout `StabilityCallout.tsx:74-97` / `rocketCallouts.tsx:150-171` | `chartPalette.ts`, `Legend` and `SeriesPath` in `chartAxes.tsx`, `AxisCallout` with a `place` prop                    | ~70   |
| D99  | LOW | FIXED 2026-10-05 | Term/value rows and titled cards                                                                                                  | Two private `Stat` dt/dd rows (`LandingEstimator.tsx:314`, `OffTheRail.tsx:315`) plus `EnvironmentView.tsx:69-90`, `EnvironmentLanding.tsx:119-125`, `SimEditor.tsx:232-240`, `MotorDetail.tsx:131-140`; `LaunchPanel.tsx:201` `Group` is byte-identical to `ToolGroup` | `TermRow` and `CardGroup` in `components/common/`                                                                      | ~35   |
| D100 | LOW | FIXED 2026-10-05 | Menus and dropdowns                                                                                                               | `MotorGrid.tsx:17-42` / `MotorFilterBar.tsx:176-229` checkbox dropdowns; 16 menu items in `FileMenu.tsx:138-309`; zoom step and ceiling `TreeSchematic.tsx:284`, `AftView.tsx:291`, `SchematicControls.tsx:125-147` (hard-coded 12)                   | `CheckMenu`; local `MenuItem`; `zoomStep(z, px, py, f, max)`                                                           | ~60   |
| D101 | LOW | FIXED 2026-10-05 | Layout plumbing                                                                                                                   | `App.tsx:193-283` right column splitter blocks; `PropertyPane.tsx:13-25` / `ComponentDialog.tsx:46-59` (11 props passed one by one); `TabBar.tsx:32-49` / `WorkbenchTabs.tsx:32-41`; `FlightPath3D.tsx:151-157` / `Rocket3D.tsx:71-86` pieces and dispose | Local `RightColumn`; `{...sel}`; a tab table in `state/tabs.ts`; `usePieces(tree, motors)`                             | ~60   |

---

## Rejected

Raised by agents and dropped under the prompt's "does not count" rules:

- **Mirrored or per-format code.** The horizontal and vertical calipers; the `.ork` and `.rkt` per-type readers and writers; RASAero and RockSim unit constants (format spec values, not display conversion); the `.ork` writer's full-precision numbers; `importLaunch` / `exportSimulation` read and write mirrors.
- **Different questions.** `finPlanform.symmetricRadius` vs `tubeRadii` vs the tube-fin body radius; `atmosphereLevels` vs `windLevels` filters; Web Mercator's sphere vs the geodesy drift (D16); `rangeRings` vs `niceStep`; `useChartCrosshair` vs the aero chart's Mach-snapping crosshair; `FlightChart` clip time vs the 3D deploy time; `EnvironmentView.sig4` vs `designInfo.sig4`; `uniqueSimName` vs `uniqueName`.
- **Costs more than it saves.** Schematic `<rect>` shape factory; StabilityBadge tile wrapper; OverridesSection rows; `derivedFields` streamer setters; a generic `clamp()`; `boolOr` in settings; `EngineNotice` vs `CatalogLoading` progress text.
- **Estimates labeled as estimates.** `recoverySizing.airDensity`, `descentDrift`, `railExit`: Tools-tab estimates that defer to kernel figures after a run.
- **Tailwind class strings alone** (card and input classes), as CSS is out of scope. Where the classes are a symptom of a missing component (D85, D99) the component is reported.
- Single-field zustand selectors; one-shot `matchMedia` at the moment of action; boot-time localStorage reads in `openRocketEngine.ts` and `i18n/index.ts` (keys already built with `nsKey`); same-origin static fetches without a timeout.

---

## Recommended order of attack

1. **One-line DRIFT fixes, no design decisions. DONE 2026-10-05.** D1, D7, D8, D22, D23, D2, D6, D28, D45, D29. D31 was not reachable.
2. **Kernel-reference geometry. DONE 2026-10-05.** D5, D3, D4, D67, D30 (first vs widest mount left as two questions).
3. **One rule for each user-visible label or number. DONE 2026-10-05.** D9, D10, D13, D14, D15, D24, D17, D20, D32, D72, D25. No e2e assertion depended on the changed text.
4. **File output. DONE 2026-10-05.** D21, D11, D12, D36, D35, D42, D57. Goldens updated: the PDF (D11, two inertia rows) and the `.ork` (D42, `0` to `0.0`).
5. **Small shared helpers. DONE 2026-10-05.** D78, D79, D80, D26, D27, D18, D16, D41, D49, D73 to D76; D77 in part. Full e2e run green (218).
6. **Service consolidations. DONE 2026-10-05.** D51 (`JsonListStore`), D50 (`tree/treeWalk.ts`; the post-order flag is load-bearing for autoShoulder), D52 to D60, D40 (`commitTree`).

   Notes on step 6:

   - D50: `walkNodes`, `findNode`, `findWithParent`, `findSiblings` and `mapTreePreserving` (pre or post order, unchanged subtrees keep their identity) in `tree/treeWalk.ts`, used across `treeEdit`, the auto-shoulder, auto-radius and repair passes, the report, the RASAero writers and the import notes. Left as they are: `updateNode` (path copy, first match), `replaceInPlace` (one node to several), the RASAero surface finish lookup (an empty finish is a miss only when nested), `scaleTree` (always copies) and the walks that thread state.
   - D51: `parseJsonList` and `JsonListStore` in `services/storage/jsonListStore.ts` behind the template, preset, material, launch location and custom motor stores; the design library uses the parser. Keys and on-disk format are unchanged. A store that cannot be read now lists as empty in all five, as the preset and motor stores already did; writes still reject. The material identity (name plus type), the location limits check and the motor batch order stay with their stores.
   - D52: `flightBranches(result, fallbackName)` in `flightColumns.ts`, at all seven sites.
   - D53: `trapezoidImpulse` and `cumulativeImpulse` in `motorMath.ts`. Each site keeps its own divisor; `railExit` divides by `t[last] - t[0]`, which equals `t[last]` because every curve the app builds starts at 0.
   - D54: two helpers, since the sites asked two questions. `chainOuterRadius` reads the key each type is sized by (assembly bounds, scaling); `anyOuterRadius` takes the largest radius key whatever the type (the schematic and the aft view). The disc geometry's tube radii are a different computation and stay.
   - D55: `workspaceSnapshot` exported from the store, used by autosave, the unload flush and the design library.
   - D56: `withKey` and `nonEmpty` in the store for the deployment, separation, simulation preference and run-state maps.
   - D58: `axialChain` in `tree/position.ts`. The disc geometry and file-position walks go stage by stage and stay.
   - D59: `motorSeatStart` in `tree/position.ts`, checked against the kernel's `InnerTube.getMotorPosition` and `BodyTube.getMotorPosition` (`length - motor length + overhang`, from the mount's front).
   - D60: `KERNEL_DEPLOYMENT` and `KERNEL_SEPARATION` in `tree/kernelDefaults.ts` (OpenRocket's `DeploymentConfiguration` and `StageSeparationConfiguration` initializers: ejection, 200 m, 0 s), with `designDeployment`, `designSeparation`, `effectiveDeployment` and `effectiveSeparation` in `flightConfigs.ts`. This fixed a drift: the bridge sets only the keys a node carries, so a recovery device with no event deploys on the ejection charge at 200 m, but the configuration card, the configuration table and the property panel showed "Apogee" and an altitude of 0. They now show the kernel's values; the `.ork` reader and writer use the same constants.

7. **Component extractions, largest last. DONE 2026-10-05.** Small first: D84 (`Check`), D83 (`useElementSize`), D96, D97, D95, D38 (`SortHeader`), D33 (`ColorField`), D75. Then D85, D88, D89, D90, D86, D92, D94, D93, D91, D39 (`useMenuPopover`). Last: D81 and D82 (the map stack, which includes D19 and needs a screenshot pass across four views), and D87 (master-detail).

   Notes on step 7:

   - New shared pieces in `components/common/`: `Check`, `useElementResize`, `LazyBoundary` and `lazyNamed` (in `ErrorBoundary.tsx`), `useFilePick`, `SortHeader`, `ColorInput`, `DialogButton`, `ToggleButton`, `Segmented`, `NumberRow`, `UnitBound`, `useAsyncLoad`, `useMenuPopover`, `MasterDetail.tsx` (`useGuardedSelection`, `MasterDetail`, `MasterRow`, `MasterStatus`, `EditorFooter`), and the map stack in `common/map/` (`mapStyle.ts`, `useTileVerdict`, `useGroundLayer`, `TileLayerButtons`, `TileImg`, `MapCredit`, `PlanView`). `NumberInput` gained `commitOnBlur`; `useLatest` gained `claimSignal`.
   - Elsewhere: `PropSection` (design), `PartMetaFields` (design), `OverrideFields.tsx` (config), `LatLonRows` and `WhenFields` (sim), `remembered.ts` (tools: `rememberedSlot`, `useRemembered`, `defaultToolSite`), and `todayYmd` / `nextHourMs` in `openMeteo.ts`.
   - D86: `useHelpPage` keeps its own loader: a missing page is an answer (null), not a failure to retry, and the contents list carries over from one page to the next. The material picker now reports a failed catalog load the same way the component picker does.
   - D91: the launch panel and the tools share the latitude and longitude rows; the launch panel's altitude field, geolocation and required markers stay where they are. The audit's step-size note (1 against the location editor's 0.0001) is left as it was.
   - D82: the landing ring keeps its own radius per view (4 on Ground Track, 5 on the landing estimate); the frame, rings, cross, N and pad are shared.
8. **LOW rows. DONE 2026-10-05.** D61 to D66, D98 to D101.

   Notes on step 8:

   - D61: `edgeKey` and `undirectedEdgeCounts` exported from `meshValidate.ts`; a private `weldSolid` in `solidMesh.ts`. `validateSolid` keeps its own loop, since it also counts directed edges and skips triangles with a repeated corner.
   - D62: private `readTubeWall` / `readRadialAngle` in `rktImport.ts` and `writeTubeWall` / `writeRadialAngle` in `rktExport.ts`. The ring readers and writers keep their own wall handling, which depends on the ring type.
   - D63: `countComponent` and `checkDepth` in `ork/importLimits.ts`, and the ignored-components note as `ignoredNotes` in `ork/importNotes.ts`, for both formats.
   - D64: `SPEED_WARNINGS` (`components/sim/speedWarnings.ts`) drives the four speed rows in the simulation editor and in Settings; `SEPARATION_FIELDS` and `DEPLOY_FIELDS` in `componentFields.ts`; local row helpers in `DriftSweepPanel.tsx` and `DimensionFields.tsx`.
   - D65: `createRequestStore` (`state/requestStore.ts`) behind the confirm and prompt stores; `defaultCsvFormat`, `withoutResults`, the `warnStorageFull` store action, one `BackendPref` type, a private `demote` in the IndexedDB store, `presetLink`, `stageNodes` at the inline sites, `isRecoveryDevice` at the five deployable checks, the shared `solidFor`, a PDF `paragraph` helper, and `selectDriftSweepFor`. ResultPicker reads the shown flight through `resultFlight`.
   - D66: one helper per pair (`pageTitle`, `humidityFraction`, `sameMaker`, `partsInZone`, `diffKeys`, `HOUR_OFFSETS` and `sampleAtUnix` in `openMeteo.ts`, `seriesAt`, `parseXmlText`, `retuneStdDev`). The trailing-slash rule is shared inside `appInfo.ts` only: `remoteData.ts` is reached from the simulation worker, which must not import i18n. Sharing the XML parse showed that a `.rkt` file whose XML did not parse was reported as "Not a valid .ork file"; it now names `.rkt`, with a test.
   - D98: `chartPalette.ts` (common), `LegendSwatch`, `SeriesPath` and `peakOf` in `chartAxes.tsx`, a local `HeatRamp`, and one `AxisCallout` with a placement for the stability callout. The altitude-profile frames in `EnvironmentView.tsx` and `WindProfileDialog.tsx` were left apart: they share two axis lines and differ in size, labels, scales and roles.
   - D99: `CardGroup` and `TermRow` in `components/common/`; `tools/ToolGroup.tsx` is gone. OffTheRail's value row, the simulation editor's two rows and MotorDetail's spec items keep their own markup, which differs.
   - D100: `CheckMenu` for the two checkbox dropdowns, a local `MenuItem` in `FileMenu.tsx`, and `zoomStep` with `MAX_ZOOM` in `schematicGeometry.ts`.
   - D101: a local `RightColumn` in `App.tsx`, `<PropertyPanel {...sel} />`, `taskTabs` in `components/layout/tabTable.ts` for the tab bars, and `usePieces` for the two 3D views.

## Rows outside the plan

Done 2026-10-05, after step 8: D34, D43, D44, D46, D47, D48 (above), and D68 to D71:

- D68: `ringInstanceOffsets` gives the even fin and tube-fin angles in the 2D, aft and 3D views.
- D69: the `tree/` type predicates at every listed site; `rasaero/booster.ts`'s body-or-transition check stays, since it leaves out the nose cone.
- D70: `useLatest` in the motor dialog (`pickGen` is gone), the saved parts and location lists, the material picker and the rocket export.
- D71: `distanceFromPad`, `bearingFromPad` and a new `norm360` at every listed site.

Every row in this report is now FIXED, except D31, which was not reachable.

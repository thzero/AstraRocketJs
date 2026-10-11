# AUDIT - `web/` engineering audit

<!-- cspell:ignore conv jspdf SEMROC lanzamiento giantleaprocketry botón Botón salida Salida piloto Anulaciones Trayectoria Ruta riel raíl rampa varilla guía Sostenedor Sustentador Cápsula despliegado desplegado necessáriamente necessariamente Envolvente Elipse deriva serpentina Cinta encaje Hombro calaje calado PaperProducts Kal FFFE FFFF NB80 Flis -->

Date: 2026-10-11 (second run of the day). Branch `dev` at 5ba5235 plus the
working tree edits to `docs/AUDIT_PROMPT.md`, `docs/DEVELOPER.md`,
`docs/DEPENDENCIES.md`, `CHANGELOG.md` and `.github/workflows/gates.yml`. Run
per `docs/AUDIT_PROMPT.md` with parallel review agents: slice 1 split into 1a
(importers), 1b (exports and report) and 1c (storage, motors, materials, app
services), with the `.ork`, `.rkt` and `.CDX1` writers given their own agent;
slice 2; slice 3 split into 3a (canvas), 3b (sim, tools and report
components) and 3c (design, config, common and layout components); slices 4,
4b, 5 and 6; and a conventions sweep in three parts (repo docs, the 19 user
docs pages with their Spanish twins, and code conventions).

Scope: the `web/` package, its scripts and workflows, and the docs that
describe them. `web/src/engine/vendor/` is generated TeaVM output and was not
audited. `engine-java/` has its own prompt and report.

The previous report (2026-10-11, first run) is closed and lives in git
history. Each agent rechecked its fixes in its slice. They hold, with these
exceptions:

- **R1 and R2 are still open** (R1 and R2 here): the published catalogs have
  no digests, and master's workflow still pins the other database copy.
- **K2 is not complete** (T1, T3): the widened em dash scan walks `.vscode`,
  which a CI checkout does not have, and still misses two sites under
  `engine-java/extract`.
- **C12 and C13 have residues** (C16, C33, C34): "Use my location", the map
  pick, the Parachute tool and the landing estimate still keep or mint an
  elevation.
- **C39 has a residue** (C30): the velocity over altitude panel.
- **C44 holds as written, but the group it carries is wrong** (C13): the
  display group goes into the file where desktop wants the database string.
- **K11 and K14 have sibling sites** (C42): the ThrustCurve fetch errors and
  three more literal list joins.
- **K8, K22 and K39 are partial** (U4): marketing phrasing, history in the
  docs site config, and generic launcher wording in the docs.
- **D4 is partial** (U1): two tree comments still describe stage children the
  kernel refuses.

**Status.** 72 findings after merging duplicates: 7 HIGH, 29 MED, 36 LOW,
plus the upkeep section. Two of the HIGH findings stop work outside the app
today: the em dash test fails to load on every CI run (T1), and the published
catalogs carry no digests with the next scheduled refresh at 2026-10-12 06:00
UTC (R1). Five HIGH findings are files desktop OpenRocket reads differently:
one `.rkt` import (C1) and four `.rkt` export defects (C2 to C5). One finding
is a MED security issue (S1).

## How to read the verification tags

- **CONFIRMED BY REVIEWER** means that after the slice agent raised it, the
  cited lines (and the Java, or the published data, where relevant) were
  re-read and the claim confirmed independently for this report. Every HIGH
  finding and the MED security finding carry this tag.
- **VERIFIED** means the slice agent read the lines and confirmed the claim
  with a failure scenario, against the Java under `engine-java/src/java` or
  the desktop handlers under `engine-java/.openrocket-src` for anything ported
  or written for the desktop to read. Some were also run (noted).
- **REPORTED** means the agent raised it as plausible without fully confirming
  it. Treat these as leads.
- The tag in brackets, such as `[1c]`, names the slice that raised it; `w`
  marks the file writer agent and `conv` the conventions sweep. Line numbers
  are as of 5ba5235 with the working tree.

## Gate picture, measured

Run locally from `web/` on Node 24 on 2026-10-11: `npm run gates` passes
(format check, spell, typecheck, lint with zero warnings, knip clean, `dupes`
with 461 files and 0 clones, and the production build). `npm run
test:coverage` was run twice. The first run, on a machine loaded by the review
agents, had one failure: `tests/components/report/ExportDialog.test.tsx`
"writes the PDF once the simulation has landed" timed out at 5 s. It passes
alone in about 2 s, with and without coverage. The test mocks `reportPdf` but
the dialog still imports the real `jspdf` (`ExportDialog.tsx:224`), so under
load the import alone can pass the default timeout. The second run, on a quiet
machine: 5,618 tests in 459 files, 0 failed. Coverage: statements 88.06%,
branches 80.91%, functions 84.00%, lines 89.60% (floors 81, 74, 76 and 82).
Every finding below passes these gates, so each fix needs a test that fails
without it.

The e2e suites, parity, validation, the reproducible extract check and the
update-flow job were not run. Locally the em dash test passes because this
checkout has a `.vscode` folder; in CI it cannot load (T1).

## The HIGH findings, in short

- **T1.** `web/tests/noEmDash.test.ts` walks `.vscode`, which is gitignored,
  so the test file throws while loading in CI. `verify:ci` fails on every pull
  request, every push to dev, and the master deploy.
- **R1.** The `data` branch the live app reads first still has 3,446 parts and
  1,156 motors with 0 digests. The schedule runs master's workflow next on
  2026-10-12 06:00 UTC.
- **C1.** A RockSim freeform fin imports backward: the point list is read in
  file order, where desktop reverses a list that ends at (0,0).
- **C2 to C5.** The `.rkt` writer gives desktop a shock cord with no mass, an
  airfoil fin set with a 0 g override, a relative pod sunk into the body, and
  a tail cone drawn as a nose cone.

## 🔴 Security

### Medium

- **S1** (MED, CONFIRMED BY REVIEWER for the code; the allocation figures are the agent's node run) [1a] `web/src/services/files/ork/importUnpack.ts:39-46, 262-277`. The zip guard adds up each central directory entry's declared `originalSize` and rejects past `MAX_ARCHIVE_ENTRY_BYTES` and `MAX_ARCHIVE_TOTAL_BYTES`. For a stored member (method 0) fflate allocates by the compressed `size`, which the filter never reads, and many central entries can point at one local member. *Why it matters:* A 1 MB `.ork` with 200 central entries over one 1 MiB stored member declares 200 bytes and allocates 209,715,200; at the 64 MiB input cap and 256 entries that is about 16 GiB, so a shared file crashes the tab the guard exists to protect. The comment at :262-265 says the opposite. *Fix:* Count `Math.max(file.size, file.originalSize)` against both caps, fix the comment, and add the aliased-entries case to `orkImportHostile.test.ts`.

### Low

- **S2** (LOW, VERIFIED) [1b] `web/src/services/exports/flightPathExport.ts:1528-1530` (`escaperFor`, default branch) with `web/src/services/exports/templateStore.ts:30-38`. A user template named `*.tsv.mustache` gets the extension `tsv`, which has no case in `escaperFor`, so values pass with only control characters stripped. *Why it matters:* A shared design named `=HYPERLINK(...)` writes a live formula into a TSV that Excel opens directly. It needs the user's own TSV template, hence LOW. *Fix:* Route `tsv` through `neutralizeFormula`; add a case to the escaper test.

## 🟡 Correctness

### High

- **C1** (HIGH, CONFIRMED BY REVIEWER) [1a] `web/src/services/files/rktImport.ts:529-550` (`readPointList`), called at :470. The RockSim `PointList` is read in file order. RockSim stores a custom fin from the trailing root point back to (0,0), and desktop's `FinSetHandler.toCoordinates` (`.openrocket-src/.../rocksim/importt/FinSetHandler.java:405-425`) drops repeated (0,0) pairs and reverses a list whose last point is (0,0). Nothing in `rktImport.ts` reverses. *Why it matters:* The agent ran `importRkt` on `50,0|20,40|0,0|` and built it in the kernel: length -0.05 m, CG -0.027 m. Every freeform fin from a RockSim file, or from a `.rkt` desktop exported, flies backward with no note; CP, mass and the drawing are all wrong. `rktDesktopParity.test.ts:498` uses forward order only. *Fix:* Port `toCoordinates`; test a RockSim-ordered and a desktop-exported list.
- **C2** (HIGH, CONFIRMED BY REVIEWER) [w] `web/src/services/files/rktExport.ts:368-383` (`writeMassObject`) with `writeCommon` :140-143. A shock cord's material is `lineMaterialName` and `lineDensity`; `writeCommon` reads only `materialName`/`surfaceMaterialName` and `density`/`surfaceDensity`, so the cord goes out with no `Material` and no `Density`. Desktop's `MassObjectHandler.mapMassObjectAsShockCord` (:164-190) applies `KnownMass` only through `UseKnownCG`, which is written only on an override, and builds the cord's line material from the empty name and 0 density. *Why it matters:* Every exported shock cord opens in desktop OpenRocket with zero mass. `rktExport.test.ts:258` checks only the app's own round trip. *Fix:* Write `UseKnownCG` 1 with `KnownMass` and `KnownCG` for every mass object, as desktop's `MassObjectDTO` does, or write the line material, its density and the line density type.
- **C3** (HIGH, CONFIRMED BY REVIEWER) [w] `web/src/services/files/rktExport.ts:326`; no `CalcMass` or `CalcCG` is written anywhere. `FinSetHandler.endHandler` (:299-309) overrides an airfoil fin set that has no override with `calcMass` and `calcCg`, which stay 0 when the file has neither element. Desktop's `BasePartDTO` always writes both. *Why it matters:* Every airfoil fin set imports into desktop with a 0 g mass override and CG 0. *Fix:* Write `CalcMass` (g) and `CalcCG` (mm) from the kernel's `componentMasses()`, at least for fin sets.
- **C4** (HIGH, CONFIRMED BY REVIEWER) [w] `web/src/services/files/rktExport.ts:387` (`writePod`). `RadialLoc` is `radiusOffset` as stored, whatever `radiusMethod` says. `PodHandler` (:38-39, 65-66) reads it as `RadiusMethod.FREE`, a distance from the parent's centerline, and `PodSetDTO` (:105-107) writes `radiusMethod.getRadius(...)`. *Why it matters:* A pod on the desktop default 'relative' method, which `.ork` files carry, opens in desktop sunk into the body by the parent's radius. *Fix:* Resolve to the centerline distance first (`tree/assembly.resolveAssemblyRadius`).
- **C5** (HIGH, CONFIRMED BY REVIEWER) [w] `web/src/services/files/rktExport.ts:207-215, 395`. A flipped nose cone is written as a `<NoseCone>` with `BaseDia` set. Desktop's `StageDTO` (:112) and `PodSetDTO` (:118) write a flipped cone as a transition. *Why it matters:* Desktop and RockSim open a tail cone as a nose cone pointing forward at the tail. *Fix:* When `flipped`, write a `<Transition>` with `FrontDia` the base and `RearDia` 0, as desktop does.

### Medium

- **C6** (MED, CONFIRMED BY REVIEWER) [1c] `web/src/services/motors/exportMotors.ts:82-106` (`fillMotorDigests`) with `web/src/services/motors/motorDb.ts:194-204` (`loadCatalog`). The digest lookup runs over `loadCatalog()`, which puts the user's imported motors first. An imported motor matches its own custom row, the diameter agrees, the row has no digest, and because the match counts as "same" nothing is embedded. An imported "Estes C6" wins over the catalog row the same way. *Why it matters:* A design flying an imported motor saves an `.ork` with no digest and no `thrustcurves/*.rse` member, and desktop reports the motor missing. `motorDigests.test.ts` mocks `loadCatalog` with the bundled rows only. *Fix:* Match against bundled rows only and treat a custom hit as not in the catalog; test with a custom row present.
- **C7** (MED, CONFIRMED BY REVIEWER for the missing results read; VERIFIED for the conflict check) [2] `web/src/state/fileSlice.ts:359, 383-385` (`openDesign`) with `web/src/services/storage/workspaceStore.ts:410-412, 531-539` and `web/src/services/storage/designLibrary.ts:246, 347-351`. File > Open hydrates `lib.read(id)` without `withResults`, which the boot path applies (`readActive`, workspaceStore.ts:384). `setActiveId` then clears the tracked results and sets `lastSeenAt` to null. *Why it matters:* Opening a design that has flown shows every row as not run, and the first edit's autosave writes an empty results map over the stored flights. The null stamp also skips the two-tab conflict check, so tab 1 can overwrite tab 2's save of the same design. *Fix:* Open through the same read as `readActive` (stamp, blob, `withResults`, `lastSeenAt`, tracked results), and add a store test that opens a flown design, edits it, and finds its results.
- **C8** (MED, CONFIRMED BY REVIEWER) [3a] `web/src/components/canvas/schematicShapes.tsx:580-615, 616-790`; `web/src/components/canvas/rocketPieces.ts:307-342, 395-413`; `web/src/components/canvas/AftView.tsx:241-268, 297-316`. Centering rings, bulkheads, launch lugs and rail buttons offer Instance count and Instance separation (`componentFields.ts` `LINE_INSTANCES`, used at :564, 570, 584, 596), and the bridge flies every copy (`ComponentFactory.java:718-731`). In `canvas/` only pods read `instanceCount`. *Why it matters:* Two rail buttons at 0.5 m, which desktop files carry, draw as one; raising a lug's count changes mass and CG and nothing on screen, so the control looks inert. Desktop draws every instance. *Fix:* Expand each line-instanced child into its copies in `schematicShapes.renderChildren` and `rocketPieces.addChildren`; add a case to `geometryFlags` or a canvas test.
- **C9** (MED, VERIFIED) [4] `web/src/tree/cluster.ts:146-151`, read at `AftView.tsx:271`, `rocketPieces.ts:350`, `schematicShapes.tsx:654`. Radial distance and Radial direction are offered on inner tubes, couplers, rings, bulkheads, engine blocks and mass and recovery parts (`componentFields.ts:226-229`), and the bridge flies both (`ComponentFactory.java:408-409, 740-745`). No drawing reads `radialPosition`; the views use `clusterOffsets`, which by its own comment leaves out `InnerTube.getClusterPoints`'s radial shift and the `clusterRotation - radialDirection` turn. *Why it matters:* A 29 mm mount set 15 mm off axis is drawn centered in 2D, 3D and the aft view while it flies off axis. *Fix:* Place clustered tubes with `clusterPoints` (already a port of `getClusterPoints`) and apply the radial fields to the other radially placed parts.
- **C10** (MED, CONFIRMED BY REVIEWER; the agents ran the vendored engine) [3c] [1a] `web/src/components/design/DimensionFields.tsx:446-448`; `engine-java/src/api/java/api/ComponentFactory.java:97-103, 529`; `web/src/services/files/ork/importReaders.ts:389`; `web/src/services/files/rktImport.ts:636`. The panel lets the shroud line count reach 0, citing `Parachute.setLineCount` and the desktop spinner, and `PropertyPanel.lineCount.test.tsx` pins it. The bridge's `count()` refuses anything below 1, so the build throws. Both importers turn a file's 0 into 1, while desktop's `.ork` and RockSim loaders keep 0. *Why it matters:* Typing 0 breaks the whole design (no stats, no run) and autosaves the value. A desktop file with 0 lines gains a line's mass and saves back with 1. *Fix:* See Decisions: either let the bridge accept 0 for this field and clamp the importers to 0, or floor the panel at 1; make the test pin the chosen rule.
- **C11** (MED, CONFIRMED BY REVIEWER) [4b] `web/src/services/design/treeEdit.ts:816-842` (`defaultNode`). A new streamer gets `cd: 0.6` and no `cdAuto`; the bridge sets that as a manual Cd (`ComponentFactory.java:555-559`). The kernel's `Streamer` starts automatic (`RecoveryDevice.java:27`) and computes about 0.10 for the default 0.4 m ripstop strip (`Streamer.java:140-146`). A new parachute gets a manual `cd: 0.8` (the kernel default value, but manual) and a manual `lineLength: 0.3` where `Parachute` starts automatic at 1.5 times the diameter (0.45 m). *Why it matters:* A new streamer flies about 5.8 times desktop's Cd and descends about 2.4 times slower, and the `.ork` writes `<cd>0.6</cd>` where desktop writes `auto`. *Fix:* Seed `cdAuto: true` on both and `lineLengthAuto: true` on the parachute; add a kernel test against `Streamer.getComponentCD`. See C12.
- **C12** (MED, VERIFIED) [3c] `web/src/components/design/DimensionFields.tsx:26, 464-476`. With Cd on Auto the disabled box shows the stored `cd`, not the value the kernel flies: `KERNEL_AUTO_KEYS` covers cord and line length only, and `componentInfo` reports no drag coefficient. A streamer shows 0.6 while flying about 0.10; a catalog streamer or a `<cd>auto</cd>` import shows 0. Clearing the Auto box writes the stale value, or no value, which leaves the kernel on auto while the box reads off. *Why it matters:* The panel shows a drag coefficient that is never flown, and turning Auto off changes the flight. Desktop keeps the computed Cd on untick, and the comment at :360 claims the same. *Fix:* Have `componentInfo` report `getCD()` for recovery devices, add `cd` to `KERNEL_AUTO_KEYS`, and write the kernel's value when Auto is cleared, as line length does.
- **C13** (MED, VERIFIED; the agent opened the files in desktop 24.12 with `npm run check:ork`) [3c] `web/src/components/design/MaterialSection.tsx:27-35`, `PropertyPanel.tsx:279-289`, `MaterialPicker.tsx:168`, with `web/scripts/sync-materials.mjs:69-80`, `web/src/services/design/filletDefault.ts:12`, `web/src/services/files/ork/exportParts.ts:44, 252`. The picker's group goes into `materialGroup` and `filletMaterialGroup`, and that group is the catalog's display name: "Paper" where the database string is "PaperProducts", and "Adhesives", which only this app has and which every new fillet gets. *Why it matters:* Desktop raises "Illegal material group specified, ignoring." on every design with an app-made fillet or a panel-picked paper material. `orkDesktopSamples.test.ts` has neither case. *Fix:* Map the display group to the database string at the write, write a valid group (or none) for adhesives, and add both cases to the desktop samples. See Decisions.
- **C14** (MED, VERIFIED) [4b] `web/src/services/design/treeEdit.ts:554-563` (`statedPatch`). `...(p.innerDiameter ? { thickness } : {})` treats a stated inner diameter of 0 as not stated. `ThicknessRingComponent.loadFromPreset` (:22-33) makes it a solid part. Nine shipped coupler rows have it (Estes NB-20, NB-30, NB-50, NB-55, NB-60, MPC 62020, 62525). *Why it matters:* Estes NB-50 picked for a coupler flies as a hollow 0.15 g tube where desktop flies a 1.86 g block, and the panel shows a bore the part does not have. None states a mass, so `catalogPatch.kernel.test.ts` misses them. *Fix:* `p.innerDiameter != null`, and a solid branch in `discDims` (`discGeometry.ts:232`) for the cut sheet and print solid.
- **C15** (MED, CONFIRMED BY REVIEWER for the code path; desktop behavior REPORTED) [4b] `web/src/services/flight/flightConfigs.ts:170-180` (`primaryMotor`), used by `runPlan.ts:61`, `store.ts:1605`, `RunButton.tsx:44`. The run gate judges the first seated mount in tree order, which is the sustainer, and `loadOrk` seats an empty mount with a curve-less placeholder (`emptyMountMotor`, `loadOrk.ts:102-124`). The doc comment says the aft mount is the one that matters. *Why it matters:* A desktop two-stage `.ork` that seats only the booster is refused with "no motor"; the reverse (sustainer seated, booster empty) passes. *Fix:* Judge the aft-most mount, or any seated mount with a curve, as the comment intends; add a two-stage case.
- **C16** (MED, CONFIRMED BY REVIEWER) [3b] `web/src/components/sim/LaunchPanel.tsx:361-364` ("Use my location"), `:401-404` (map pick); `web/src/components/tools/SiteFields.tsx:75`. All three write latitude and longitude and keep the previous site's `launchAltitudeM`. `LocationPicker.tsx:47-49` and `PlaceSearchDialog.tsx:18-21` state the rule: always write the elevation, `null` when unknown. *Why it matters:* The C12 failure through three more writers: a 1,600 m field picked this way flies sea-level air with no missing-field marker, and the Landing tool keeps the old pad elevation. *Fix:* Write `pos.coords.altitude ?? null` for geolocation and `null` for a map pick that moves the site.
- **C17** (MED, VERIFIED for the code path; the browser behavior is REPORTED) [3b] `web/src/components/sim/LaunchPanel.tsx:521`. Every LaunchPanel uses the radio group name `windModel`, and two mount together when Settings opens over the sim editor (`SettingsTabs.tsx:413` and `SimEditor.tsx:175`). `Dialog` sets `aria-modal` but does not make the background inert. *Why it matters:* An arrow key in the Settings radio group can move to the sim editor's radio behind the dialog, check it, and change the active flight's wind model with an undo step nobody saw. *Fix:* `useId()` in the group name.
- **C18** (MED, CONFIRMED BY REVIEWER) [w] `web/src/services/files/ork/exportMotorConfigs.ts:87`. Every motor is written with `<type>single</type>`. Desktop writes the motor's real type or nothing (`RocketComponentSaver.motorMountParams`), and `ThrustCurveMotorSetDatabase.findMotors` drops a set whose type differs. *Why it matters:* With no usable digest (an offline save, where `fillMotorDigests` returns the motors unchanged, or a delay with no digest), a reload or hybrid motor is not found and desktop opens the mount empty. *Fix:* Omit `<type>`, or map the catalog type.
- **C19** (MED, VERIFIED) [w] `web/src/services/files/ork/exportSimulation.ts:137, 270-275`; `web/src/services/files/saveOrk.ts:32`; `web/src/state/fileSlice.ts:530-541, 563`. Every `<simulation>` gets the global `loadSettings().simulation`; a simulation's own `prefs` are never written. On import, a file's per-simulation `timestep`, `maxtime` and the four recovery warnings are neither read nor carried (they are in `KNOWN_CONDITIONS_TAGS`). *Why it matters:* A desktop simulation at a 0.01 s step comes back at 0.05 s, and a simulation run here with its own step or seed is saved as up to date next to settings it never flew. *Fix:* Add `prefs` to `OrkExportSimulation` from `effectivePrefs`, and read the per-simulation values into `sim.prefs` on import.
- **C20** (MED, VERIFIED) [1a] `web/src/services/files/ork/importUnpack.ts:258-295`; `web/src/services/files/designFile.ts:30-43`. No gzip branch: `GeneralRocketLoader.loadStep1` checks the gzip signature first, and older OpenRocket builds saved `.ork` as gzip-compressed XML. *Why it matters:* A legacy `.ork` that desktop 24.12 opens is refused as not a design file. *Fix:* Detect `1F 8B` and inflate with a running byte cap (streaming `Gunzip`, not `gunzipSync`), then sniff the format; add a fixture.
- **C21** (MED, VERIFIED) [w] `web/src/services/files/rktExport.ts:352-357`. `ShroudLineMaterial` is written before `ShroudLineMassPerMM`, and `ParachuteHandler` builds the line material when `ShroudLineMaterial` closes, with the density read so far (0). *Why it matters:* Shroud line mass is lost on desktop import. *Fix:* Swap the two writes, as desktop's DTO order has them.
- **C22** (MED, VERIFIED) [w] `web/src/services/files/rktExport.ts:328-333`. `TabOffset` is the raw `tabOffset`, whatever `tabOffsetMethod` says (default 'middle'). Desktop writes `getTabOffset(AxialMethod.TOP)` and reads it as top. *Why it matters:* A centered tab moves to the fin's leading edge in desktop. *Fix:* Convert to a top offset.
- **C23** (MED, VERIFIED) [w] `web/src/services/files/rktExport.ts:385-391`. One `<ExternalPod>` is written whatever `instanceCount` is; desktop's `PodSetDTO.generatePodSetDTOs` writes one per instance and `PodHandler` sets the count to 1. *Why it matters:* A three-pod set opens with one pod. *Fix:* Split per instance, as `clusterMembers` does for inner tubes.
- **C24** (MED, VERIFIED) [w] `web/src/services/files/rktExport.ts:385-391` and `writeChildren`. Pod children are written with angles relative to the pod. Desktop adds the pod angle on export (`addAngleOffsetToChildren`), and both `PodHandler` and the app's own `rktImport.ts:766` subtract it on read. *Why it matters:* Fins on a pod at 90° come back at -90°, in desktop and in the app's own round trip. *Fix:* Add the pod's `angleOffset` to descendants on write, stopping at nested assemblies.
- **C25** (MED, VERIFIED for the null; the downstream effect is REPORTED) [w] `web/src/services/files/rktExport.ts:43, 169-170`. `FINISH_CODES` covers four finishes; any other finish an imported `.ork` carries leaves `FinishCode` out, and `FinSetHandler` then calls `setFinish(null)`. Desktop's `RockSimFinishCode.toCode` maps the rest to 2. *Why it matters:* A fin set with a rough or polished finish opens in desktop with a null finish. *Fix:* Default unknown finishes to 2.
- **C26** (MED, VERIFIED) [w] `web/src/services/files/rasaero/booster.ts:299-303` with `sustainer.ts:93-96`. A booster fin's `Location` is measured from the bottom of its own tube; desktop's `BoosterDTO` adds the lengths of the later tubes of the same diameter. *Why it matters:* In a booster of two tubes with fins on the first, the fins are written one tube length too far aft. *Fix:* Add the later tubes' lengths.
- **C55** (MED, CONFIRMED BY REVIEWER) [w] `web/src/services/files/rktExport.ts:290` (`writeSurfaceTube`, used for tube fins) and `:323` (`writeFinSet`). Fin and tube fin `RadialAngle` is read from `angleOffset`, but these types keep their rotation in `rotation` (`componentFields.ts:312` `FIN_ROTATION`; the bridge at `ComponentFactory.java:368, 671`; the `.ork` writer at `exportParts.ts:264`). `rktImport.ts:476, 558` writes `angleOffset` the same way, and `rktExport.test.ts:65, 225` put `angleOffset` on a fin node, so the tests pin the wrong key. *Why it matters:* A fin set rotated 45° is written with no `RadialAngle` and opens in desktop and RockSim at 0°; a `.rkt` fin rotation is lost on import. *Fix:* Read and write `rotation` for every fin set and tube fin set, and fix the fixtures.
- **C56** (MED, VERIFIED) [w] `web/src/services/files/rktExport.ts:29-32, 394-413` (no `parallelstage` writer). Parallel stages are skipped and the skipped note says RockSim has no element for them. Desktop writes them through `ParallelStageDTO` as `<ExternalPod>` with `Detachable` 1, one per instance (`BodyTubeDTO:159-163`), and both desktop's `PodHandler` and the app's importer read them back as parallel stages. *Why it matters:* A strap-on booster design loses every booster, with its mass, drag and motors, and the note tells the user the format cannot hold them. *Fix:* Write parallel stages through `writePod` with `Detachable` 1, after C4, C23 and C24.
- **C27** (MED, VERIFIED) [conv] `website/docs/views-and-analysis.md:47`. "Roll rate: in rad/s." The Aero roll rate field uses the user's roll rate unit (`AeroAnalysis.tsx:187, 251`), which defaults to r/s (`prefs/units.ts:234`, factor 2π). *Why it matters:* A user who types a rad/s figure gets roll damping at 2π times the intended rate. *Fix:* Say the field uses the roll rate unit from Settings, default revolutions per second; fix the Spanish twin.

### Low

- **C28** (LOW, VERIFIED) [conv] `website/docs/views-and-analysis.md:169`. "1 to 2 calibers is the usual healthy range; the stability tile is color-coded to flag under- or over-stable designs." The tile's bands are under 1.0 and over 6.0 (`simReport.ts:7-12`). *Why it matters:* A reader takes a green 4 cal tile as the docs' "healthy". *Fix:* State the tile's bands; fix the Spanish twin.
- **C29** (LOW, VERIFIED) [3a] `web/src/components/canvas/schematicShapes.tsx:586-601`; `rocketPieces.ts:329-341`; `AftView.tsx:244-257`. A rail button stands off the body by its outer diameter in every view; its `height`, which the bridge flies (`ComponentFactory.java:492-497`), is never read. *Why it matters:* Editing Height changes mass and nothing on screen. *Fix:* Use the button's height for its radial extent.
- **C30** (LOW, VERIFIED) [3a] Residue of C39. `web/src/components/canvas/FlightXYPanel.tsx:316-322`. With no crosshair, or hovering outside the primary stage's span, the velocity over altitude header shows the bare peak speed with no peak tag. *Fix:* `flight.peakTag` with no hover and `NO_VALUE` outside the span, as `FlightChartPanel.tsx:127-135` does.
- **C31** (LOW, VERIFIED) [3a] `web/src/components/canvas/schematicShapes.tsx:596, 652-659`. The side view applies the view's roll to fins, tube fins and pods but not to lugs, rail buttons or clustered inner tubes; the aft view turns them all (`AftView.tsx:516`). *Why it matters:* At roll 180° the fins flip and a rail button stays on the wrong side. *Fix:* Add `roll` to the lug and button angle and the cluster rotation.
- **C32** (LOW, VERIFIED for the path; the trigger is REPORTED) [3a] `web/src/components/canvas/AftView.tsx:130, 322`. The aft view does not resolve keyless transition ends (`rocketPieces.ts:171` and `schematicShapes.tsx:107` do). A stored workspace loads through `repairValues` only (`store.ts:972`). *Fix:* `withKernelEnds(tree)` before `buildAftScene`. See T5.
- **C33** (LOW, VERIFIED) [3b] Residue of C13. `web/src/components/tools/ParachuteTool.tsx:90-100` with `web/src/services/flight/recoverySizing.ts:116`. A cleared site elevation has no placeholder and sizes the canopy for sea-level air. *Fix:* A placeholder that says sea level, or a required marker.
- **C34** (LOW, VERIFIED) [4b] Residue of C12 and C13. `web/src/services/landing/landingEstimate.ts:131`; `web/src/services/tools/surfaceWind.ts:203`. A blank pad elevation with a failed lookup becomes sea level with no note. *Fix:* Return an error asking for the elevation, as the Weather dialog does.
- **C35** (LOW, VERIFIED) [3b] `web/src/components/tools/SizingFigures.tsx:17-24`. `VERDICT_TONE` colors 'between' (20 to 50 ft/s) green; the comment above it says amber outside a band. *Fix:* `text-warn-400`.
- **C36** (LOW, VERIFIED) [4b] `web/src/services/design/treeEdit.ts:57-77` (`breaksPreset`). The rule that drops a catalog link disagrees with the kernel's `clearPreset` callers both ways: a shoulder edit keeps the link (the kernel clears it in `Transition.setFore/AftShoulderRadius`), and a deploy event, altitude or delay, packed size, `flipped` or `clipped` edit drops it (the kernel keeps it). *Why it matters:* Setting a picked main chute to deploy at 150 m removes its `<preset>` from the saved `.ork`. *Fix:* Build the set from the kernel's `clearPreset` setters.
- **C37** (LOW, REPORTED) [4b] `web/src/services/design/treeEdit.ts:567-574`. A catalog pick writes a centering ring's inner radius above its outer for two shipped rows (Quest CR2924, SEMROC RA-55-70); the bridge then raises the outer. *Fix:* Run the pick through `RING_BOUNDS`.
- **C38** (LOW, VERIFIED) [3c] `web/src/services/design/componentFields.ts:187-188, 283, 407-416, 454-478`. Three kernel clamps have no panel bound: wall thickness at most the radius, shoulder radius at most the end it plugs into, and tab height at most `getMaxTabHeight()`. The app's readers clamp all three, so only the shown and saved number differs from the flown one. *Fix:* `bounds.max` for these fields (walls on tubes and cones only).
- **C39** (LOW, REPORTED) [3c] `web/src/components/layout/DefaultMaterials.tsx:30-36, 54` with `materialSlots.ts:124-127`. A default material chosen in Settings carries no group, unlike one picked in the panel. *Fix:* Store the database group with the default. See C13.
- **C40** (LOW, REPORTED) [3c] `web/src/components/design/ScaleDialog.tsx:32-43, 79-81, 182`. With a stage selected (or a pod or booster at radius 0) the scope is the whole rocket but "Scale from" opens at the stage's length, 0, and the "to" box is disabled. *Fix:* Fall back to the widest size when the scope is the rocket or the size is not positive.
- **C41** (LOW, VERIFIED) [1c] `web/src/services/motors/engParser.ts:135` and `motorDb.ts:112-113`. The `.eng` importer and the picker compute impulse, class and burn from the raw samples; `.rse`, `parseEngine` and desktop's `RASPMotorLoader` finalize the curve first (sort, add t = 0). *Why it matters:* A curve starting at (0.05 s, 40 N) loses the opening ramp and can land in the wrong class. *Fix:* `finalizeCurve` before the totals.
- **C42** (LOW, VERIFIED) [1c] [3a] [3c] [conv] Text that skips i18n. `web/src/services/motors/thrustcurve.ts:87-101` rethrows raw `TypeError` and `SyntaxError` (residue of K11; `remoteData.fetchFailure` maps both); `web/src/components/canvas/flightChartTraces.ts:77` prints the unit `cal` where the app prints `t('stability.caliber')`; `EnvironmentLanding.tsx:205, 408` join translated reasons with `'; '` (K14 class); `orkImport.ts:166, 171, 172` hard-code `Air-start`, `Java code` and `script`, which desktop translates; `MaterialPicker.tsx:270-271, 305-307` shows raw group names, which desktop translates (`MaterialGroup.java:16-27`); `schematicExport.ts:31-32` formats the header's length and mass with `fmtSi` beside a `fmtNum` margin; `componentExport.ts:38, 55` names an unnamed part by its type token; six concatenations fix English word order (`StageColorDialog.tsx:111`, `RangeSlider.tsx:67, 78`, `ConfigsTable.tsx:101`, `ImageExportMenu.tsx:101`, `PlaceSearchDialog.tsx:45`, `WindProfileDialog.tsx:369`); and `es.json` gives the launch lug (`type.launchlug`, :1287) and the launcher (`launch.launchRod`, :798) the same name, "Guía de lanzamiento", so a Spanish reader cannot tell them apart. *Fix:* Keyed errors, `fmtList`, `fmtNum`, `partLabel` and keys with placeholders.
- **C43** (LOW, REPORTED) [1c] `web/src/services/motors/motorDb.ts:236-248` with `motorStore.ts:224-230`. Motors are keyed `custom:<maker>:<designation>` after the delay is removed, so a file with C6-3, C6-5 and C6-7 blocks stores one motor with the last delay, while the dialog reports three. *Fix:* Merge the delay lists and report the stored count.
- **C44** (LOW, VERIFIED) [1c] `web/src/state/SettingsProvider.tsx:54-58` with `web/src/services/storage/settings.ts:818-825`. Settings are written whole from each tab's copy with no resync. *Why it matters:* An older tab dragging a divider writes back its stale units and launch defaults. *Fix:* Listen for the `storage` event, or write only the changed keys.
- **C45** (LOW, VERIFIED, REPORTED for frequency) [1a] `web/src/services/files/rktImport.ts:347`. A transition reads `Xb` and `LocationMode`; desktop's `TransitionHandler` extends `BaseHandler` and ignores both. An absolute transition then overlaps the nose cone in the kernel. *Fix:* `base(el, 'transition', false)`.
- **C46** (LOW, VERIFIED) [1a] `web/src/services/files/rktImport.ts:288, 394-395`. `UsageCode` 3 (sleeve) becomes a tube coupler where `RingHandler` makes a centering ring, and a transition with no `ShapeCode` gets an ogive where desktop keeps conical. *Fix:* Map 3 to a centering ring; default the transition to conical.
- **C47** (LOW, VERIFIED) [1a] `web/src/services/files/ork/importReaders.ts:194-206`. The `.ork` fin point walk stops at `MAX_FIN_POINTS` with no note; the `.rkt` reader adds `importNote.finPointsCapped`. *Fix:* The same note.
- **C48** (LOW, REPORTED) [1a] `web/src/services/files/decodeText.ts:415-431`; `importUnpack.ts:301`. Only UTF-8 and UTF-16 are recognized, and the XML declaration is removed before parsing, so a declared ISO-8859-1 or windows-1252 is ignored. *Why it matters:* A Latin-1 file with "é" or "µ" in a name shows U+FFFD and saves it. *Fix:* Pass the declared encoding to `TextDecoder` when it knows the label.
- **C49** (LOW, VERIFIED) [w] `web/src/services/files/ork/exportParts.ts:211-222`. With two or more configurations, a configuration that overrides nothing still gets a `<deploymentconfiguration>` repeating the defaults; `RecoveryDeviceSaver` skips default configurations. *Why it matters:* Desktop marks every configuration overridden, so a later deploy change in desktop's dialog reaches only the default. *Fix:* Skip the block when the configuration has no deployment override.
- **C50** (LOW, VERIFIED) [w] `web/src/services/files/ork/exportParts.ts:365-372`. `<separationconfiguration>` is written for every configuration; `AxialStageSaver` writes only those with an override. *Fix:* Write only configurations with an entry.
- **C51** (LOW, VERIFIED) [w] `web/src/services/files/xmlUtil.ts:25-37`. `stripXmlForbidden` drops C0 controls only; U+FFFE, U+FFFF and lone surrogates are also outside XML 1.0. *Why it matters:* A name holding U+FFFF makes desktop reject the whole `.ork`, `.rkt` or `.CDX1`. *Fix:* Drop them too.
- **C52** (LOW, VERIFIED) [w] `web/src/services/files/rktExport.ts:153-167`. A subtree mass or CG override and an overridden CD are neither written nor named in `skipped`; `BaseHandler` turns the subtree override into a component-only one. *Fix:* Name them in the skipped note, as the CG-only case is.
- **C53** (LOW, REPORTED) [w] [1a] `web/src/services/files/rktExport.ts:317`. Fin points are written leading edge first; desktop's `CustomFinSetDTO` reverses them for RockSim. Desktop's own import accepts either order once C1 is fixed; RockSim itself may draw the fin mirrored. *Fix:* Write the RockSim order.
- **C54** (LOW, REPORTED) [w] `web/src/services/files/rasaero/booster.ts:57`. Booster `<Location>` is written after the shoulder; desktop writes the first child's absolute offset (the shoulder's start). Desktop's importer ignores it; RASAero's use is unknown.

## 🟠 Reference data

### High

- **R1** (HIGH, CONFIRMED BY REVIEWER) [6] Residue of R1. The published `data` branch (`components.generated.json` and `motors.generated.json`, fetched again for this report) holds 3,446 parts and 1,156 motors with 0 digests on either; the agent found the jsDelivr copy byte-identical. The committed copy has 5,228 parts, all with a digest, and 1,035 of 1,156 motors with one. The schedule (`cron: '0 6 * * 1'`) runs master's `sync-catalogs.yml`, which checks out `dbcook/openrocket-database` (:103) and has no `check:digests` step. *Why it matters:* The live app reads this branch first, so every `.ork` saved from the deployed app drops its part links, every saved motor leaves desktop to pick among motors that share a name, and the picker offers 1,784 fewer parts than desktop 24.12. The next run is 2026-10-12 06:00 UTC. *Fix:* Before that run, make the scheduled run use dev's pipeline (or disable the schedule), then dispatch a full refresh. Dev's pipeline reproduces the committed files byte for byte (see R2). See Decisions.

### Medium

- **R2** (MED, VERIFIED for the pin and the missing step; REPORTED for the row figures, which come from the previous run's simulation) [6] Residue of R2. Master's `web/scripts/sync-components.mjs`, `sync-preset-digests.mjs` and `sync-catalogs.yml` still pin the other database copy with no digest floor. On dev the pipeline is correct: the database pin is release 24.12's submodule commit, the jar matches its SHA-256, a rerun reproduces the committed catalogs and manifest byte for byte, the row counts per type equal `PresetDump`'s, and every digest maps back to its preset. *Why it matters:* The scheduled run would publish 13 digests that name a part of another size, 3 streamers at the wrong density and 123 rows with no digest. *Fix:* As R1.

### Low

- **R3** (LOW, VERIFIED) [6] `web/scripts/sync-components.mjs:58-63` (`tag`) and :219-223. The `.orc` text is read raw: XML entities are not decoded (23 rows show `&gt;`, such as PML "29&gt;38mm Adapter"), and a repeated element keeps the first value where desktop's JAXB loader keeps the last (`BMS.ORC:3148-3149`, `giantleaprocketry.orc:916-917`). *Why it matters:* A search for "29>38" finds nothing, and three parts are described differently from desktop. Digests are unaffected. *Fix:* Decode entities and take the last match, or write desktop's description from `PresetDump` as `partNo` is.
- **R4** (LOW, VERIFIED) [6] `web/scripts/sync-preset-digests.mjs:304-312`. When `presetVolumes` returns null, a stated mass is dropped silently: SEMROC "BC-08542 [R]" (a degenerate upstream transition) states 4.25 g on desktop and weighs about 0 here, and the catalog mass test checks only rows that carry `mass`. *Fix:* Report or refuse a massed row with no volume, or carry the mass as an override.

## 🟡 Accessibility

### Medium

- **A1** (MED, VERIFIED) [3b] [5] `web/e2e/a11y.spec.ts:103-173, 196, 256`; `web/e2e/a11y-phone.spec.ts`. The axe scans miss whole surfaces. The Locations dialog is scanned with no saved locations, so the editor (name, three number fields, the unit chip, the embedded map and its buttons) is never rendered. The Tools scans open each empty form; the Landing result card and the Off the rail result are never scanned. No scan opens a disclosure or popup: the drift sweep panel (`GroundTrack.tsx:239-256`), the import notes list (`LoadedBanner.tsx:113`), the image export menu (`ImageExportMenu.tsx:52`), the part export menu (`ComponentExportButton.tsx:42`) and the result picker (`ResultPicker.tsx:54`); the desktop File menu is scanned open only on the phone. *Why it matters:* Contrast and naming failures on these surfaces, mostly amber text, pass every gate. *Fix:* Seed a location before the Locations scan; add Landing and Off the rail result scans; keep a list of `aria-expanded` surfaces checked against `src` the way `dialogSurfaces.test.ts` checks dialogs, and scan each open in all three themes.

### Low

- **A2** (LOW, VERIFIED) [3b] Residue of A5. `web/src/components/sim/SimSummary.tsx:151`. The arrow after the safety link text is not `aria-hidden`. *Fix:* Wrap it.

## 🟠 Architecture, tooling and tests

### High

- **T1** (HIGH, CONFIRMED BY REVIEWER) [5] `web/tests/noEmDash.test.ts:87`. The file list includes `walk(`${repo}.vscode`, anyFile)`. `.vscode/` is gitignored (`.gitignore:40`) and untracked, so a CI checkout has no such folder, `readdirSync` throws, and the test file fails while it builds its list. The line is in HEAD. *Why it matters:* `build-and-test` runs this file through `verify:ci`, so it fails on every pull request, every push to dev (`Dev / verify`), and every master push, whose deploy needs the gates. Locally it passes only because this checkout has the folder. *Fix:* Drop the entry (or guard it with `existsSync`, or list files with `git ls-files`), and assert that every walked root exists.

### Medium

- **T2** (MED, VERIFIED) [5] `web/tests/lintScope.test.ts:171-182`. The guard that the promise rules and `rules-of-hooks` are on asserts `toBeTruthy()` on `cfg.rules[rule]`, and a rule set to `'off'` resolves to `[0, {...}]`, which is truthy (checked with `ESLint.calculateConfigForFile`). *Why it matters:* Turning `no-floating-promises`, `no-misused-promises` or `rules-of-hooks` off passes the guard with every gate green. *Fix:* Assert severity 2.
- **T3** (MED, VERIFIED) [5] Residue of K2. `web/tests/noEmDash.test.ts:81-83`. Under `engine-java` the scan reads `src/api`, the top-level docs and build files, and `patches/*.md`; it skips `extract/`, the `*.mjs` build scripts, `reference/`, `test/parity`, `validation/` and the project's own `patches/info/**.java`. Two U+2014 sit in the gap: `engine-java/extract/extract.mjs:213` and `engine-java/extract/manifest.txt:280`. *Fix:* Walk `engine-java` minus `src/java`, `.openrocket-src`, `build`, `.gradle` and `reference/build`; fix both sites.

### Low

- **T4** (LOW, VERIFIED) [4] `web/tests/services/design/geometryParity.kernel.test.ts:111-127, 259-266, 342-363`. The generator never builds: a fin root running past a nose cone or transition end; a tab past the root or outside the fin; `tabOffsetMethod` 'after' and 'absolute'; a trapezoid with a vanishing tip or zero or negative sweep; a freeform outline whose first point is not (0,0); cant on a nose cone; fins in pods other than an uncanted trapezoid at the top. The required rule list has no elliptical tab point rule and none for `clampInteriorPoint`. *Fix:* Add the cases and rules.
- **T5** (LOW, REPORTED) [4] `geometryParity.kernel.test.ts:1594-1664`. Keyless ends are checked for the 3D and 2D readers only; the side view (`reportGeometry.ts:206`), templates (`templatesSection.ts:48`), the printable solid (`solidMesh.ts:466`) and the DXF read `profileEnds` on the tree as given. A defect only if an unsynced tree reaches them (see C32). *Fix:* Add the readers, or resolve the tree once at their entry points.
- **T6** (LOW, VERIFIED) [4] `web/tests/tree/geometryFlags.test.ts:117-145, 346-357`. `READERS` leaves out the aft view and the DXF for the part flags, and `FIN_FLAGS` toggles only a flipped nose cone and an unclipped transition (no filled parent, no combinations). *Fix:* Add them, with `UNAFFECTED` reasons where they do not apply.
- **T7** (LOW, VERIFIED) [4] `web/tests/services/parts/catalogPatch.kernel.test.ts:56-76`. The size test samples three rows of seven types and compares `length` only; no diameter is compared, and rings, lugs and streamers never reach the mass test. C14's rows are in neither. *Fix:* Compare the kernel's radii and thickness with each row's stated diameters for every type.
- **T8** (LOW, VERIFIED) [4] `web/tests/tree/finPlanform.kernel.test.ts:521-530, 614-619, 662-698`. `OUTLINE_CONSUMERS` leaves out `dxfExport.ts`, `templatesSection.ts` and `componentActions.ts`, and the two "template equals contour" checks compare the module with its own output. *Fix:* Add the modules and pin the template to a closed form.

## 🟢 Dead code

Nothing to report. knip is clean and every claim it could make was checked;
the only default exports are `App` and `i18n`.

## Upkeep

These do not change a result today. Grouped by rule; no severity.

### U1. Comments that state something untrue

- `web/src/services/exports/meshValidate.ts:37-38`: `MeshIssue.detail` is "safe to show in an export error"; the only caller checks the count and never shows it.
- `web/src/services/motors/motorDb.ts:191` ("700 kB+ catalog", 1.37 MB); `web/src/services/app/remoteData.ts:11, 54` and `web/src/services/materials/materials.ts:18` ("1.6 MB", "~16 KB" for 10 KB).
- `web/src/services/materials/materialTypes.ts:78-83`: justifies the check by "a data host that is up but wrong"; materials are build-only (`remoteData.ts:250`).
- `web/src/services/app/warningText.ts:69-72`: `Rocket.compname.Rocket` does not fall back to the humanized key (`SOURCE_KEY`, line 29, matches one dot).
- `web/src/components/sim/LaunchPanel.tsx:41-42` ("App feeds these straight into simulate()"), `:47` ("see SI above"); `SimulationsPane.tsx:113-116` (the Run comment sits over the CSV button); `SizingFigures.tsx:17` (see C35); `MotorDialog.tsx:63` (".eng" only; it also takes `.rse`).
- `web/src/components/canvas/TreeSchematic.tsx:350-351` ("labeled in mm"); `ViewToggle.tsx:236-237` ("all five"; there are seven); `AftView.tsx:525-529` (SchematicControls hides Fit); `FlightPath3D.tsx:697-698` (`usePieces` disposes, not `buildPieces`); `Rocket3D.tsx:39` and `RocketModel.tsx:79` (theme tokens, not sky).
- `web/src/state/store.ts:198` (`rocket` "used by runSim"), `:366-373` (detached `applyTreeAction` docblock), `:733-741` (the `patchConfig` docblock sits on `sameMotorSpec`); `web/src/App.tsx:146-147, 238-240`; `web/src/services/design/buildRocket.ts:13` (ignition is not in `seatedMotorsKey`).
- `web/src/services/design/componentDefaults.ts:249-254` (the kernel reads both values named); `web/src/services/flight/recoverySizing.ts:23-25` ("no chute preset catalog"; 422 ship); `web/src/services/flight/flightConfigs.ts:170-177` (see C15); `web/src/services/design/treeEdit.ts:57-62` (see C36).
- `web/src/services/report/reportGeometry.ts:14-15` (`schematicGeometry` lives in `tree/`); `web/src/tree/position.ts:202-210` and `web/src/tree/axialRebase.ts:46-61` (pod sets, parallel stages and stage-level masses cannot be stage children; residue of D4).
- `web/src/components/design/ComponentPicker.tsx:46-50, 415` (1,088 and 237; now 1,496 and 332), `:73-79` (doc above `CurrentPart`); `web/src/components/layout/useHelpFrame.ts:14-24` (doc on `ANCHOR_HOLD_MS`); `ComponentTree.tsx:25` ("Read-only"); `SettingsDialog.tsx:45-47` (three tabs; there are eight); `ConfigsTable.tsx:20` and `configColumns.tsx:121-122` (omit separation); `FileMenu.tsx:115-118` (omits My Parts and Check for updates); `web/src/services/design/materialSlots.ts:124-125`; `web/tests/components/design/PropertyPanel.lineCount.test.tsx:11-14` (the importers clamp to 1; see C10).
- `web/src/services/files/ork/importUnpack.ts:262-265` (see S1); `wireLoadedOrk.ts:97-103` (only 'after' is rewritten); `importBanner.ts:217-218` (each file simulation carries its own launch, and `fileSlice.ts:291` checks the first only); `decodeText.ts:403` ("whatever encoding"); `rktImport.ts:31-33, 395` (the ring map departs from `RingHandler`).
- `web/src/services/files/rktExport.ts:17-20` ("lossless" round trip; see C2, C22, C24), `:162-163` ("the app does not compute component mass"; `componentMasses()` exists), `:76, 146, 325` (Java line numbers that have moved; cite the method), `:344-345`; and the deliberate degrees-for-`RadialAngle` departure is not stated at `rktExport.ts:230-232, 322` or `rktImport.ts:212`.
- `web/src/services/files/ork/exportParts.ts:119-127` (`presetXml` says the app's catalog carries no digest; it does), `:367-369` (desktop does not write every configuration); `exportDesignInfo.ts:7-9` (desktop 24.12 warns on `designinfo`); `xmlUtil.ts:25-27` (see C51).
- `web/scripts/preset-digests/PresetDump.java:37-40` and `web/scripts/sync-preset-digests.mjs:37-41` (the dumper reads the `.orc` files now); `web/scripts/sync-materials.mjs:16-17` (reads the kernel's `Databases.java`, which has a material 24.12 lacks); `web/scripts/lib/openrocketJava.mjs:48-50` (`sync-components.mjs:44-47` has a third `arg`).
- `.github/workflows/gates.yml:348-349` ("All three tsconfig projects"; four); `web/tests/lintScope.test.ts:172-173` (the config uses `parserOptions.project`); `.github/workflows/gates.yml:485-487` and `web/playwright.config.ts:63-67` (a passing retry uploads no report, since the upload runs `if: failure()`); `web/tests/noEmDash.test.ts:10` ("English translations" under `website/`).
- Java line citations that point elsewhere: `web/tests/services/report/reportGeometry.test.ts:310` (`FinSet.java:959-972`; `getBodyRadius` is at 1034-1047); `web/src/services/design/autoRadius.ts:361, 388, 411, 439` (each `SymmetricComponent.java` range starts a few lines off). `web/tests/services/storage/storageKeys.test.ts:45-50`: the comment about the changelog sits over the test file entry, and `CHANGELOG.md` sits under the audit comment.
- `website/docusaurus.config.ts:12-18, 67`: Overview does not render `<UpstreamPin />` or `<AppVersion />`; only the three comparison pages do.
- `web/tests/tree/finPlanform.kernel.test.ts:254-259`: the `setPoints` snap is transcribed as `min(x, 2.5), min(y, 2.5)`; the Java's second `set` uses the original point. The port follows the test; it differs only for a fin over 2.5 m both ways.

### U2. History in comments and test titles that the gate misses

- `web/tests/services/storage/storageKeys.test.ts:90` ("the whole point of the rename"); `web/tests/state/replaceWorkspaceBuild.test.ts:50` ("still clears everything it cleared before"); `web/scripts/motor-digests/MotorDump.java:30, 245` ("the failure being fixed"); `web/scripts/ork-check/OrkCheck.java:80-83` ("for a long time it did not"); `web/src/components/sim/FlightCsvDialog.tsx:20-22` (describes the old download); `web/tests/state/replaceWorkspaceBuild.test.ts:51`; `web/tests/components/common/Dialog.test.tsx:38` ("now gets"); "as before" in `web/tests/services/motors/motorCombine.test.ts:118`, `web/tests/services/storage/workspaceJournal.test.ts:428`, `web/tests/services/storage/idbKeyValueStore.test.ts:447`; "exactly as before" in golden titles `web/tests/services/files/orkExport.golden.test.ts:380, 417`, `web/tests/services/files/rasaeroExport.golden.test.ts:142`, `web/tests/services/report/reportPdf.golden.test.ts:385` (say what the golden file pins instead); borderline `web/src/engine/openRocketEngine.ts:391` ("the only place left").
- Outside the gate's scope: `engine-java/extract/manifest.txt:260, 278` ("Added 2026-09-16"); `engine-java/patches/info/openrocket/core/masscalc/MassCalculation.java:397-400` ("Previously only the mass was zeroed"; owned by the engine audit and needs a re-bless); `website/docusaurus.config.ts:79, 131-136` (residue of K22).
- **Gate gaps:** `commentsStateTheConstraint.test.ts:9` says it covers named people and has no pattern for them, nor for "the rename", "being fixed", "as before", "now gets" or "<verb>ed before". `storageKeys.test.ts:37, 49, 50` allow files that no longer match (`openRocketEngine.ts`, the deleted `docs/AUDIT.md` with its comment at :48, `CHANGELOG.md`), and that test has no "entry matches nothing" check. knip's `ignoreExportsUsedInFile` for types has no stated reason (residue of D2).

### U3. Duplicated helpers and limits that have drifted

- `web/src/tree/shapeProfile.ts:332` gives a body tube with no `outerRadius` a radius of 0; `web/src/tree/finPlanform.ts:644-649` (`bodyTubeRadius`) uses the kernel's 0.012 m, and `finTabAuto.ts:210` reads the first.
- Parachute line count ceiling: `importLimits.ts` 100, the editor 64 (`DimensionFields.tsx:445`), the bridge 1,024 (`ComponentFactory.java:87`).
- Impulse and class: `engParser.ts:135` on raw samples, `rseParser.ts:322` on finalized points (C41).
- A number with its unit built by hand instead of `withUnit`: `PlaceSearchDialog.tsx:121`, `LocationsDialog.tsx:153`, `SiteMap.tsx:417`.
- The zoom in, zoom out and fit triplet: `AftView.tsx:530-555` (Fit disabled, glyph only) and `SchematicControls.tsx:327-349` (Fit hidden, text label).

### U4. Docs that state what the app does not do

User docs (English), behavior:
- `website/docs/settings.md:154` says each threshold, Min launcher-exit velocity included, can be overridden per simulation; the simulation editor offers the four deploy thresholds only (`SimEditor.tsx:381-399`). `settings.md:141, 156` say all five reach the flight engine and age results; the exit minimum is in neither `SimPrefs` nor `SIM_PREF_KEYS`.
- `features.md:36`: the motor diameter range does not default to the mount bore (`MotorDialog.tsx:132-141`); that is the "Fits the mount" box.
- `glossary.md:244` ("Help reads offline from the first install") contradicts `offline-and-installing.md` (the first visit caches it, installed or not).
- `overview.md:29-32`: the organization list omits Technical Documentation, Offline & Installing, Flight Configurations, Tools and the Glossary (`sidebars.ts:12-44`).
- Three different exactness claims: `safety.md:15`, `comparison-openrocket.md:19`, `designing-a-rocket.md:144` (REPORTED; pick the one the tests support).

User docs (English), labels:
- `glossary.md` "Drift sweep" says the sweep runs across wind speeds; it also sweeps headings (`views-and-analysis.md:106`).
- `designing-a-rocket.md:169` "Select a part…" (`picker.pick` "Select part… ({{count}})"), `:62` "Capped" ("Shoulder capped"); `running-a-simulation.md:142` "Deployment speed" ("Deploy speed"), `:143` "Landing speed" ("Landing"); `views-and-analysis.md:160` "fineness ratio" ("Fineness"), `:163` "Recovery weight" ("Mass (Recovery)"), `:167` pitch and roll moment of inertia ("Pitch inertia (loaded)", "Roll inertia (loaded)"); `flight-configurations.md:44` ("Separation altitude (AGL)").
- Launcher wording (residue of K39): `running-a-simulation.md:138` "Rail-exit velocity", `:113` and `safety.md:55` "Launch rod angle", `running-a-simulation.md:104` and `settings.md:118` "rod length, rod angle", `files-and-exports.md:104` "off-rod", `safety.md:23` "still on the rod", `safety.md:45` "rail exit velocity", and generic "rod" in prose at `running-a-simulation.md:54, 105`, `settings.md:120`, `safety.md:34`, `views-and-analysis.md:116`, `glossary.md:148`, `settings.md:18, 21`, and the `faq.md:26` heading ("at rail exit").
- Plain language (residue of K8): `overview.md:8` and `faq.md:6` ("lightweight, mobile-friendly"), `features.md:6` ("real physics core"), `features.md:55-56` ("ongoing effort", "currently ten"), `comparison-zenrockets.md:55, 95, 97`, `comparison-openrocket.md:27`, `views-and-analysis.md:84, 104, 116`, `running-a-simulation.md:46, 48`, `files-and-exports.md:179, 186`, `glossary.md:6` ("Every term").
- `website/sidebars.ts:8` cites `e2e/help-dialog.spec.ts`; the file is `web/e2e/help-dialog.spec.ts`.

User docs (Spanish twins under `website/i18n/es/docusaurus-plugin-content-docs/current/`); all 19 pages exist, every heading but the glossary letters is pinned to its English anchor, and every fragment link resolves:
- Labels that differ from `es.json`: "botón de raíl" for "Botón de riel" (`features.md:15`, `designing-a-rocket.md:34, 164`, `files-and-exports.md:29, 64, 79`, `running-a-simulation.md:25`, `settings.md:164`); "riel" and "en el riel" (`glossary.md:60`, `settings.md:162`); "salida de rampa" for "Salida de la guía" (`comparison-zenrockets.md:37`, `running-a-simulation.md:150`, `files-and-exports.md:156`); "salida de la varilla" (`files-and-exports.md:104`); "drogue" for "piloto" (`comparison-zenrockets.md:37`, `running-a-simulation.md:156`); "guía" where English names rail or rod (`features.md:54`); "rampa" (`views-and-analysis.md:116`); "pods" for "Cápsula" (`features.md:30, 35`, `files-and-exports.md:21`, `comparison-zenrockets.md:54`).
- Further label mismatches: `comparison-zenrockets.md:56`; `flight-configurations.md:39, 44`; `settings.md:101, 143, 164`; `safety.md:18, 42, 43, 49` and `glossary.md:312-316` (three words for "Anulaciones"); `running-a-simulation.md:26, 35, 46`; `views-and-analysis.md:14, 17, 24, 39, 40, 41, 45, 56, 58, 60, 86, 124, 166`; "Trayectoria 3D" for "Ruta 3D" (`files-and-exports.md:171`, `views-and-analysis.md:120`, `running-a-simulation.md:160`, `getting-started.md:52`) and `files-and-exports.md:175`; `designing-a-rocket.md:22, 56-64, 62, 81, 88, 101, 110, 170, 174`; `glossary.md:34, 346`; `files-and-exports.md:68, 227`.
- Wording: `faq.md:12` differs in substance from English `faq.md:12` (check which is current); `views-and-analysis.md:163` ("motor" for the flight engine); `comparison-openrocket.md:32`; `comparison-mmrocket-sim.md:23`; `getting-started.md:11, 29`; `glossary.md:112` ("despliegado"); `glossary.md:136, 344` ("Envolvente de deriva" for "Elipse de deriva"); the 21 glossary letter headings carry no anchor pin (residue of K7).

Repo docs:
- `README.md:39` ("rod within 20° of vertical"; the limit is 30° for a model rocket and 20° for high power, and it applies to any launcher), `:33` ("rod"), `:16` ("rail-exit").
- `docs/DEVELOPER.md:137` (the built-in material fallback is the jar's, per :120), `:139` (the digest steps compare rows present in both catalogs now), `:170, 179` and the slice 5 job list in `docs/AUDIT_PROMPT.md` (the parity job also compiles the catalog Java helpers and opens saved `.ork` and `.rkt` files in desktop, and neither runs on a dev push).
- `docs/AUDIT_PROMPT.md` (working tree): the "Merge duplicates" bullet now renders under the upkeep paragraph instead of in the reporting bar list.
- `docs/AUDIT_PROMPT_DUPLICATION.md:3` (the main prompt and a gate now cover duplication), `:48` (`npx --yes jscpd@4`, an unpinned older major against the pinned 5.4.1), `:51` (a dated measurement), `:79` (`stabilityGadget`, now `stabilityInks`), `:85` (`store.ts` is 1,722 lines); `docs/AUDIT_DUPLICATION.md:303` (`stabilityGadget`).

### U5. Spelling and locale text the gates miss

- "afterwards": `web/src/i18n/locales/en.json:1661` (user-facing), `web/src/tree/shapeProfile.ts:251`, `web/src/state/store.ts:1516`, `web/src/state/promptStore.ts:21`, `web/src/services/report/reportModel.ts:220`, `web/src/services/exports/offscreenRaster.ts:25`, `web/src/services/design/finTabAuto.ts:161`, `web/src/services/motors/thrustcurve.ts:130`, `web/src/components/report/ExportDialog.tsx:57`, `web/src/components/common/useLatest.ts:13`, `web/tests/components/design/MaterialPicker.test.tsx:64`, `web/tests/state/store.test.ts:1222, 1281`, `web/tests/services/exports/flightPathExport.test.ts:319, 1243`, `CHANGELOG.md:61, 470, 571`, `TODO.md:35`. The idiom "followed round": `web/src/components/canvas/schematicShapes.tsx:143`.
- **Gate gap:** cspell's `flagWords` holds the British form of "toward" but not "afterwards" (nor "backwards", "forwards", "upwards" or "downwards"), and accepts these British forms (none occur today): localising, catalogued, memoisation, channelled, fuelling, totalled, dialled, focussed, theatre, humour, labour, flavour, mould, tyre, cheque, kerb, storey, draught, enrol, fulfil, skilful, spelt, dreamt, sombre.
- `web/src/i18n/locales/pt-BR.json:1513` and `pt-PT.json:1513`: "necessáriamente" for "necessariamente".

## Recommended order of attack

1. **T1** today: drop the `.vscode` walk so CI can pass at all. Fix the two em dashes in **T3** and widen the scan in the same change.
2. **R1 and R2** before 2026-10-12 06:00 UTC: stop or redirect the scheduled run on master, then publish a full refresh from dev's pipeline.
3. **C1 to C5**, the `.rkt` HIGH findings, then **C21 to C25**, **C55** and **C56** in the same files. Each is a few lines in `rktImport.ts` or `rktExport.ts`; test each against the desktop handler with `npm run check:ork`.
4. **S1**: one line in the zip guard, plus the hostile test.
5. Small, verified correctness fixes: **C6** (match bundled motors only), **C10** (after the decision), **C11** (seed the auto flags), **C14** (`!= null`), **C16** (write the elevation), **C17** (`useId`), **C18** (omit `<type>`), **C15** (the aft mount).
6. **C7**: route `openDesign` through the `readActive` path, with the store test.
7. **T2**, then the a11y scan gaps in **A1**.
8. **C13** (material groups, after the decision) with the desktop sample cases, and **C12** with `componentInfo` reporting Cd.
9. **C19** (per-simulation prefs both ways) and **C20** (gzip `.ork`).
10. Drawing work: **C8** and **C9** (instances and radial placement), then **C29** to **C32**.
11. The remaining LOW findings, the test gaps **T4** to **T8**, and the reference data LOWs **R3** and **R4**.
12. Upkeep, by rule. Start with the user docs items that change a number a reader uses (**C27**, **C28** and the threshold sentences in U4), then the gate gaps in U2 and U5 so the mechanical cases stop recurring.

## Decisions for the owner

- **R1:** disable the schedule on master until dev is merged, or merge the catalog pipeline to master now.
- **C10:** a parachute with 0 shroud lines. Desktop and both file formats allow it; the bridge refuses it. Either the bridge accepts 0 for this field (and the importers keep a file's 0), or the panel floors at 1 and the comment and test change.
- **C13:** the group written for a new fillet's epoxy. Desktop has no adhesives group, so the choice is "Other" or no group attribute.

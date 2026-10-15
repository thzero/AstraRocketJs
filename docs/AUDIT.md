# AstraRocketJs `web/` engineering audit

<!-- cspell:ignore Rocketarium bulkplate -->

Date: 2026-10-15. Scope: the `web/` package per `docs/AUDIT_PROMPT.md`. Eight slice agents read every file in their slice (files and exports, state and engine, canvas components, other components, tree and geometry, flight and design services, dead code and tooling, reference data) and every finding below was re-checked by the lead against the source lines, the Java and the bridge. Kernel math under `web/src/tree` and `web/src/services/design` was compared term by term with the committed Java, never with another copy in `web/`. Line numbers are as of this date.

## Summary

| Severity | Count | Where |
| --- | --- | --- |
| HIGH | 1 | reference data (R1) |
| MED | 5 | files (F1, F2), state (S1), components (C1), accessibility (A1); C2 withdrawn, see its entry |
| LOW | 7 | files (F3, F4), state (S2), geometry (G1, G2), reference data (R2) |

Every finding was fixed on this tree the same day; see Resolutions at the end. No security finding. No dead code. No gate whose scope excludes what it claims to cover. No ported formula disagrees with the Java; the one geometry rule that does (G2) is a wall inheritance, not a formula.

## Gates, run locally for this audit

| Gate | Result |
| --- | --- |
| `npm run verify` in `web/` (format, spell, typecheck, lint, knip, dupes, build, vitest) | pass; 577 test files, 6998 tests |
| `npx playwright test` in `web/`, the whole suite | pass; 544 tests |
| `npm run audit` in `web/` (coverage, samples, desktop, fields, helpers) | pass; fields: 0 new differences, 46 known, 0 stale |
| `npm run audit` in `engine-java/` (parity, committed, extract, date, scorecards) | pass |

## `KNOWN` lists

`web/tests/engine/fieldReadback.kernel.test.ts` has an empty `KNOWN`. Every entry in `web/scripts/check-desktop-fields.mjs` states a format limit in words (what RockSim or desktop 24.12 cannot carry, or what a bundled example names as it ships) and none cites a finding ID, so no citation is rewritten this run. `geometryParity.kernel.test.ts` and `geometryFlags.test.ts` keep empty lists.

## 🔴 Security

None. Checked and holding: the `.ork` unzip caps every member, the archive and each gzip member and stalls on inflate input (`importUnpack.ts`); every CSV writer, header and comment line goes through `csvCell`; KML balloons are escaped and `<`/`>` stripped from KML values; DXF text goes through `ascii()` so a name cannot start a group code; `finiteNum` guards every file number that reaches physics; the IndexedDB tier handles `onblocked`, `onversionchange` and `onclose`, resolves writes on `complete` and compares stamps for two tabs; remote catalogs carry a first-byte timeout, a body timeout, a byte cap and a shape check; the worker protocol checks message shape, a dead worker's run is rejected once, and a failed init retries on a new URL; no `dangerouslySetInnerHTML`; every `target="_blank"` carries `rel="noreferrer"`.

## 🟡 Correctness: files and exports

### F1 (MED) An unknown deploy or separation event refuses the whole file

- `web/src/services/files/ork/importTags.ts:310-313` (`deployEventOfXml` returns the raw token when no event matches), `:339-340` (`readSeparationTags` stores the token unchecked); the per-configuration copies at `web/src/services/files/ork/importConfigs.ts:105` and `:151`.
- The token reaches the bridge, where `deployEventOf` (`engine-java/src/api/java/api/ComponentFactory.java:918-927`) and `separationEventOf` (`engine-java/src/api/java/api/OpenRocketEngine.java:421-434`) throw. `buildForImport` (`loadOrk.ts:201-216`) retries without freeform outlines, fails again and rethrows, so the file does not open and the banner shows the kernel's English sentence.
- Desktop reads the same file: `DocumentConfig.findEnum` returns null for an unknown name, the deployment and separation handlers add a `FILE_INVALID_PARAMETER` warning and keep the default event. The same reader already does this for `<shape>`, `<finish>` and `<crosssection>` through `enumTag` (`importTags.ts:425-439`).
- Why it matters: a file from a newer OpenRocket that adds an event (the enum has grown before), or any hand-edited file, opens in desktop with a warning and is refused here with an untranslated message, and the user cannot reach the design to fix it.
- Fix: route both events through `enumTag` with the kernel's accepted names, drop the unknown token with a keyed note, same for the configuration overrides. Test: an `.ork` with `<deployevent>bogus</deployevent>` opens, flies the kernel's default event (read through `getComponentFields` on the bridge) and carries the note. VERIFIED.

### F2 (MED) The `.ork` writer and reader fall back to sizes the kernel and desktop do not use

- Writer, `web/src/services/files/ork/exportWriters.ts`, literal vs what the bridge flies for the same absent key (`ComponentFactory.java`): body tube length 0.3 vs 0.2 and radius 0.012 vs 0.025 (`:177`, `:179` vs `:294-296`); trapezoid tip chord 0.03 vs 0.05 and sweep 0.02 vs 0.025 (`:191-192` vs `:321-322`); elliptical height 0.03 vs 0.05 (`:209` vs `:336`); tube fin wall 0.0005 where the bridge sets none and the part inherits its tube's wall (`:224` vs `applyWallThickness`, `:991-996`); tube coupler length 0.05 vs 0.06 (`:252` vs `:450`; `COMPONENT_DEFAULTS.tubecoupler.length` is already 0.06); launch lug radius 0.0022, length 0.05, wall 0.0003 vs 0.005, 0.03, 0.001 (`:306-308` vs `:503-505`); shock cord length 0.3 vs 0.4 (`:391` vs `:623`); mass component packed length 0.02 and mass 0.01 vs 0.025 and 0 (`:398`, `:402` vs `:637-638`).
- Reader, `web/src/services/files/ork/importReaders.ts:154`, `:178`, `:181`, `:237`, `:283`, `:334-336`, `:449`, `:456-457`: the same literals where a tag is missing, where desktop keeps its constructor values (`BodyTube()` 8 x 0.025, `TrapezoidFinSet()`, `LaunchLug.java:35-37`, `ShockCord()`).
- `web/src/tree/kernelDefaults.ts:48-110` already holds every one of these numbers, and `web/src/services/design/componentDefaults.ts:4-11` says the reader and writer read their fallbacks from it.
- Why it matters: a part whose node lacks the key (a `.rkt` or third-party `.ork` missing the element, a workspace saved before the key existed) is flown at one size and written at another, so desktop opens a different rocket from the one simulated here. On the reader side a tag-less file flies a 30 mm tip chord here and 50 mm in desktop. The 12 mm body tube radius is the same literal the automatic-radius code was found flying in place of the kernel's 25 mm. The `fields` step of `npm run audit` does not see it because every sample is saved from the editor, which fills every key.
- Fix: every fallback in both files reads `COMPONENT_DEFAULTS` / `KERNEL_DEFAULTS` (adding the missing rows: body tube length and outer radius, trapezoid and elliptical planform, launch lug, shock cord length, mass component mass and length), and the writer emits no `<thickness>` for a tube fin set whose node has none. Test: for each part type with each key left out, build through the bridge (`getComponentFields`), write, read back, and require the read value to equal the kernel's; `fieldReadback.kernel.test.ts:215-224` already generates the "without key" seeds but compares only the panel value. VERIFIED.

### F3 (LOW) Launch-limit import notes are translated at import time and persisted

- `web/src/services/files/importBanner.ts:26-29`, called from `web/src/state/fileSlice.ts:396`: the notes are rendered to final strings with `t` and appended to `loadedMeta.notes`, which the workspace persists. Every other note is keyed (`importNote.ts:15-21`) and translated on each read.
- Why it matters: switching the UI language leaves these notes in the language the file was opened in for as long as the design exists.
- Fix: return keyed notes from `importNotes` (a field, a value and a limit, all representable as `NoteValues`) and translate at render through `importNoteText`. VERIFIED.

### F4 (LOW) Every embedded motor is written as single-use

- `web/src/services/files/ork/embeddedMotors.ts:98` writes `Type="single-use"` for every `.rse` the writer puts in the zip. `MotorSpec` carries no type; the reader's `CustomMotor.type` (`SU`, `reload`, `hybrid`) is dropped on the way to the spec (`web/src/services/motors/thrustcurve.ts:467-488`).
- Why it matters: a reload or hybrid curve imported from an `.rse` and saved into a design reopens in desktop typed single-use. Label only; the curve, mass and digest are unaffected.
- Fix: carry the type on `MotorSpec` from `CustomMotor.type` and write `Type` from it. REPORTED (writer line verified; desktop's reading of the attribute not re-run).

## 🟡 Correctness: state and engine

### S1 (MED) A file cannot be opened until the engine has loaded

- `web/src/services/files/loadOrk.ts:239` calls `resetEngine()` unconditionally, and `resetEngine` (`web/src/engine/openRocketEngine.ts:1517`) goes through `eng()` (`:42-47`), which throws `errors.engine.notReady` until the engine is active; `callEngine` (`:114-123`) rethrows a `KeyedError`. `openOrkFile`, `openExample` and the file drop (`web/src/state/fileSlice.ts:338-354`) have no engine gate; Save and Export are gated on `canSave`, Import is not.
- Why it matters: a user who opens a `.ork`, `.rkt` or bundled example in the first seconds after boot, during a slow WASM download (the "slow" notice at 15 s is exactly when people reach for their file), or on a browser where the engine failed, gets "Could not open ...: The OpenRocket engine has not finished loading" and nothing loads. On a failed engine, import is impossible for the session although the tree, the drawing and the exports need no kernel. `web/src/main.tsx:21-24` states the opposite as the app's design.
- Fix: in `loadOrk`, skip the kernel work when no engine is active (no `resetEngine`, no `buildForImport`, whose only product is the `importNote.unbuildable` probe) and let the rebuild effect build the imported design when the engine arrives (it already does, via `rebuildSeq` and `enginePhase`). Test: mock the engine module with no active engine and require `openOrkFile` to install the tree with no error. VERIFIED.

### S2 (LOW) An edit made during the first-visit load is marked as stored

- `web/src/state/useWorkspaceEffects.ts:166-171`: when `load()` resolves null, the branch calls `markWritten(...)` whether or not the design was edited while the load and the language wait ran. The rejected-load branch (`:192-197`) marks only when `untouchedSinceBoot(boot)`.
- Why it matters: an edit inside that window (the read plus up to 3 s on a first run in a non-English locale) is treated as already stored; the autosave did not fire for it (`hydrated` was false), the unload flush and the hidden-tab save skip on `unchangedSinceWrite`, and closing the tab without another edit loses the part. Rare.
- Fix: mirror the catch branch. Test: the existing "keeps an edit made before the load rejected" case in `tests/state/useWorkspaceEffects.test.tsx:221` with `load` resolving null, requiring `unchangedSinceWrite` false and a `saveSync` on `pagehide`. VERIFIED.

## 🟡 Correctness: components

### C1 (MED) Mass and distance fields have no floor in the box

- `web/src/components/design/DimensionFields.tsx:430-433`: the `mass` and `distance` kinds call `inUnit('mass', 0.0005)` and `inUnit('distance', f.step ?? 10)` with no `min`, so `parseFieldValue` clamps nothing, although `fieldRange` declares `{ min: 0 }` for both kinds (`web/src/services/design/fieldRange.ts:257-259`). Every other numeric kind feeds `fieldRange` into the box. Affected: a mass component's mass (`componentFields.ts:689`), a recovery device's deploy altitude (`:422`), a stage's separation altitude (`:408`).
- Why it matters: a typed or pasted negative lands on the node. For mass and deploy altitude the bridge throws (`ComponentFactory.dbl`, `NON_NEGATIVE`, `ComponentFactory.java:150-152`), so the design stops rebuilding behind an error banner until the field is fixed. For separation altitude the kernel keeps the value (`StageSeparationConfiguration.setSeparationAltitude` has no clamp) and the altitude trigger never fires, so the booster never separates. `fieldReadback.kernel.test.ts:229-230` takes the panel's range from `fieldRange`, not from the rendered box, so the gate probes 0 and passes while the user can type -150. The configuration-override copies floor at 0 explicitly (`DeploymentSection.tsx:90`, `SeparationSection.tsx:115`) because their comments believe the design-side field does.
- Fix: pass the range through as the `angle` case does: `inUnit('mass', 0.0005, (fu) => fu.toUi(fieldRange(node, f).min ?? 0))`, same for `distance`. Test: render `FieldRow` for every kind and assert the box's `min` equals `fieldRange(...).min`, so the gate checks the box the user sees. VERIFIED.

### C2 (withdrawn) The canopy sizing dialog and Auto on the drag coefficient

- Reported as: `web/src/components/design/RecoverySizingReadout.tsx:89` reads the stored Cd and ignores `cdAuto`, so the dialog solves the diameters for a typed Cd while the flight uses the kernel's automatic one.
- Withdrawn: a parachute's automatic Cd is its stored Cd. `RecoveryDevice.getCD` takes `getComponentCD` when automatic (`RecoveryDevice.java:50-54`), and `Parachute.getComponentCD` returns the stored `cd` (`Parachute.java:80-82`); only a streamer computes one (`Streamer.java:140-144`). The dialog is parachute-only, so the Cd it reads is the Cd the kernel flies, Auto or not, and the bridge confirms it (`componentInfo.cd` is 1.5 for `cd: 1.5, cdAuto: true`). The audit applied the streamer rule to a parachute.
- Kept: a kernel pin, `web/tests/components/design/RecoverySizingReadout.kernel.test.tsx`, holds the dialog's diameters to the Cd the bridge reports, so the dialog needs the kernel read the day the kernel starts estimating a parachute Cd; and the comment at `RecoverySizingReadout.tsx:84-89` states the constraint.

## 🟡 Accessibility

### A1 (MED) Failure lines in the library and part dialogs are never announced

- `web/src/components/common/MasterDetail.tsx:109-114` (`MasterStatus` mounts a `role="status"` element together with its text, which the codebase's own rule says is not announced: `UpdateToast.tsx:240-245`, `LaunchPanel.tsx:423-429` and `LocationPicker.tsx:187-192` keep the region mounted and empty for this reason); plain colored text with no live region at `web/src/components/design/FreeformFinActions.tsx:144`, `MaterialPicker.tsx:307`, `:308`, `:345`, `ComponentPicker.tsx:622`, `SavePartButton.tsx:93`, `SavedPartEditor.tsx:148`.
- Why it matters: a screen reader user who saves a part, adds a material, deletes a saved part or imports a fin image and hits a storage or parse failure hears nothing and leaves believing the write landed. These dialogs' only feedback channel is that line.
- Fix: render each as a permanently mounted `role="status" aria-live="polite"` element whose text comes and goes (the `UserKeyField` pattern), or `role="alert"` for the one-shot failures; for `MasterStatus` always render the `<p>` and put the text inside it. VERIFIED (code); the announcement behavior is the project's documented rule, not re-measured.

## 🟡 Correctness: geometry and design services

### G1 (LOW) A negative root chord throws instead of drawing the zero-chord fin the kernel flies

- `web/src/tree/finPlanform.ts:457` computes `divisions = Math.min(100, Math.ceil(interval / 0.0025))` from the unclamped stored chord; for a chord at or below -2.5 mm on a canted fin or a curved parent the loop runs zero times, `points` is empty and `:477` throws on `points[points.length - 1]![0]`. The kernel flies such a chord as `Math.max(r, 0)` (`TrapezoidFinSet.java:90`) and samples one point (`FinSet.java:1181-1203`).
- Why it matters: every drawing and cut reader (schematic, 3D, DXF, STL, PDF template, side view) goes through this function, so the throw takes the view down. Reach is narrow: the panel floors length fields at 0, the `.ork` reader clamps (`nonNegTag`) and the `.rkt` reader uses `mmPos`, so only a stored workspace or a hand-built tree carries a negative chord.
- Fix: floor the chord as the kernel does. Test: build a `rootChord: -0.01` trapezoid through the bridge and compare `getComponentGeometry().rootPoints` with `finRootPoints`. VERIFIED (mechanics), REPORTED (reach).

### G2 (LOW) A keyless tube fin set on a filled body tube flies a hollow wall

- `web/src/services/design/autoRadius.ts:862` takes `num(parent, 'thickness', ...)`, the stored wall key, whatever the tube's `filled` flag. The kernel hands it `getThickness()` (`BodyTube.java:583-591`), which returns the tube's radius when filled (`SymmetricComponent.java:104-108`), and `TubeFinSet.setThickness` clamps that to the fin tube's own radius (`TubeFinSet.java:201`): solid tube fins.
- Why it matters: on a filled body tube the app stores a 2 mm wall and the bridge flies it (`applyWallThickness`, `ComponentFactory.java:991-995`), so the fins fly hollow and lighter than desktop and the kernel make them, and the panel, the drawings and the `.ork` all state that wall. Rare.
- Fix: in `parentDerived`, when the parent is filled take its radius (as `autoShoulder.solidWall` does). Test: build the pair with no `thickness` key and read `getComponentFields(...).thickness` back from the bridge. VERIFIED.

## 🟠 Reference data and its pipeline

### R1 (HIGH) The published catalog lacks what the pipeline in this tree produces

- The `data` branch (commit 30104db, 2026-10-12, "Refresh both catalog(s) from 88f678a") was written by the pipeline at `origin/master` 88f678a (2026-10-10). That pipeline holds `sync-preset-digests.mjs` but not `check-catalog-digests.mjs` or `lib/digestCoverage.mjs`, and the changes in this tree to `sync-catalogs.yml`, `sync-components.mjs` and `sync-preset-digests.mjs` (753 insertions against `origin/master`) have not run against what is live. The workflow (`.github/workflows/sync-catalogs.yml:27-31`) runs only on the Monday schedule and by hand.
- Compared: published components 5231 rows, manifest `946607917f50` (matches the file); committed 5228 rows, `737cdeea8882` (matches); `PresetDump` on the pinned 24.12 jar reports 5228 and the committed per-type counts equal it exactly. The published copy has 123 rows with no digest (bodytube 23, nosecone 8, parachute 20, tubecoupler 15, centeringring 36, transition 8, launchlug 9, railbutton 4) against 0 committed; 3 digests each carried by two rows of different size (BalsaMachining T5Plus-34 at OD 14.86 mm and 13.82 mm; Rocketarium 1.6" bulkplate at OD 29.06 mm and 38.00 mm; Always Ready Rocketry BT20-139C at 304.8 mm and 406.4 mm) against 0 committed, which `partProblems` (`scripts/lib/digestCoverage.mjs:70-74`) now refuses; 12 rail buttons where desktop holds 8; 612 transitions where desktop holds 613; 0 of 422 parachutes carry line count, line length, packed size or materials (committed: 402); 0 rows carry `legacy` (committed: 1544), so the picker's legacy filter (`services/parts/componentFilter.ts:332`) shows every legacy part. Motors: 1156 rows both sides, but 138 rows' digest lists differ in content or order, and the `.ork` writer takes the first entry where the delay does not decide. The branch still carries `materials.generated.json` (indented) and `contributors.generated.json`, which the workflow in this tree removes (`:224`).
- Why it matters: a user of the deployed app who picks one of the 123 undigested parts saves an `.ork` whose preset link is left out; one who picks the 13.82 mm T5Plus-34 saves the 14.86 mm preset's digest and desktop loads that diameter over the part; every parachute picked today flies with the default lines and canopy material; a motor digest can name a different desktop entry than the app flies.
- Fix: when the pipeline changes reach master, dispatch the workflow the same day (target `both`). Add a `push: branches: [master]` trigger with `paths:` for `web/scripts/**` and the workflow file, keeping the `concurrency` group, so a pipeline change republishes when it lands instead of waiting up to seven days. VERIFIED (counts and hashes derived by the slice agent from the live branch and the local 24.12 jar; the cause corrected by the lead against `origin/master`).

Checked and in order: the database pin equals OpenRocket's own submodule at `release-24.12`; the jar SHA-256 is pinned and checked, the workflow reads the same pin file and pins every action by commit; the workflow runs every catalog step `sync:all` runs except the three build-side ones (`remoteData.ts` `BUILD_ONLY`); both digest steps, materials and contributors refresh the manifest after the write and write compact JSON; a refresh with no data change produces identical bytes and publishes nothing; committed and published manifest hashes equal their files; stated masses follow `ComponentPresetFactory` and each `loadFromPreset`; materials are looked up in the part's own file first; parts sharing a part number stay separate rows; motor digests are desktop's own `ThrustCurveMotor.getDigest()`, and the 121 undigested motors have no 24.12 entry under the same maker, designation and diameter; both `KNOWN` lists are checked both ways.

### R2 (LOW) Two parachute presets that differ only in lines or materials collapse into one row

- `web/scripts/sync-components.mjs:206-211` drops a row whose JSON equals an earlier one, and `:277-281` pushes a parachute with only type, maker, part number, description, diameter and Cd, so two desktop presets that share those six and differ in line count, line length, packed size or materials become one row, and the second preset's digest is never offered. `PresetDump` shows no such pair in 24.12 today.
- Fix: include the fields the digest step later overwrites in the parachute dedup key, or dedupe after the digest step by digest. VERIFIED (code), no current instance.

## 🟠 Architecture and tooling

None at any severity. knip is clean; every `web/scripts/lib` module is imported by a script and every script is named by a `package.json` entry; the lint blocks resolve where the config says; every `jsx-a11y-x` disable states its reason; the axe scan keys its view, pane, tool and theme lists on the app's own union types so a new member fails the typecheck, and scans every dialog, popup, part editor, banner and result state in all three themes and again on the phone project; the other nine locale files match `en.json` key for key with no garbled characters and no English left untranslated; every gate's scope matches its claim.

## 🟢 Dead code

None. The nine names in `srcExportReach.test.ts` `BASELINE` are test-only exports (intentional); `import './kernelLogSink.js'` is the side-effect import.

## Gaps in the mechanical checks

Not defects: rules with no kernel oracle today. Each is a design the generators never build or a flag they never set.

- `geometryParity.kernel.test.ts`: no mass object with `radiusAuto` inside an inner tube or coupler (`MassObject.getMaxParentRadius`'s ring branch vs `autoRadius.ts:882`, `:721`); no ring inside a ring except an engine block in an inner tube (`ringOuter`'s `isAutoRing(host)` recursion, `autoRadius.ts:568`, and the pre-order `syncAutoRadii` depends on, `:962-968`); no tube fin set without a `thickness` key and none on a filled tube (G2 lives there); no keyless ring outer radius or centering ring bore (`KEYLESS_AUTO_OUTER`, `autoRadius.ts:898`, `:929-931`; `ringBoreAuto`, `:840-841`); no inner tube inside a nose cone or transition (`Transition.isCompatible` allows it, `canHost` offers it); no fin set with a stored `rootChord`, `height`, `tipChord` or `sweep` of exactly 0 or below (G1 lives there); every ring is generated automatic, so a fixed ring whose bore exceeds its outer radius (`settleRingBuild`, `linkedDimensions.ts:135-142`) is never compared.
- `geometryFlags.test.ts`: `READERS` (`:105-152`) lacks `services/files/rasaero/sustainer.ts` (reads `flipped`) and `services/parts/componentFit.ts` (reads `stationRadius`/`profileEnds`); `FIN_FLAGS` (`:509-561`) measures only the freeform fin, never a trapezoid or elliptical set on the filled tube case nor a tube fin set; `FLAGS` (`:207-269`) toggles `shapeParameter` on ogive and power only, never haack (range 0 to 1/3) or parabolic.
- `fieldReadback.kernel.test.ts`: every part other than the airframe parts is hosted in a 50 mm body tube, so no field is read back inside a nose cone, transition, inner tube or coupler; `SEEDS` has no flipped nose cone (`settleFlippedShoulders`, `ComponentFactory.java:1026-1038`), no `filled` part, and no mount with `motorMount`/`motorOverhang` set.
- `catalogPatch.kernel.test.ts`: every row is picked onto `defaultNode(type)`, never onto a flipped nose cone (`NoseCone.loadFromPreset` clears the flip, loads, then restores it) or a part already carrying a shoulder (`presetShoulder`'s `hadShoulder` branch, `treeEdit.ts:573-577`).
- `finBodyPoint` (`finPlanform.ts:598-607`, the cant-then-roll placement every 3D and aft reader uses, port of `FinSet.java:1775-1796` and `Transformation.java:263-287`) has no test; the bridge reports fin points in the fin's own frame. The curved-parent branch of `cantYOffset` (`:433`) reaches the kernel only through the edges test's canted-on-a-nosecone rule, which skips every station where the kernel answers NaN.
- Tests of ported math that pin the app's own number: `tests/services/design/finTabAuto.test.ts` (34 hand-typed values for the port of desktop's `FinSetConfig.computeFinTabLength`; the swing module is not vendored and the kernel has no such method, so run the six cases through the 24.12 jar and write the results in with their source); `tests/services/flight/windLevels.test.ts:69-112` (`padLevelWind`, hand-typed vectors; the oracle is a flight's first wind samples under the same profile); `tests/services/flight/recoverySizing.test.ts:78`, `:85`, `:148`, `:153` (four hand-typed densities already covered by `tests/engine/atmosphereProfile.test.ts:119-185`).

## Upkeep

No severity. Grouped by rule, every site listed.

### A comment states something untrue or out of date

- `web/src/tree/nodeProps.ts:95` and `:102` say the bridge's body tube and nose cone default radius is 0.012 m; `KERNEL_DEFAULTS` and `ComponentFactory.java:169`, `:295` are 0.025 m. The 12 mm figure is the fallback the automatic-radius fix replaced; a reader taking the comment at its word would reintroduce it.
- `web/src/tree/schematicGeometry.ts:342-345` say the mass component default radius is 0.005 and the kernel flies it at 5 mm; the factory reads 0.0125 (`ComponentFactory.java:639`). `:355` says a mass component with no length is drawn at 20 mm; the default is 0.025 m (`:638`).
- `web/src/services/design/discGeometry.ts:27-28` says the kernel gives a coupler 0.5 mm and a body tube 0.3 mm; both are 2 mm (`kernelDefaults.ts:55`, `:68`; `ComponentFactory.java:296`, `:457`). Only the inner tube is 0.5 mm.
- `web/src/services/design/treeEdit.ts:854` cites `FinSet.java:107` for the 0.003 wall; the field is at `:111`.
- `web/src/services/design/componentDefaults.ts:4-11` says the `.ork` reader and writer read their fallbacks from this table; they hold the literals listed in F2.
- `web/src/services/files/importNote.ts:12-13` says a plain-string note is "a note the app translated when it made it"; the rule keeps plain strings only for workspaces saved before notes were keyed, and `importBanner.ts` is the one producer of new ones (F3).
- `web/src/main.tsx:21-24` says the `.ork`/`.rkt` paths need no engine; the import path resets and builds in the kernel (S1).
- `web/src/globals.d.ts:3` documents `__HELP_URL__` as the repository plus `/wiki` or the `HELP_URL` override; `vite.config.ts:45` reads `package.json` `wiki.url` first, which is the shipped value.
- `web/src/engine/simClient.ts:418-419` says `simulateInWorker` rejects with the engine message or `SimTimeoutError`; it also rejects with `SimCanceledError`, which `store.ts:1613` depends on.
- `web/src/components/config/DeploymentSection.tsx:84-85` and `SeparationSection.tsx:111` say the design-side altitude field is floored at zero; it is not (C1).
- `web/src/components/canvas/AftView.tsx:53-55` says cluster layout, rotation and spacing are edited in the motor dialog; they are fields of the inner tube's panel (`componentFields.ts:585-588`).
- `web/src/components/canvas/rocketPieces.ts:309` carries a bare 0.5 mm fallback for a tube fin wall with no comment; the rule for a keyless wall is the parent's (`autoRadius.ts:855-862`) and the kernel has no default of its own.
- `web/src/components/canvas/schematicShapes.tsx:328-331`, `:631`, `rocketPieces.ts:287-290`, `:342`, `AftView.tsx:213-216`, `:394` explain `surfaceAt` for lugs, rail buttons, tube fins and fairings as a tapered-parent rule; none of those parts can have a cone for a parent (`Transition.java:910-917`, `treeEdit.ts:380-382`), and the kernel's lug rule on a cone (`LaunchLug.java:212`, max of the two end stations) would not match `surfaceAt` if it could apply.
- `web/scripts/check-catalog-digests.mjs:5-6` says the publish step copies every catalog in `public/data`; it copies motors and components only (`sync-catalogs.yml:220-224`).
- `web/scripts/sync-components.mjs:203-205` says only a row identical in every field is dropped; not for parachutes (R2). `docs/DEVELOPER.md` repeats it in the staging paragraph.

### A comment or test title narrates history, or a disable states no reason

- Nothing in `web/src` beyond what `commentsStateTheConstraint.test.ts` already checks. The gate's file list leaves out authored code under `website/` (`docusaurus.config.ts`, `sidebars.ts`) and `engine-java/` (`audit.mjs`, `build-engine.mjs`, `gradle-exec.mjs`, `extract/extract.mjs`, `build.gradle`, `validation/score.mjs`); a grep of its patterns over those files finds nothing today, so this is a gap in the gate, not a defect.
- `web/tests/state/saveFiguresVintage.kernel.test.ts:37` carries an `eslint-disable-next-line @typescript-eslint/no-explicit-any` with no reason; its twenty siblings say "the TeaVM bundle is untyped".

### A duplicated helper, formula or list

- Drifted: wheel zoom factor `web/src/components/canvas/TreeSchematic.tsx:53` (1.2) and `AftView.tsx:62` (1.15), both feeding `useWheelZoom`, whose docblock says it exists so the two cannot drift; one constant beside `MAX_ZOOM` in `tree/schematicGeometry`.
- Drifted: `kernelDefault(type, key)` at `web/src/tree/scaleRocket.ts:186-189` (absent key returns `undefined`) and `web/src/services/exports/solidMesh.ts:440-443` (returns `NaN`); `kernelDefaults.ts` exports `kernelLength` for the key both mostly want.
- Drifted: XML entity decoding at `web/scripts/sync-components.mjs:59-65` (named and numeric references) and `web/scripts/sync-examples.mjs:98-104` (five literal replaces, `&#39;` only); a `&#8217;` in an example comment survives as entity text in the second.
- Drifted: the secondary tool button class string at `web/src/components/tools/SiteFields.tsx:13-14` and `web/src/components/sim/WeatherDialog.tsx:55-56` (identical), `WindProfileDialog.tsx:60`, `tools/SizingFigures.tsx:26-27` and `design/ScaleDialog.tsx:107` (each different), while `common/DialogButton.tsx` `secondary` exists.
- Drifted: the calculation and simulation method rows at `web/src/components/layout/SettingsTabs.tsx:279-280` (div/span) and `web/src/components/sim/SimEditor.tsx:256-265` (`<dl>`).
- Drifted: `e2e/a11y.spec.ts:131-144` `answerOpenMeteo` vs `e2e/weather.spec.ts:22-38` (the latter records each request); `scripts/check-offline-help.mjs:53-71`, `check-update-flow.mjs:59-77`, `check-offline-data.mjs:124-143` each hold their own `serve()` and build step; `tests/commentsStateTheConstraint.test.ts:73-90` and `tests/noEmDash.test.ts:47-77` copy `slashed` and `walk` with different skip lists.
- Not yet drifted: `exportSimulation.ts:109-117` `DESKTOP_SIM_PREFS` repeats `storage/settings.ts:478-488` number for number; `exportWriters.ts:374-377` writes the stock line material as a literal that repeats `KERNEL_MATERIALS.line`, which `exportParts.ts:118-129` already writes from the table; the seconds symbol is hard-coded at `sim/MotorRow.tsx:96`, `:206` and `MotorSpecDialog.tsx:40` where every other row uses `t('units.second')`; the `clipped` flag reader is copied at `schematicGeometry.ts:148`, `shapeProfile.ts:326`, `solidMesh.ts:472`, `reportGeometry.ts:63`, `:177`; the `tabOffsetMethod` reader with its `'middle'` default at `finPlanform.ts:287` and `axialRebase.ts:119`; the lost/gone digest report at `sync-motor-digests.mjs:158-167` and `sync-preset-digests.mjs:326-335`; `shortName` at `check-ork-opens.mjs:199` and `check-desktop-fields.mjs:542`; a local `Stat` dt/dd row at `tools/OffTheRail.tsx:350-357` beside `common/TermRow.tsx` and `sim/MotorDetail.tsx:194-201`; scan-open sequences copied from feature specs into `a11y.spec.ts` (`:94-117`, `:435-446`, `:595-602`, `:1187-1195`).

### User docs that state something the app does not do

- `docs/ARCHITECTURE.md:128` says the committed catalog copy is the fallback when the data host is unreachable; a data-host build leaves the two hosted catalogs out and reads them from the host and nowhere else (`remoteData.ts:22-25`, `vite.config.ts:91-100`), as `ARCHITECTURE.md:191` and `DEVELOPER.md:158` state. `docs/AUDIT_PROMPT.md:29` repeats the fallback claim.

## Recommended order of attack (as planned before the resolutions below)

1. C1: pass `fieldRange` into the mass and distance boxes, and add the `FieldRow` min assertion. Two lines plus a test.
2. C2: read the kernel's Cd when Auto is on in the sizing dialog, pinned by a bridge test.
3. G2: take the parent's radius for a keyless tube fin set on a filled tube, pinned by a bridge test. One branch.
4. F1: route deploy and separation events through `enumTag` with a keyed note, on the design and the configuration overrides.
5. F2: point every reader and writer fallback at `COMPONENT_DEFAULTS` / `KERNEL_DEFAULTS`, drop the tube fin `<thickness>` for a keyless node, and add the keyless write/read/bridge round trip test. Mechanical but touches every part type.
6. S1: skip the kernel work in `loadOrk` when no engine is active, and let the rebuild effect build the import when the engine arrives. Fix the `main.tsx` comment with it.
7. A1: make the seven failure lines live regions that stay mounted.
8. S2, F3, F4, G1, R2: each one small; take them in that order.
9. R1: dispatch the catalog workflow once the pipeline changes reach master, and add the push trigger.
10. Upkeep: the comment corrections first (nodeProps, schematicGeometry, discGeometry, componentDefaults, importNote, DeploymentSection, SeparationSection, AftView, globals.d.ts, simClient, check-catalog-digests, sync-components, ARCHITECTURE.md), then the wheel zoom and `kernelDefault` duplicates, then the rest as the files are touched.
11. Mechanical check gaps: extend the geometry parity generator (mass objects in rings, rings in rings, keyless tube fin walls, inner tubes in cones, sub-zero fin dimensions), add the two readers to `geometryFlags`, seed a flipped and a filled part in `fieldReadback`, and replace the hand-typed `finTabAuto` values with the 24.12 jar's.

## Resolutions (same day)

Every finding above was fixed on the tree this report describes, each with a test whose expected value comes from the kernel through the bridge, from the Java, or from desktop semantics, and each new test was run against a scratch copy of the pre-fix tree and failed there. The gates were rerun on the fixed tree; see the end of this section.

- **F1**: `importTags.ts` maps both events through `enumTag` from `DEPLOY_EVENTS` and `SEPARATION_EVENTS`; an unknown token is dropped with the keyed notes `importNote.deployEventUnknown` / `importNote.separationEventUnknown` (en and the nine other locales), on the design and in each configuration override (`importConfigs.ts`). `rktImport.ts` reads no event, so it has no such hole. Pinned by `tests/services/files/ork/eventUnknown.kernel.test.ts` (expected events from the bridge on the same file with the tags removed). Pre-fix: `expected 'bogus' to be undefined`.
- **F2**: `componentDefaults.ts` carries every fallback the readers and writers use, re-exported from `KERNEL_DEFAULTS` with the desktop constructor cited per row; `exportWriters.ts` and `importReaders.ts` read it, and the tube fin writer emits no `<thickness>` for a node without one (desktop 24.12's `TubeFinSet()` starts at NaN and `BodyTube.addChild` hands it the tube's wall, as the kernel does; checked with `javap` on the jar). Pinned by `tests/services/files/ork/keylessRoundTrip.kernel.test.ts` (expected values from `getComponentFields`). Pre-fix: 13 misses, e.g. `bodytube.outerRadius: read 0.012, kernel 0.025`. The export golden moved only where the fix moved it.
- **F3**: `importBanner.ts` returns keyed notes; `safetyLimits.ts` gained `limitNote`, which `limitText` renders, so the key choice is in one place; `fileSlice.ts` passes the launcher kind instead of a bound `t`. Pinned by `tests/services/files/importBanner.test.ts` ("renders in the language the banner is read in, not the one the file was opened in"). Pre-fix: `TypeError: t is not a function`.
- **F4**: `MotorSpec.type` (optional, so stored workspaces load) carries `CustomMotor.type`, and `embeddedMotors.ts` writes `Type` as single-use, reloadable or hybrid, omitting it when unknown (desktop's `RockSimMotorLoader` then infers from the manufacturer). Pinned by `tests/services/files/ork/embeddedMotorType.test.ts`. Pre-fix: `expected 'SU' to be undefined`.
- **S1**: `loadOrk.ts` resets and probe-builds only when `engineActive()` (new predicate in `openRocketEngine.ts`); without an engine the parsed tree is installed and the rebuild effect builds it when the engine arrives. Pinned by `tests/services/files/loadOrk.noEngine.test.ts` and the end-to-end case in `tests/state/useWorkspaceEffects.test.tsx` ("opens a file before the kernel has loaded, and builds it when the kernel arrives"). Pre-fix: `KeyedError: The OpenRocket engine has not finished loading`.
- **S2**: the empty-load branch marks the workspace written only when `untouchedSinceBoot(boot)`. Pinned by `tests/state/useWorkspaceEffects.test.tsx` ("keeps an edit made before an empty load resolved, unwritten"). Pre-fix: `expected true to be false` on `unchangedSinceWrite`.
- **C1**: the `mass` and `distance` boxes take `fieldRange(node, f).min` in the field's unit. Pinned by `tests/components/design/DimensionFields.floor.test.tsx` (one row per numeric field of every type; expected floor from `fieldRange`). Pre-fix: `stage.separationAltitude`, `parachute.deployAltitude`, `streamer.deployAltitude`, `masscomponent.mass`, `parallelstage.separationAltitude` each `expected '' not to be ''`.
- **C2**: withdrawn, see its entry.
- **A1**: the seven failure lines are permanently mounted `role="status" aria-live="polite"` elements whose text comes and goes. Pinned by `tests/components/design/failureLiveRegions.test.tsx` (region present and silent before the refused write, then holding the message). Pre-fix: `Unable to find an accessible element with the role "status"` and `expected undefined to be defined`.
- **G1**: `finRootPoints` samples a chord below zero as zero, citing `TrapezoidFinSet.java:90`. Pinned by `tests/tree/finRootChordFloor.kernel.test.ts` (root and outline against `getComponentGeometry` at the zero chord the bridge accepts). Pre-fix: `TypeError: Cannot read properties of undefined (reading '0')`.
- **G2**: `parentDerived` gives a keyless tube fin set on a filled tube the tube's radius as its wall, clamped to the fin tube's own radius as `TubeFinSet.setThickness` clamps it. Pinned by `tests/services/design/tubeFinWallFilled.kernel.test.ts` against `getComponentFields().thickness`. Pre-fix: `expected 0.002 to be close to 0.025`.
- **R1**: `sync-catalogs.yml` also runs on a push to master that changes `web/scripts/**` or the workflow, defaulting to both catalogs; `tests/ciTriggers.test.ts` pins the trigger. The republish itself happens when the pipeline changes reach master.
- **R2**: `scripts/lib/partRows.mjs` keys a parachute row on its canopy plus the line count, line length, packed size and materials the digest step fills in; `sync-components.mjs` and `sync-examples.mjs` share `scripts/lib/orcText.mjs`. Pinned by `tests/scripts/partRows.test.ts`. Pre-fix (the old JSON-only key in the scratch copy): `expected [...] to have a length of 2 but got 1`.
- **Upkeep**: every comment listed above is corrected; `WHEEL_ZOOM_FACTOR` (1.2) in `tree/schematicGeometry.ts` serves both drawings; `kernelDefault` is exported once from `tree/kernelDefaults.ts`; `DESKTOP_SIM_PREFS` is `DEFAULT_SETTINGS.simulation`; the seconds symbol comes from `t('units.second')`; the XML entity decoder lives in `scripts/lib/orcText.mjs`; `check-catalog-digests.mjs`, `ARCHITECTURE.md`, `DEVELOPER.md` and `AUDIT_PROMPT.md` state what the pipeline does; the disable in `saveFiguresVintage.kernel.test.ts` states its reason. The parachute line material row in `exportWriters.ts` stays a table read from `KERNEL_MATERIALS.line` because its tag is `<linematerial>`, not `<material>`.
- **Mechanical check gaps** closed by the fixes: a tube fin set without a wall key on a filled tube (G2's test) and a fin set with a chord at or below zero (G1's test). The rest of that section stands.

Gates on the fixed tree, run locally:

| Gate | Result |
| --- | --- |
| `npm run verify` in `web/` | pass; 586 test files, 7191 tests |
| `npx playwright test` in `web/` | pass; 543 of 544 on the first run, the one spec that read the stored note as English text rerun green after it was pointed at the note's key |
| `npm run audit` in `web/` | pass; all five steps, fields 0 new differences, 46 known, 0 stale |
| `npm run audit` in `engine-java/` | pass before the fixes; the fixes touch no file under `engine-java/` |

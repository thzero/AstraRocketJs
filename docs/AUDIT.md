# AUDIT - `web/` engineering audit

<!-- cspell:ignore SEMROC Rocketarium Maadcow Madcow BalsaMachining SNRB LNRB FlisKits FWCF Hypertek Trayectoria Datos Ámbito Campo Valor Unidad Siguiente Traza tierra sobre terreno Lateral Trasera Escala Escalar cohete Informe diseño dconst letterboxed puntos plataforma eyección Sitio lanzamiento -->

**Date:** 2026-10-15. **Tree:** `dev` at 9283a0e plus the uncommitted working tree (the fixes from the previous run), audited as it stands on disk. **Method:** `docs/AUDIT_PROMPT.md`, eleven parallel slice agents (slice 1 and the components outside `canvas/` split by subfolder), plus docs agents covering every page under `website/docs/` and its Spanish twin. A fresh read: no agent saw the previous report. The lead checked every HIGH and every MED marked "confirmed" against the source, the Java or the published data.

## Summary

| Severity | Count |
|---|---:|
| HIGH | 1 |
| MED | 23 |
| LOW | 31 |
| **Defects** | **55** |

Security: one LOW (L26, reported). Dead code: none (knip is clean).

**Status (2026-10-15):** every MED and LOW is fixed, each with a test that fails without the fix, as are the upkeep comments and docs. H1 is open: it needs this tree's catalog workflow run against the data branch. Gates after the fixes: `npm run verify` (565 files, 6870 tests), `npm run audit` in web (desktop 0 new warnings, fields 0 new differences) and engine-java, `npx playwright test` (544), `npm run e2e:offline-data`, `npm run docs:build` and the website typecheck all pass.

Two MED findings are regressions of fixes made in the previous run: M6 (the Combine pane's kernel statistics fail for most clusters) and M18 (pruning overrides equal to the part's values also drops real desktop overrides).

### Gates, run locally on this tree

| Gate | Result |
|---|---|
| `npm run verify` (web) | pass. format, spell, typecheck, lint, knip, dupes, vite build; vitest 529 files, 6321 tests |
| `npm run audit` (web) | pass, 5/5. coverage, samples, desktop (0 new warnings, 4 known, 0 stale), fields (0 new differences, 25 known, 0 stale), helpers |
| `npm run audit` (engine-java) | pass, 5/5 |
| `npx playwright test` (whole suite) | pass, 529 tests |

Every gate is green. M15 explains why the desktop steps cannot see the simulation-conditions defects.

### `KNOWN` lists

- `web/tests/engine/fieldReadback.kernel.test.ts`: empty.
- `web/scripts/check-desktop-fields.mjs`: 25 entries, each a RockSim format limit or a RockSim reader rule stated in words.
- `web/scripts/check-ork-opens.mjs`: 4 entries, stated in words.

No entry cites a finding ID, so there are no citations to rewrite.

---

## 🟡 Correctness

### H1. The published parts catalog is not what this tree's pipeline produces

- **Where:** the `data` branch `components.generated.json` (stamp 2026-10-12T06:48:57Z, "Refresh both catalog(s) from 88f678a") against `web/public/data/components.generated.json`.
- **What the published copy holds:**
  - 5,231 rows, 123 with no digest (centering rings 36, body tubes 23, parachutes 20, couplers 15, launch lugs 9, nose cones 8, transitions 8, rail buttons 4);
  - 4 rail buttons desktop 24.12 does not have (BalsaMachining and Rocketarium SNRB, LNRB);
  - wrong geometry: Rocketarium "BT-60, White" tubes at 102.2 mm OD (desktop 41.58 mm), Madcow FWCF-54C couplers at 38.6 mm OD (desktop 54.6 mm), five BalsaMachining CR50xx rings at 31.4 mm OD (desktop 32.6 mm), the Estes 72653 nose cone with a 0.125 m wall;
  - FlisKits EB-2.5 at density 0;
  - no line, pack or material fields on any of the 422 parachutes;
  - literal `&gt;` in 23 descriptions, "Maadcow" for Madcow, and 612 transitions against 613.
- **What this tree produces:** seeded from the published files, this tree's workflow sequence (sync-components, sync-preset-digests, check:digests) writes a catalog identical to the committed copy, with 5,228 of 5,228 rows carrying a digest.
- **Effect:** every saved `.ork` drops the part link for those 123 parts, and users pick tubes and couplers at the wrong diameter.
- **Fix:** run this tree's catalog workflow against the data branch, then fetch the branch again and compare.
- **Status:** confirmed by the lead (123 of 5,231 rows without a digest, counted on the fetched file).

### M4. The custom-material density box names the wrong unit and quantity

- **Where:** `web/src/components/design/MaterialPicker.tsx:327-335`.
- **What:** the box label is `material.densityPlaceholder` ("Bulk density (kg/m³)" in every locale) followed by the unit the box actually reads, `fu.sym`. A canopy's box reads "Bulk density (kg/m³) (g/m²)", a cord's "... (g/m)".
- **Effect:** a user typing a kg/m² figure into a box that reads in g/m² saves a canopy 1000 times too light, and only the bulk path has a ceiling to catch it.
- **Fix:** one key per material type with no unit inside it, then the unit symbol.
- **Status:** confirmed by the lead.

### M5. Deleting a custom material also clears it from the selected part

- **Where:** `web/src/components/design/MaterialPicker.tsx:204-236` (`onChange(undefined, 0)`), pinned by `tests/components/design/MaterialPicker.test.tsx:72-97`.
- **What:** the confirmation says the material "will no longer be offered on any design". It then removes it from the selected part, which falls back to the stock density, while other parts using it keep it. A custom entry that shadowed a built-in of the same name drops the part to no material at all. Desktop's material database delete does not touch components.
- **Fix:** leave the part's name and density; the existing "From this part" path shows it.
- **Status:** confirmed by the lead.

### M6. The Combine pane's burn time and average thrust are a dash for most clusters

- **Where:** `web/src/components/sim/MotorCombinePane.tsx:99-110`, `web/src/services/motors/motorCombine.ts:91-101`.
- **What:** the pane sums the raw catalog samples and sends the sum to `motorStatistics`. 881 of the 1,063 bundled curves start after t = 0, and so does their sum. `ThrustCurveMotor.Builder.build` refuses that curve ("Curve starts at time", `ThrustCurveMotor.java:232-233`), so `motorStatistics` returns null and the dash stays. The total impulse is also summed from curves the kernel does not fly (no (0, 0) point).
- **Regression:** introduced by the previous run's Combine fix. Its test uses a curve that starts at 0.
- **Fix:** run each curve through `finalizeSamples` before `combineCurves`, and add a test with a curve that starts after 0.
- **Status:** confirmed by the lead.

### M7. "Use" in the locations library applies to the active simulation from every entry point

- **Where:** `web/src/components/sim/LocationsDialog.tsx:98-105`, opened by `LocationPicker.tsx:232-238`.
- **What:** `apply` always calls `patchActiveLaunch`. The picker also opens the dialog from Settings > Launch defaults and from the tools' site fields. There, "Use" rewrites the active simulation's site, off screen, and leaves the field being edited unchanged, while the dialog closes as if it worked.
- **Fix:** an `onApply` the picker passes; the menu entry keeps `patchActiveLaunch`.
- **Status:** confirmed by the lead.

### M11. A custom motor is saved under a stock motor's digest, so desktop flies the stock motor

- **Where:** `web/src/services/motors/exportMotors.ts:114-125`, `web/src/services/motors/motorDb.ts:490-496` (`findCatalogMotor`).
- **What:** `fillMotorDigests` finds the row with `findCatalogMotor`, which returns `matchCatalogMotor`'s motor and discards its doubts. The manufacturer only breaks ties, and a shortened name ("H128W-OLD" to H128) still matches. The only check is diameter within 1 mm. On a match, the catalog digest is written and the seated curve is not embedded.
  - A "Homemade G80" at 29 mm gets AeroTech G80's digest.
  - A spec with no manufacturer named "C6" gets the first equal-name row, Quest C6.
- **Effect:** desktop's `findMotors` puts digest matches first whatever the maker (`ThrustCurveMotorSetDatabase.java:42-76`), so it opens the file flying a stock motor, and the user's curve is gone from the file. The same-maker, same-name case (a user's own curve for Estes C6) is the narrower form of this, and its current behavior is pinned by `motorDigests.test.ts` as intended.
- **Fix:** accept a catalog row only with no doubt from `matchCatalogMotor` and a manufacturer `sameMaker` accepts; otherwise embed the seated curve. Test against desktop's `findMotors` rule for a maker mismatch and a shortened name.
- **Status:** confirmed by the lead.

### M12. The side and aft views do not turn a pod or booster instance's children by the instance angle

- **Where:** `web/src/components/canvas/schematicShapes.tsx:208-215`, `:336-345`; `web/src/components/canvas/AftView.tsx:196-208`, `:218`.
- **What:** each instance is placed at its ring angle, but fins, tube fins, lugs, rail buttons and internal offsets inside it keep their own angle. The kernel builds each instance as translate then `getAxialRotation(angle)`, inherited by its children (`FlightConfiguration.java:456-462`, `PodSet.java:66-76`, `RocketComponent.java:1660-1690`). The app's 3D view already rotates (`rocketPieces.ts:401-405`).
- **Effect:** two boosters at 0° and 180° with three fins each show both fin sets the same way up in the aft view, the one view meant for checking this.
- **Fix:** carry an accumulated instance angle through the side and aft walks; test against kernel instance transforms.
- **Status:** confirmed by the lead.

### M13. A save-conflict warning is never cleared, and a "storage full" warning erases a standing degraded notice

- **Where:** `web/src/state/store.ts:1008-1012` (`clearSaveWarning` clears only `full`), `:929-963` (`replaceWorkspace`), `web/src/state/workspaceSelectors.ts:47-50`.
- **What:** after a conflict, the banner says edits are not being saved and to reopen the design. Reopening it does restore saving (`setActiveId` resets `conflicted`), but nothing clears the warning, and `SaveStatus` hides the saved status while any warning shows. The warning is one slot, so a `full` raised over `degraded` or `loadFailed` replaces it, and the next good save clears it for good, though `markDegraded` never notifies twice.
- **Fix:** retire `conflict` on the next landed save or in `replaceWorkspace`; keep standing notices in their own slot. Test: conflict, reopen, autosave, warning gone.
- **Status:** confirmed by the lead.

### M14. An ISA file opened with a default humidity flies sea-level air at the launch site

- **Where:** `web/src/services/files/ork/importLaunch.ts:217-220`, merged by `web/src/services/design/orkTree.ts:91-101` (`overLaunchDefaults`).
- **What:** for `<atmosphere model="isa">` the reader nulls temperature and pressure but leaves humidity unset, so a Settings default fills it. With humidity set and the other two blank, the bridge flies `ExtendedISAModel(launchAltitude, 288.15 K, 101325 Pa, h)` (`OpenRocketEngine.java:1782-1790`): standard sea-level air placed at the launch altitude. Desktop flies ISA whenever ISA is chosen.
- **Effect:** at a 1,500 m site the pad air is about 17% too dense. The next save writes it as `extendedisa` with those values, so desktop flies it too.
- **Fix:** set `relativeHumidity = null` for ISA, and read humidity only for `extendedisa`. Test against the kernel's ISA density at the launch altitude.
- **Status:** confirmed by the lead. Raised by slices 1a and 4b; merged.

### M16. Motor digests are chosen by catalog metadata, not by the motor the app flies

- **Where:** `web/scripts/sync-motor-digests.mjs:117-128`, `:148-149`.
- **What:** candidates are ranked by distance from thrustcurve.org's impulse, burn and peak, not from the curve or loaded mass the app flies. For 19 motors, two or more desktop entries offer the same delay and the first one's launch mass is more than 2% off the app's, while another entry matches: AeroTech L339N (app 3,150 g, desktop gets 4,500 g), Cesaroni 601I350-16A (782 g against 616.3 g), AeroTech G25W-10 (170 g against 119.7 g), and four Hypertek motors about 0.6 kg off, among others.
- **Effect:** a saved `.ork` flies a different motor mass in desktop than in the app.
- **Fix:** emit launch mass from `MotorDump.java` and rank on loaded mass first, then on impulse, burn and peak computed from the flown curve. Test with the dumped desktop masses.
- **Status:** reported by slice 6 from desktop's dumped masses.

### M17. A mass component of 0 g blocks the run

- **Where:** `web/src/services/design/requiredComponent.ts:45` (`masscomponent: ['mass']`), used by `runnability.ts:132-139`.
- **What:** a 0 g mass counts as a bad dimension. Desktop's new mass component is 0 g (24.12 `MassComponent()` stores `dconst_0`), and desktop flies it. A desktop `.ork` with an untouched mass component opens but cannot run, and the banner calls the part broken. `fieldReadback`'s `refusedAtZero` filter hides this.
- **Fix:** drop `mass` from the required fields; test that a 0 g mass component built through the bridge is not a blocker.
- **Status:** confirmed by the lead (javap).

### M18. An override equal to the part's own value is dropped on reload and not written on save

- **Where:** `web/src/services/flight/flightConfigs.ts:290-324` (`overridesDesign`, `withoutRepeatedOverrides`), called on every hydrate at `web/src/state/store.ts:1035`, and by the writer at `web/src/services/files/ork/exportParts.ts:246`, `:400`.
- **What:** desktop keeps an override that happens to equal the default: 24.12 `FlightConfigurableParameterSet.isDefault` compares identity, and `RecoveryDeviceSaver` writes a block whenever `!isDefault(fcid)`. The app prunes it.
- **Effect:** configuration "windy" overrides the main at 150 m and the design default is also 150 m. After a reload, editing the default to 120 m moves "windy" to 120 m. Desktop keeps 150 m.
- **Regression:** the hydrate pruning was added in the previous run to clean up an older importer's all-configuration overrides.
- **Fix:** run that cleanup once, as a migration of stored workspaces from before the import change, and write every override a configuration holds. Test with a desktop-saved file holding an equal-valued override.
- **Status:** confirmed by the lead.

### M19. The off-the-rail tool's average thrust is not the kernel's

- **Where:** `web/src/services/tools/railExit.ts:68-73`, used at `:130` and `:177`.
- **What:** average thrust is total impulse over the whole curve span. The kernel averages inside the burn window between the 5%-of-peak crossings (`ThrustCurveMotor.java:707-792`), which the bridge exposes (`getMotorStatistics`) and the catalog's `avgThrust` uses.
- **Effect:** the average thrust-to-weight reads low (a median of 4% across the bundled curves, 30 to 40% on long-tail motors), which can mark a passing motor amber against the 5:1 rule, and the "heaviest rocket" cap reads low with it.
- **Fix:** take the average from `getMotorStatistics`; test with a curve that has a sub-5% tail.
- **Status:** confirmed by the lead against the Java.

### M20. "Save as part" on a rail button always fails

- **Where:** `web/src/services/parts/customParts.ts:66-159` (`rowGeometry` has no `railbutton` case).
- **What:** rail buttons are in `CATALOG_TYPES`, so the control is offered; `rowGeometry` returns null, so the save throws `errors.savedPart.missingDimensions`, blaming the part.
- **Fix:** add the rail button projection and a test that saves the editor's default rail button.
- **Status:** confirmed by the lead.

### M21. "Fits only" offers centering rings that cannot go over the mount

- **Where:** `web/src/services/parts/componentFilter.ts:137-141` (`boreClears`).
- **What:** `id + FIT_SLACK >= mountOuter` passes a bore up to 2 mm smaller than the mount and sets no upper limit (a 54/38 ring "fits" a 29 mm mount). The mount is the widest inner tube anywhere in the parent, where the kernel uses the tubes overlapping the ring (`CenteringRing.java:22-47`).
- **Fix:** bound the bore on both sides and take the mount from the overlapping siblings, as `discGeometry.ringBore` does.
- **Status:** confirmed by the lead.

### M22. Legacy catalog parts are offered alongside current ones

- **Where:** `web/src/services/parts/componentDb.ts:12-42`, `web/src/services/parts/componentFilter.ts:282-330`.
- **What:** about 1,544 rows from the jar's `*-legacy.orc` files are unflagged. Desktop's chooser hides legacy parts by default.
- **Fix:** carry `ComponentPreset.LEGACY` through `PresetDump` and the sync, hide legacy rows by default, and add a "Show legacy" toggle.
- **Status:** confirmed by slice 4b with javap on the 24.12 jar (`ComponentPresetChooserDialog` legacy filter, unchecked by default).

### M23. The part picker's diameter match is not desktop's

- **Where:** `web/src/services/parts/componentFilter.ts:76-102` (`fitRuleFor`), `web/src/services/parts/componentFit.ts:46-57`.
- **What:** desktop offers "Match fore/aft diameter" for every symmetric component, against the previous part's aft and the next part's fore diameter, at `max(0.05·d, 0.001)`. Here transitions get no match, tubes and nose cones match any airframe diameter in the design at a flat 0.6 mm, and transition fore ends are skipped.
- **Fix:** port the neighbor rule and tolerance, using `symmetricNeighbors`.
- **Status:** confirmed by slice 4b against the 24.12 bytecode (`ComponentPresetRowFilter`).

### LOW correctness

| ID | Where | What | Fix |
|---|---|---|---|
| L1 | `components/design/RecoverySizingReadout.tsx:103`, `:114-117` | The "measured on" text prints the kernel's raw branch name, `[Stage.Stage]` for a stage whose name was cleared | Pass it through `componentName` or `stageLabel` |
| L2 | `components/design/PropertyPanel.tsx:337`, `FreeformFinEditor.tsx:45` | The freeform editor shows stored points, not the normalized points the kernel flies (reported: no importer confirmed to produce such points) | Feed it `freeformPoints(node)` |
| L3 | `components/design/MaterialPicker.tsx:159-163` | The fillet picker offers adhesives only; desktop's fillet material list is all bulk materials. Owner call | Offer the full bulk list, or keep and say so |
| L4 | `FreeformFinEditor.tsx:267-293`, `DeploymentSection.tsx:214`, `SeparationSection.tsx:320`, `configColumns.tsx:289`, `OffTheRail.tsx:161`, `:296` | Literal "X", "Y", "s" and " : 1" bypass i18n and the unit preferences | i18n keys and unit symbols |
| L5 | `components/sim/speedWarnings.ts:49-53`, `SimSummary.tsx:202-211` | The tile's speed is the last deployment's, but every device deployed on the branch can set the verdict, so a drogue's warning marks the main | Pass only the devices of the last deployment |
| L6 | `components/sim/MotorFilterBar.tsx:76-80`, `:92`, `:113`; `MotorDialog.tsx:177-179` | Opening the picker on a mount saves the mount-capped floor over the remembered floor | Keep a `freeLow` beside `freeHigh` |
| L7 | `components/sim/WindProfileDialog.tsx:373-389` | The deviation cap applies on upper levels, while the turbulence box beside it can set more | Cap only the surface level, as the speed column does |
| L8 | `components/canvas/rocketPieces.ts:210-257`, `AftView.tsx:209-234`, `schematicShapes.tsx:399-466` | No view draws fin cant; the kernel turns each canted fin (`FinSet.java:1783-1791`) | Apply the cant rotation; add `cant` to the flag test |
| L9 | `components/canvas/AftView.tsx:431-501`, `useWheelZoom.ts:389-393` | In a wide pane the square aft view is letterboxed, so wheel zoom does not anchor under the pointer and horizontal drag pans slowly | Map through `getScreenCTM()` |
| L10 | `components/canvas/LoadedBanner.tsx:83` | A RockSim import is labeled "Loaded design (.ork)" | Key the label on the source format |
| L11 | `services/files/ork/importNotes.ts:19-36` | The `instanced` import note says the drawing shows one copy; the side and 3D views draw every copy | Drop or reword the note |
| L12 | `AftView.tsx:211`, `schematicShapes.tsx:423`, `rocketPieces.ts:219` | `finSpan` is called with no parent, so a freeform fin on a tapered parent gets the stored height, not `FreeformFinSet.getSpan` | Pass the mount |
| L13 | `services/motors/exportMotors.ts:61-66` (`namesSeated`) | Compares the file's designation (desktop writes `H128W`) with the common name (`H128`), so most desktop files lose their digest at the first save made offline | Compare against `spec.code` too |
| L14 | `services/storage/workspaceMigrate.ts:121` | The old-C6 migration keeps a stored spec with no manufacturer, so the export names Quest C6 | Also set the manufacturer |
| L15 | `state/store.ts:969-971`, `services/design/defaultRocket.ts:383-384`, `state/useWorkspaceEffects.ts:87-90` | A first run in another language keeps English default names (design, stage, simulation) and saves them | Rebuild the default workspace after the language is ready |
| L16 | `state/useWorkspaceEffects.ts:107-114` | After a failed load the untouched default rocket is not marked written, so hiding the tab saves it as a library entry | `markWritten` in the catch |
| L17 | `services/files/rktImport.ts:794-804` | A RockSim pod marked `Removed=1` flies; desktop grounds it (`PodHandler`) | Return a configuration that grounds it |
| L18 | `services/files/ork/importLaunch.ts:217-226` | An unknown or missing atmosphere model reads as custom base values; 24.12 uses ISA | Treat anything but `extendedisa` as ISA |
| L19 | `services/files/ork/importNotes.ts:32`, `loadOrk.ts:436-437`, `orkImport.ts:189-233` | Keyed import notes carry part labels, list joins and extension names already translated | Pass keys and join at render |
| L20 | `services/exports/solidMesh.ts:355` | A planar fin set with no `rootChord` key refuses the mesh export, though it flies at the 50 mm default | Use `finRootChord(child)` |
| L21 | `services/design/fieldRange.ts:121-124` and the importers | The panel shows a file's cant unclamped (20°) while the kernel flies 15° | Clamp at import or read `finCant` |
| L22 | `scripts/lib/statedMass.mjs:30-43`, `sync-components.mjs:371-391` | Rail button densities stay at the `.orc` value; 24.12 `makeRailButton` derives them from the stated mass. Hidden while the mass override is on | Derive density from mass over the kernel volume |
| L23 | `services/design/treeEdit.ts:66-201` | Flipping a catalog nose cone, or turning on an automatic shoulder, keeps the part link; desktop's setters clear it | Add `flipped`; test the synced node |
| L24 | `services/design/treeEdit.ts:529-548` (`presetShoulder`) | A stated shoulder radius is applied unclamped (SEMROC BC-08542 [R]); desktop clamps it to the end | Clamp in `presetShoulder` and `presetVolume.mjs` |
| L25 | `services/flight/windProfileCsv.ts:147` | A negative deviation imports as is; the kernel floors it at 0 | Floor it in the parser |
| L26 | `services/parts/componentDb.ts:262-335`, `treeEdit.ts:594` | Security: a remote catalog row keeps `custom`, `patch` and `id` unchecked, and `statedPatch` applies a `custom` row's patch wholesale, so one row on the data host could write any node keys (reported) | Strip those fields from catalog rows; type-check `material` and `digest` |
| L27 | `services/design/repairValues.ts:134` | `filletDensity` is not range-checked on load | Add it to `LIMITED` |
| L28 | `services/parts/customParts.ts:168-181` | A saved part's node from storage is applied without the load-time repair (reported) | Repair the patch on apply |
| L29 | `services/exports/csvExport.ts:389`, `:414` | The run-table CSV always writes q·α in kPa·°, while every other column and the docs follow the user's units | Use the pressure and angle units |
| L30 | `i18n/locales/*.json` `aero.rollNote` | Says the sweep is flown at zero roll; it is flown at the chosen roll rate | Reword in every locale |
| L31 | `i18n/locales/*.json` `settings.materialNoDefault` | "No default: leave the part unset"; the part gets the stock material | Reword in every locale |

---

## 🟡 Accessibility

### M1. Help opened from the launch site map loses focus and Escape to the dialog behind it

- **Where:** `web/src/components/common/useFocusTrap.ts:50-53` (`topmostSurface`), `:130-135`, `:155-159`; `web/src/components/layout/HeaderDialogs.tsx:93`; `web/src/components/sim/SiteMapDialog.tsx:32-38`; the key note's Help link at `MapParts.tsx:175`.
- **What:** the topmost surface is the last one in document order. Help mounts early in the header, so Help opened from the site map (drawn on top) is not the topmost surface. The site map's trap pulls focus back from Help, so Help's search cannot be typed in, and Escape closes the site map underneath. `HelpDialog.tsx:73-74` names this path.
- **Fix:** order surfaces by when they opened, or portal Help to the end of the body. Test: Help from the site map takes focus, and Escape closes Help first.
- **Status:** confirmed by the lead.

### M2. A Settings value left with Escape is dropped

- **Where:** `web/src/components/common/NumberInput.tsx:92-107`, `:156-157`; `web/src/components/layout/SettingsTabs.tsx:458-460`.
- **What:** a commit-on-blur field reports only on blur or Enter. Escape closes the dialog and unmounts the focused input, and React fires no blur for a removed node. Time step, maximum time, angle step, seed and the speed limits typed and left with Escape are lost. The same dialog's key field and launch defaults flush on unmount; `NumberInput` does not.
- **Fix:** flush a pending draft in an unmount cleanup through a ref. Test: type a time step, press Escape, setting changed.
- **Status:** confirmed by the lead.

### M3. Undo and redo do nothing while the component editor dialog is open

- **Where:** `web/src/components/layout/useUndoShortcuts.ts:19-27`, `web/src/components/design/ComponentDialog.tsx:44-46`.
- **What:** shortcuts are off while any modal is open. Below 1536 px the component editor is a modal, so undo is dead for all part editing on most laptops, and the header buttons sit under the overlay. At 1536 px and up the same edits undo. The rule's reason (the design is hidden behind the dialog) does not hold for a dialog that shows the part being edited.
- **Fix:** exempt the component editor surface, or put undo and redo in it. Owner call whether the blanket rule stays.
- **Status:** confirmed by the lead.

### M8. The motor diameter and time-step sliders announce indices

- **Where:** `web/src/components/sim/RangeSlider.tsx:238-259`, `web/src/components/sim/SimEditor.tsx:312-325`.
- **What:** both range inputs move over array indices with no `aria-valuetext`, so a screen reader says "3" for a diameter or "2" for 0.05 s. Other sliders in the app set it.
- **Fix:** `aria-valuetext` from the stop labels and the formatted step.
- **Status:** reported by slice 3b, read by the lead.

---

## 🟠 Tooling and gates

### M9. The offline catalog cache drops motors and parts after 90 days without an online visit

- **Where:** `web/vite.config.ts:307` (`astra-catalogs`: `expiration: { maxEntries: 16, maxAgeSeconds: 7776000 }`).
- **What:** Workbox's expiration plugin returns nothing for a cached response older than `maxAgeSeconds` and deletes it. In the deployed build this cache is the only offline copy of the motor and parts catalogs. A user who has not opened the app online for a season gets no motors and no parts at a field with no signal. The docs promise offline catalogs with no such limit.
- **Fix:** drop `maxAgeSeconds` from that rule and keep `maxEntries`; the `?v=` keys and stale-while-revalidate already keep it fresh.
- **Status:** confirmed by the lead (`ExpirationPlugin.cachedResponseWillBeUsed`).

### M10. No accessibility scan sees the multi-edit banner or the outdated results marker

- **Where:** `web/e2e/a11y.spec.ts:291-297`, `:954-967`; `web/e2e/a11y-phone.spec.ts`.
- **What:** the only scan that ticks two simulations runs them, which switches to Results, so the multi-edit banner (`SimEditor.tsx:84-92`) is never on screen in a scan. No scan edits after a flight, so the Outdated and Running markers (`CenterToolbar.tsx:83-90`) are never scanned either, in any theme.
- **Fix:** add "Simulations / two ticked" and "Results / outdated" scans.
- **Status:** confirmed by slice 5.

### M15. The desktop checks never exercise the simulation conditions, configurations or the import direction

- **Where:** `web/tests/services/files/orkDesktopSamples.test.ts:232-261`, `web/scripts/check-desktop-fields.mjs`, `web/scripts/ork-check/OrkCheck.java:88-106`.
- **What:** every sample flies the default launch (ISA, no humidity, no forecast, standard gravity), `fields` compares components only, and nothing compares desktop's read of a source file with the app's import. Three settings users can reach make 24.12 warn on open, and none is in `KNOWN`:
  - humidity writes `<baserelativehumidity>`, which 24.12 does not know;
  - a forecast atmosphere writes `<forecastlevel>`, warned once per level;
  - constant gravity writes `<gravity model="constant"><value>`, which 24.12 warns on.
- **Effect:** the steps pass while M14 and these writer differences exist.
- **Fix:** add a sample with humidity, a forecast, constant gravity, multilevel AGL wind, per-configuration deployment and separation, a grounded stage and an embedded custom motor; list or fix the three warnings; extend the dumpers to compare configurations, motors and conditions; compare each source example's desktop read with the app's import.
- **Status:** confirmed by slice 1a with javap; read by the lead.

---

## 🔴 Security

One LOW, L26 (reported). Checked and clean:

- user files are size-capped before decoding;
- nesting and element counts are capped;
- every string from a file is escaped on export;
- CSV writers neutralize formulas;
- KML, GPX, DXF, 3MF and SVG are escaped;
- remote fetches have timeouts, byte caps and shape checks;
- stored results are checked for finite values;
- no `dangerouslySetInnerHTML`, and every `target="_blank"` carries `rel`.

## 🟢 Dead code

None. `npm run knip` reports nothing.

---

## What the mechanical checks do not reach

Not counted as defects.

- **`fieldReadback.kernel.test.ts`:**
  - one host per type (no freeform fins on a transition or nose cone, no internal part inside an inner tube or coupler);
  - bool fields only at the editor default;
  - selects only at seeded values;
  - the `bore` and `derived` kinds never compared;
  - nodes built directly, never through `updateNode`;
  - `refusedAtZero` hides M17.
- **`catalogPatch.kernel.test.ts`:**
  - picks only onto a fresh node, with no existing shoulder, solid part or flipped cone;
  - no comparison of shoulder radius, length or wall (L24 passes);
  - no rail button mass or Cd override check;
  - no test of the preset link against the kernel's `clearPreset`.
- **`shoulderSeed.kernel.test.ts`:** no flush in-line assembly, flipped cone, solid cone or transition neighbor, solid part with no neighbor, aft or nose-base clamp, or tip neighbor; the `syncAutoShoulders` case covers only the stage crossing.
- **`geometryParity.kernel.test.ts`:**
  - no fairing;
  - body tube fin sets placed only by `top`;
  - `tabOffsetMethod` never left out;
  - no cant past the limit;
  - the span of a canted freeform fin is not exposed by the bridge;
  - mesh profiles, side-view fins, the template planform, the schematic, the 3D and aft views and the layout spans are never compared with the kernel.
- **`geometryFlags.test.ts`:** no `cant` flag (L8), only the freeform fin, nothing in a pod, and `overturnedFins`, `badDimensions` and `autoShoulder` not listed.
- **`finCantClamp.kernel.test.ts`:**
  - one trapezoid on a body tube;
  - tab points, the cut contour, the pre-run check, the panel value and the importers are not covered;
  - its fixture sets `sweepLength`, a key nothing reads.
- **Combine pane test:** its only curve starts at t = 0 (M6).
- **Desktop steps:** see M15.
- **`commentsStateTheConstraint.test.ts`:** does not read `website/docusaurus.config.ts`, `website/sidebars.ts`, the JSONC comments in `web/tsconfig*.json` or `engine-java/*.mjs` (no hits there today).
- **jscpd:** scans `src` only. The `serve()` harness, the work-in-progress init script and the settings key block are copied across the three `check-*.mjs` scripts, with no drift yet.

---

## Upkeep

**A comment that states something untrue or out of date**

- `components/common/useFocusTrap.ts:43-46`: "a nested dialog is rendered after the one it opens from" (false for Help, M1).
- `components/layout/useUndoShortcuts.ts:19-21`: the reason does not hold for the component editor (M3).
- `components/layout/DefaultMaterials.tsx:9-14`: says desktop leaves a part's material unset; desktop sets the default in each constructor.
- `components/sim/MotorCombinePane.tsx:103-105`: "a dash until the engine has loaded" (M6).
- `components/sim/speedWarnings.ts:30-33`: describes the devices the tile reads (L5).
- `components/sim/MotorFilterBar.tsx:66-75`, `:112`: says the mount cap never overwrites the saved preference (L6).
- `components/sim/LocationsDialog.tsx:19-22`, `:31-35`: omits the Settings and tools entry points (M7).
- `components/design/ComponentPicker.tsx:46-47`: "the tree" means the table.
- `components/canvas/LoadedBanner.tsx:10-12`, `:123-124`: say `.ork` for every import.
- `services/files/ork/importTags.ts:175-177`, `importNotes.ts:15-17`: say the drawing shows one copy (L11).
- `tree/nodeProps.ts:94-96`: says every reader goes through `bodyTubeRadius`; `rocketPieces.ts:500`, `schematicShapes.tsx:883` and `reportGeometry.ts:214` read the radius inline.
- `components/canvas/schematicShapes.tsx:47-50`: cites desktop's fin projection without its cant rotation.
- `tree/position.ts:56-57`: says `clampFirstPoint` is not on our path; `FreeformFinSet.update` runs it on every set.
- `state/fileSlice.ts:179-183`: "File > Save calls this directly"; there is no Save item.
- `state/fileSlice.ts:511-513`: says the stale bail avoids pointing the library at the new entry; `create` already has.
- `engine/openRocketEngine.ts:629-630`: "about 45% extra" disagrees with the 17% measured in `simulations.ts` (reported).
- `services/storage/exampleLibrary.ts:18-21`: says an example opens as an unsaved copy; it goes through the import's Overwrite / Rename prompt.
- `services/motors/motorMath.ts:5-10`: says G0 is defined once; `report/motorsSection.ts:64` and `prefs/units.ts:99` repeat it.
- `services/motors/exportMotors.ts:12-19`: says the file's digest survives a round trip; the catalog's replaces it when it loads.
- `services/files/ork/exportSimulation.ts:152-163`, `:241-243`, `:283-287`; `importLaunch.ts:227-230`; `importSimulations.ts:31-34`; `orkImport.ts:124-128`: attribute to desktop what only upstream `unstable` has (humidity, forecast levels, gravity, recovery warnings, file version 1.11).
- `services/design/treeEdit.ts:66-70`, `:525-527`; `tests/services/parts/catalogPatch.kernel.test.ts:362-369`: the flipped-cone preset rule and the shoulder wall rule differ between 24.12 and the kernel.
- `services/tools/railExit.ts:46`, `:68`: "mean thrust over the burn" (M19).
- `services/flight/windLevels.ts:167-169`: says the kernel refuses a repeated altitude; the bridge refuses it first.
- `services/flight/recoverySizing.ts:52-55`: "about a percent"; the humidity effect is 1.65 to 2.3%.
- `services/flight/flightEvents.ts:12-16`: "maxQ is the one exception"; three others are computed there.
- `services/design/discGeometry.ts:249-251`: filled means inner radius 0 only for body tubes.
- `services/parts/customParts.ts:110-113`: derives `filled` from the wall.
- `services/parts/componentDb.ts:255-260`: says each type requires exactly the fields `catalogPatch` reads.
- `vite.config.ts:210-211`: lists three runtime rules; there are six.
- `scripts/check-update-flow.mjs:123`: the diagnostic regex cannot report version C, and `diagnose` reads the wrong page.
- `scripts/lib/presetVolume.mjs:86-87`: "up to a third more"; measured up to 3.83 times.
- `scripts/sync-motor-digests.mjs:108-116`: says it compares against the bundled curve; it compares metadata (M16).
- `scripts/lib/openrocketJava.mjs:3-6`: "two sync steps"; more use the dumpers.
- `scripts/lib/statedMass.mjs:19-24`, `scripts/sync-preset-digests.mjs:65-67`: omit rail buttons from the factory's mass list (L22).
- `services/weather/weatherProposal.ts:12-16`, `:26-27`; `openMeteo.ts:48-49`, `:90`: cite desktop weather client code not in the repo (reported).

**A test title that states something untrue**

- `tests/services/flight/windLevels.test.ts:22`: says the kernel does not sort levels; it does.
- `tests/services/flight/interpolate.test.ts:48`: says "extrapolates"; it asserts clamping.

**A duplicated helper or rule that has drifted**

- Stage naming: `components/canvas/EnvironmentLanding.tsx:397` ignores the branch name; `flightChartTraces.ts:267` uses it, so the same branch reads "Booster" on the ground track and "Stage 2" on Environment.
- `services/flight/powerClass.ts:178-182`: instance count falls back to 1; the bridge and the drawings use 2.
- `services/design/finImage.ts:27`, `:66-67`: compares luma unrounded; desktop truncates first (under one luma unit).

**A test that pins the app's own number**

- `tests/services/map/geodesy.test.ts:13-15` checks the Earth radius against a hand-typed value, and nothing pins the longitude term at a general bearing.

**User docs that state something the app does not do, or name a label it does not show**

Each item applies to the Spanish twin at the same line unless noted.

- `features.md`:
  - :52, "five tabs": Results appears only after a run, on desktop too;
  - :25, the hours fly on the **Fly the hours around this forecast** button, not automatically;
  - Flight configurations is not listed;
  - the Motor Dashboard's **Compare** and **Combine** are not mentioned;
  - the exports list omits the run table CSV, parts CSV, 3D snapshot and per-part 3MF zip;
  - the Daylight theme is not mentioned;
  - :40, both **Save as CSV** and **Save parts as CSV** exist.
- `comparison-openrocket.md`:
  - :53, the forecast hours are a button;
  - :42, desktop does have flight configurations (reported).
- `comparison-zenrockets.md:33-34`: the views draw one flight at a time, one line per stage; they do not overlay several simulations.
- `files-and-exports.md`:
  - :193, three swatches per stage (Path, Ground, Pin), each independent;
  - :231, stage colors are remembered between exports;
  - :143-144, example filenames use underscores (`Bertha-C6_flight-...`, `Bertha-Nose_cone.stl`);
  - :262-265, the 3D view also exports PNG/JPG;
  - :64, streamers are also excluded from mesh export;
  - :112 and :150-156, the parts CSV columns and the CSV exports list are incomplete (reported).
- `settings.md`:
  - :75, motor diameters follow the Motor dimensions unit;
  - :89 and :93, a rail button gets Delrin;
  - :69 and :33, the length unit is a flight input (kernel warnings, results age);
  - :118, wind speed and deviation are not required with a profile;
  - :194, Reset on Launch and Materials also asks;
  - :81, only a changed color row has a reset;
  - :180-184, these settings also age results.
- `designing-a-rocket.md`:
  - :36, the editor shows diameters, not radii (the Spanish twin already says diameters);
  - :30-34, the add menu groups are Body, Fins, Inner, Recovery, Other and Assembly;
  - :140, upper stages also offer Automatic and Launch ignition (reported);
  - :258, the stats strip collapses, and its title is **Static statistics**;
  - :206, a rail button's stock material is Delrin.
- `flight-configurations.md`:
  - :24, mount cards run nose to aft;
  - :52, a file's own simulations come in as they are; only a file with none gets one per configuration.
- `motors.md`:
  - :85, `.eng` can also mark a motor plugged;
  - :96, mount cards run nose to aft.
- `running-a-simulation.md`:
  - :13, the run-table q·α is in kPa·° (L29);
  - :105, wind speed and deviation are required only for single-level wind;
  - :88, there is no spinner: the button becomes **Cancel run** and the row shows Running;
  - :146, Max-Q is over the whole flight (reported).
- `safety.md`:
  - :23, the kernel warnings list omits drogue too slow, tumble under thrust, out-of-order and early separation, and events after landing;
  - :20, humidity and a forecast atmosphere are also inputs.
- `tools.md:75`: the at-exit thrust to weight uses the mass at that moment.
- `views-and-analysis.md`:
  - :148, Landing sits above the charts;
  - :7, each tab's toolbar offers only its own views;
  - :50, the Mach slider shows on both panes;
  - :45, AoA follows the angle unit;
  - :163, the recovery mass tile always shows, with a dash before a motor;
  - :33, the image menu has **Fit rocket to frame**;
  - :152, fly the hours is disabled offline too;
  - :52 and :130 (reported).
- `glossary.md`:
  - :18, **Aft** sits beside **Side**, in both 2D and 3D;
  - :34, aspect ratio is a streamer field;
  - :84, a cluster is the **Cluster** pattern on an inner tube;
  - :112, the drift ellipse comes from a Drift sweep at 2σ;
  - :172, the ignition options;
  - :178, the field is **Instance spacing**;
  - :306, the dialog is **Scale rocket**;
  - :340, the strip also has a normal-force slope tile;
  - :370, turbulence intensity also shows in the launch conditions;
  - :405, PNG/JPG also snapshot the 3D view;
  - :409-463, the flight CSV headers are names, not symbols (`tc` is never sent; `Abz`, `Fta`, `CNα` are missing);
  - :136 and :238 are out of alphabetical order.
- `faq.md`:
  - :15, the `.ork` round trip drops decals and unsupported parts;
  - :12, settings live in localStorage;
  - :38, the JS fallback is for browsers without WASM GC.
- Spanish-only:
  - `getting-started.md:23`, **Datos**;
  - `running-a-simulation.md:42`, ° O;
  - `files-and-exports.md:190`, **Trayectoria**;
  - `views-and-analysis.md:126`, **CSV de puntos**;
  - `files-and-exports.md:111`, the CSV header is the English `Scope, Field, Value, Unit`;
  - `files-and-exports.md:177`, plataforma and eyección;
  - `files-and-exports.md:208`, the balloon writes `50.0 m`;
  - `features.md:47` and `running-a-simulation.md:42`, **Sitio de lanzamiento**;
  - `glossary.md:344` and references, **Traza en tierra**;
  - `glossary.md:162` drops the motor's burn time;
  - `glossary.md:34` has an *In the app* line the English entry lacks;
  - `current.json:3`, "Next" untranslated.
- App locale text:
  - `es.json` `about.body` and `about.credits` say JavaScript only;
  - `es.json` `settings.aeroHeatNote` names an option the menu calls "Por calor";
  - `es.json` `export.title` means "print or export" where English says "Design Report".

---

## Recommended order of attack

1. The two regressions, small and local: **M6** (finalize curves before combining) and **M18** (make the override cleanup a one-time migration and write every override).
2. Small verified fixes, a few lines each:
   - **M17** (mass component at 0 g), **M20** (rail button save), **M9** (drop the 90-day expiry), **M2** (flush on unmount);
   - **M4** (density label), **M5** (keep the part's material), **M7** (`onApply`), **M14** with **L18** (ISA humidity);
   - **M8** (slider value text), **L13** and **L14** (motor names).
3. **M11** (embed custom curves unless the catalog match is certain). This also settles the earlier owner question about same-name custom curves.
4. **M1** (surface order by open time) and **M3** (undo in the component editor, owner call).
5. **M13** (storage warning slots), then **L15** and **L16**.
6. **M12** with **L8** and **L12** (instance angle, fin cant and span in the views), against the kernel.
7. **M19** (off-the-rail average from the kernel), **M21** (ring fit bounds), then **M22** and **M23** (desktop picker rules).
8. Gates: **M15** (desktop checks for conditions, configurations and the import direction), **M10** (the two missing scans), then the gaps under "What the mechanical checks do not reach".
9. **M16** (motor digests ranked on flown mass) with **L22**.
10. **H1**: publish this tree's catalog.
11. The remaining LOW items, then upkeep, starting with the docs.

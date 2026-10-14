# AUDIT - `web/` engineering audit

<!-- cspell:ignore retuned retunes SEMROC Rocketarium Maadcow basemap APPNOTE -->

Date: 2026-10-13. Branch `dev` at e871ddb, clean working tree. Run per
`docs/AUDIT_PROMPT.md` as a fresh audit: no finding was carried forward from
the previous report, and no agent read it. Twelve parallel review agents:
slice 1 split into 1a (importers), 1b (`.ork`, `.rkt` and `.CDX1` writers),
1c (exports and the printed report) and 1d (storage, motors, materials and
app services); slice 2; slice 3 split into 3a (canvas), 3b (sim, tools and
report components) and 3c (design, config, common and layout components);
slices 4, 4b, 5 and 6.

Scope: the `web/` package, its scripts and workflows, and the docs that
describe them. `web/src/engine/vendor/` is generated TeaVM output and was not
audited. `engine-java/` has its own prompt; its bridge was read where a slice
needed it, and one defect here (C1) is in the bridge.

Every HIGH finding and every security finding was confirmed against the
source by the lead, not only by the agent: C1 by rerunning the kernel, S1 and
S2 by reproducing them against the project's fflate 0.8.3. Every MED marked
VERIFIED was read at the cited lines. REPORTED marks a finding whose code was
read but whose consequence depends on something outside the repo.

## Status

**46 open defects: 1 HIGH, 21 MED, 24 LOW**, plus the upkeep section. C33 to
C45 were found after the first pass, by the two checks added the same day and
by the change audits of those checks and of the C1, C43 and security fixes
(see "Checks added after this report").
Fixed and not counted: C40 and C41, in the change that added the checks; the
HIGH findings C1 (transition shoulders) and C43 (stage overrides); the
security findings S1, S2 and S3; C24 (the weather key), fixed by the
shared key field the Esri map key added; R2 (the catalog fallback); R3 (the curve order); and A1 and A2
(accessibility). Each entry names the test that pins it.

- **HIGH R1:** the published parts catalog is built by an older pipeline than
  the one on this branch.
- **Files desktop reads differently:** lug and rail button spacing (C2),
  angles over 180 degrees (C3), auto values in `.rkt` (C8), two `.CDX1`
  mappings (C9, C10), shoulder walls (C33), `auto` line and cord lengths (C36),
  `.rkt` lugs (C37) and `.rkt` mass overrides (C42).
- **Lost work:** C11 and C12, both rare.

## Gates

Run locally at e871ddb, all with exit code 0:

| Gate | Result |
| --- | --- |
| `npm run verify` (web) | pass: format, spell, typecheck, lint, knip, dupes, build; 476 test files, 5921 tests |
| `npm run audit` (web) | pass: coverage, samples, desktop opens every sample with no warning, helpers |
| `npm run audit` (engine-java) | pass: all 5 checks |
| `npx playwright test` (whole suite, no shard) | 476 passed |

`npm run knip` reports nothing and `npm run dupes` finds 0 clones in 464
files. Every module under `web/src` is reachable from `index.html`,
`main.tsx` or `simWorker.ts`. The 9 exports reached only by tests are the
intentional seams `tests/srcExportReach.test.ts` already lists. The green
gates do not cover T1 to T4, which are gaps in the gates themselves.

## Checks added after this report

Most defects here are one kind: the app holding its own copy of something the
kernel knows (a default, a clamp, an automatic rule) with nothing comparing
the two. Two checks now compare them. Each keeps a `KNOWN` list checked both
ways, citing the findings above, so fixing one fails the check until its entry
is removed, and a new disagreement fails it at once.

- **`web/tests/engine/fieldReadback.kernel.test.ts`** (in `npm run verify`).
  For every field the Design tab edits, the value the panel shows has to be the
  value the kernel holds after the build. It builds each part type as the
  editor creates it, with each key left out, at each end of the range the panel
  allows, and on Auto, in a 100 mm airframe, and again from seeds that put
  every field into a state where it applies (a fin tab, a cluster, each shape,
  an altitude event); it fails if any field is never compared. Kernel values
  come from a new
  bridge call, `getComponentFields` (`engine-java/src/api/java/api/ComponentFields.java`),
  which reads each part back through its own getters. The panel's limits and
  shown values come from one module, `web/src/services/design/fieldRange.ts`,
  which the panel and the test both use. It holds C2, C3, C33, C34 and C39, each entry matching only the disagreement its finding describes.
- **The `fields` step of `npm run audit`** (`web/scripts/check-desktop-fields.mjs`,
  `npm run check:fields`). Opens every `.ork` and `.rkt` the samples step saves
  in desktop 24.12, now including a design with every part type (overrides,
  a non-default material, an airfoil fin set, a single and a clustered motor
  tube, a tail cone), and requires each part to come back at the same place in
  the tree, at the same depth, with what the app's kernel flies, through the
  same `ComponentFields` compiled against the release, which adds overrides,
  materials, the finish and fin planform area to the panel's fields. It holds
  C2, C8, C33, C36 to C38, C42 and C44. Values a RockSim file restates
  (angles in degrees, a pod by its distance from the axis, a tab from the
  root's front, a packed part by either end) are compared as desktop reads
  them; its other `.rkt` entries name what RockSim cannot carry and the desktop
  handler that shows it. The `desktop` step keeps the same kind of list for
  loader warnings, so a known finding no longer stops the audit before the
  `fields` step runs.

The fix rule and the change audit that go with them are in
`docs/AUDIT_PROMPT.md` ("Fixes") and `docs/AUDIT_PROMPT_CHANGES.md`.

## 🔴 Security

**S1. MED, FIXED | `.ork` gzip inflates fully before the cap is checked** | `web/src/services/files/ork/importUnpack.ts:39-55` | VERIFIED
Resolution: `importUnpack` feeds every inflater its input in 1 KiB slices and
counts the output of each before the next. DEFLATE expands at most about
1032:1, so the cap stops the work within about 1 MiB of its limit. Slicing
alone made a stream that takes in input without producing output (a gzip
file name that never ends, bytes after a member's data) cost time that grows
with the square of its length, since fflate copies the input it holds back on
every push: 16 s for a 4 MiB file. So a stream is also refused, with
`errors.file.archiveCorrupt`, once it has taken in 128 KiB with no output;
a valid stream never holds back more than a stored block's 64 KiB. Any error
fflate raises becomes that keyed message rather than raw English. A gzipped
file may hold at most four gzip members (`MAX_GZIP_MEMBERS`; OpenRocket writes
one): each member costs a fresh inflater however little it holds, and 64 MiB
of one-byte members took 384 s with every byte cap far off. Pinned by
`tests/services/files/archiveBombs.test.ts`, which counts the bytes fflate's
inflaters deliver: against the reader from before the fix a 16 MiB gzip
delivered all 16 MiB before the refusal, where the bound is the cap plus 2 MiB.
The finding as reported:
`gunzipCapped` pushes the whole input to fflate's `Gunzip` in one call, and
fflate inflates everything buffered before it calls `ondata`. Reproduced: a
65 KB gzip of 64 MiB of zeros arrives as a single 67,108,864-byte chunk before
the counter runs. `openOrkFile` accepts up to 64 MiB of gzip, which can
declare tens of GB, so a crafted file crashes the tab instead of showing
`errors.file.archiveTooLarge`. The comment ("Streamed, so the count stops the
inflation as soon as it passes the cap") is false, and the test in
`web/tests/services/files/designFile.test.ts:147-151` passes because it checks
only that the call throws, after inflating 65 MiB.
Fix: push the input in 64 KiB slices so each chunk is bounded and the throw
lands early. Make the test assert the largest chunk delivered.

**S2. MED, FIXED | `.ork` zip cap trusts the declared size** | `web/src/services/files/ork/importUnpack.ts:71-91` | VERIFIED
Resolution: a zip is read with fflate's streaming `Unzip`, member by member from
the local headers as Java's `ZipInputStream` reads it, through a sliced
inflater, and the per-member and total caps count what each member inflates
to; the declared sizes are no longer consulted, so a member that declares more
than it holds opens, and central directory entries cannot alias one member.
Members whose sizes follow their data (a data descriptor, as desktop's
`ZipOutputStream` writes them) open, checked on a `jar`-built `.ork` and in
`archiveBombs.test.ts`. Pinned by `archiveBombs.test.ts`: a member declaring
1000 bytes and inflating to 16 MiB is refused within the bound and past the
cap, so the counted path is the one taken (the reader from before the fix
returned it without an error); a gzip header that never ends, a member
that runs on past its data and a gzip file of a thousand members are refused
at once; and stored members and the
total are counted by what they hold.
The finding as reported:
The `filter` charges each member `max(size, originalSize)` from the central
directory. fflate's `unzipSync` allocates `originalSize` and keeps decoding
the whole compressed stream past it, dropping the writes. Reproduced: a zip of
256 MiB of zeros with its declared size patched to 1000 passes the filter
(`[261960, 1000]`) and decodes the full stream before returning 1000 bytes. A
64 MiB file, or 256 entries pointing at one member, freezes the tab for
minutes inside every cap `importLimits.ts` sets.
Fix: list the directory with `filter: () => false`, then inflate each wanted
member through the same chunked stream as S1, counting real output against
`min(originalSize, MAX_ARCHIVE_ENTRY_BYTES)`. Or refuse a deflated member whose
compressed size exceeds its declared size plus a margin.

**S3. LOW, FIXED | KML names are escaped once** | `web/src/services/exports/flightPathExport.ts:1318, 1353, 1361, 1381, 1397` | REPORTED
Resolution: the KML escaper (`escaperFor('kml')`, used by the built-in template
and by user templates named `.kml`) leaves `<` and `>` out of every value
before it escapes it, so no name can decode to markup in a viewer that sets it
into HTML; text inside a balloon is HTML-escaped first and keeps every
character. Pinned by `tests/services/exports/flightPathExport.test.ts` ("gives
no name in KML a way to become markup") and the escaper tests, which fail
against the writer from before the fix.
The finding as reported:
Descriptions go through `{{#htmlBalloon}}` and are escaped twice, but every
`<name>` (rocket, simulation, stage, recovery device) is XML-escaped once.
Google Earth's default balloon substitutes `$[name]` into HTML. Whether it
escapes that substitution is not confirmed. Fix: confirm it; if names render
as HTML, give the document a `BalloonStyle` that does not use `$[name]`.

## 🟡 Correctness

**C1. HIGH, FIXED | Transition shoulders clamp to 25 mm when the ends are automatic** | `engine-java/src/api/java/api/ComponentFactory.java:221-249` | VERIFIED (kernel run)
Resolution: `ComponentFactory.create` sets every stated shoulder radius with
clamping off, as desktop's `.ork` loader does (`DocumentConfig`,
"Transition:foreshoulderradius" and "Transition:aftshoulderradius", the nose
cone's included), so a shoulder no longer reads an automatic end before the
end has anything to follow. A nose cone is flipped before its shoulder is set,
because `NoseCone.setFlipped` carries a shoulder to the other end through the
clamping setter, and its shoulder goes through `NoseCone.setShoulder*`, which
follow the base. Desktop makes two exceptions, and the app now makes them too:
a flipped nose cone's shoulder is at most its resolved base (desktop reads
`<isflipped>` last, and `setFlipped` carries the shoulder through the clamping
setter), which `ComponentFactory.settleFlippedShoulders` applies once the base
has resolved; and a `.rkt` shoulder is at most its end (the RockSim
`NoseConeHandler` and `TransitionHandler` clamp), which `rktImport` applies as
it reads the file. The transition below now weighs 73.67 g with automatic ends
as with explicit ones, and a flipped nose cone with an automatic base keeps a
stated shoulder that fits its base (it flew 12 mm before). Pinned by
`fieldReadback.kernel.test.ts` (its C1 entries are gone; against the engine
from before the fix it fails on every transition shoulder, 48 and 38 mm
stated, 25 mm flown), by `tests/engine/statedShoulders.kernel.test.ts` (a nose
cone and a flipped nose cone with automatic bases, both failing before the
fix, and a transition end below 25 mm keeping a wider stated shoulder, as
desktop's loader does, and the two flipped-cone clamps above, at the
values desktop opens: 25 mm and 20 mm for 30 and 24 mm stated), by
`tests/services/files/rktImport.test.ts` (a nose cone and a transition
shoulder wider than their ends, which fail against the importer from before
the fix), and by the `fields` step of `npm run audit`, whose every-part
sample now has a tail cone with a shoulder wider than its base.
The finding as reported:
`create()` sets `setForeRadiusAutomatic(true)` and then
`setForeShoulderRadius`, before `attachChildren` calls `parent.addChild`
(`ComponentFactory.java:903-904`). With no parent,
`getPreviousSymmetricComponent()` is null (`SymmetricComponent.java:611-614`),
so the automatic radius reads `DEFAULT_RADIUS` 0.025
(`SymmetricComponent.java:24`). `setForeShoulderRadius(r)` clamps with
`min(r, getForeRadius())` and clamps the shoulder wall with it
(`Transition.java:446-457`); the aft side does the same. Nothing re-applies
the shoulders after attach: `applyWallThickness` covers tube couplers, engine
blocks and tube fins only.
Rerun by the lead: a conical transition 50 to 40 mm with 48 and 38 mm shoulders
50 mm long weighs 73.67 g with explicit ends and 58.29 g with
`foreRadiusAuto`/`aftRadiusAuto`. `getComponentGeometry` reports the same
resolved profile for both. Every new transition is automatic at both ends
(`treeEdit.ts:738-751`), and HPR `.ork` files use `auto` radii, so mass, CG,
inertia and stability are wrong on any airframe wider than 50 mm.
Fix: apply transition shoulder radius and wall in `applyWallThickness` (or a
settle step after the build, as `settleFinTabs` does). Add automatic ends
wider than 25 mm with shoulders to `fieldCoverage.kernel.test.ts` (its BASE
uses explicit 20 mm ends) and add shoulders to what
`geometryParity.kernel.test.ts` compares.

**C2. MED | Lug and rail button spacing: the app and the `.ork` say 0, the kernel flies 60 and 58 mm** | `web/src/tree/placement.ts:28`, `web/src/services/files/ork/exportWriters.ts:43-46`, `web/src/services/files/ork/importTags.ts:178` | VERIFIED
The bridge sets `instanceSeparation` only when the key is present
(`ComponentFactory.java:736-739`). Without it the kernel keeps the
constructor's value: `length * 2` = 0.06 m for a lug (`LaunchLug.java:38`),
`outerDiameter * 6` = 0.0582 m for a rail button (`RailButton.java:66`). New
lugs and buttons carry no key (`treeEdit.ts:865-873, 922-934`). So a user who
sets Instance count to 2:
- flies the second copy 58 or 60 mm aft;
- sees both copies drawn on top of each other in 2D, 3D and aft views
  (`lineInstances` defaults to 0);
- saves `<instanceseparation>0</instanceseparation>`, which desktop flies
  stacked.
The importer drops a stated 0 (`if (sep !== 0)`), so a desktop file with
stacked lugs comes back 60 mm apart.
Fix: add `instanceSeparation` to `KERNEL_DEFAULTS` for launchlug and railbutton
(checked by the `kernelDefaults.kernel.test.ts` pattern), seed it in
`defaultNode`, read it in `lineInstances`, the panel and `instancesXml`, and
keep a stated 0 on import.

**C3. MED | Lug and rail button angle has no upper bound** | `web/src/components/design/DimensionFields.tsx:496-504` | VERIFIED
The `angle` case passes a lower bound of -180 degrees and no upper bound. A
typed 270 degrees is stored as 4.712 rad, drawn at 270 (`rollAngleOf` in
`tree/componentKinds.ts`), and written as `<angleoffset>270</angleoffset>`
(`exportWriters.ts:296`). `LaunchLug.setAngleOffset` (`LaunchLug.java:113`)
and `RailButton.setAngleOffset` (`RailButton.java:235`) clamp to [-pi, pi]
instead of wrapping, so the kernel and desktop both fly 180. Other angle
setters use `reducePi` and are unaffected.
Fix: pass `Math.PI` as the upper bound, as the desktop spinner stops at 180.

**C4. MED | A multi-row launch edit copies the active row's values onto every ticked row** | `web/src/components/sim/LaunchPanel.tsx:561-575, 596-605`; `web/src/components/sim/WindProfileDialog.tsx:169, 186-209`; `web/src/components/sim/WeatherDialog.tsx:146-166` | VERIFIED
`patchLaunch` applies one fixed patch to every edit target
(`state/store.ts` `patchLaunch` to `patchTargets`), and these handlers build
that patch from the active row:
- a wind speed edit writes the active row's retuned `windStdDev` to all;
- the turbulence % box converts with the active row's average;
- the Wind Profile dialog rewrites `windLevels` on every row;
- the wind model radio seeds levels from the active row;
- Weather Apply with terrain writes the active site's `launchAltitudeM` onto
  rows at other sites.
`launchDiffKeys` already knows when `windLevels`, `windAltitudeReference`,
`launchIntoWind`, `geodetic` and `gravityModel` differ, but the panel marks
none of them mixed and `WindProfileDialog` takes no `diff`.
Fix: patch through a function of each simulation (each row retunes from its
own average); mark those keys mixed; pass `diff` to the profile dialog; leave
`launchAltitudeM` alone on rows at another site.

**C5. MED | The PDF motor table computes its own burn time and average thrust** | `web/src/services/report/rocketReport.ts:33-45`, `web/src/services/motors/motorMath.ts:61-76` | VERIFIED against the Java
`curveStats` takes the last sample's time as the burn and impulse over that as
the average. The kernel (`ThrustCurveMotor.computeStatistics`,
`ThrustCurveMotor.java:707-794`) measures between the crossings of 5% of peak
(`Motor.MARGINAL_THRUST`, `Motor.java:67`). Apogee C6: app 1.32 s and 7.5 N,
kernel 1.20 s and 8.3 N. TSP D12: 1.73 s and 10.9 N against 1.52 s and
12.3 N. The burn, average thrust and T/W columns (`motorsSection.ts:72-91`)
are off by up to 14%.
Fix: expose `getBurnTimeEstimate`, `getAverageThrustEstimate`,
`getMaxThrustEstimate` and `getTotalImpulseEstimate` through the bridge and
print those.

**C6. MED | `.glb` export is 1000 times too large** | `web/src/services/exports/meshExport.ts:27-33, 47-56` | VERIFIED
`meshGroup` scales every export by 1000 for millimeters, and `GLTFExporter`
writes the scale onto the node. glTF's unit is the meter, so a 70 mm nose cone
opens as 70 m in Blender, three.js viewers and AR viewers. The test checks
only the magic number.
Fix: export GLB in meters, keep millimeters for STL and OBJ, and test the node
scale or accessor bounds of a known part.

**C7. MED | The PDF report and component CSV print lengths with fixed decimals in any unit** | `web/src/services/report/pdfPage.ts:393-398`; `partsSection.ts:154, 158, 160, 162`; `reportCsv.ts:30` | VERIFIED
`q`/`qv` default to 1 decimal for every unit, walls to 2, and the CSV to 3.
In inches a BT-50 (0.976/0.950 in) prints "1.0/1.0 in" and walls read
"0.01 in". In meters the CSV writes a 0.5 mm wall as 0.001 or 0. The
schematic export already picks digits per unit (`fmtUpTo`, `ladderDigits`).
Fix: unit-aware digits in `q`/`qv`; significant figures in the CSV.

**C8. MED | `.rkt` writes stale numbers for fields the kernel resolves itself** | `web/src/services/files/rktExport.ts:479-488` (shock cord), `:456` (parachute line length), `:472-473` (streamer Cd) | VERIFIED
The writer ignores `cordLengthAuto`, `lineLengthAuto` and `cdAuto`. A new shock
cord is `cordLength: 0.3, cordLengthAuto: true`; the kernel flies rocket
length times 3 (`ShockCord.java:76-83`), but the `.rkt` writes `Len` 300 mm
and a mass from 0.3 m, which desktop's `mapMassObjectAsShockCord` reads back.
An auto line length goes stale when the diameter changes, and an auto
streamer keeps a Cd typed before the toggle (`DimensionFields.tsx:375-381`).
The `.ork` writer is correct here because it writes `auto`.
Fix: when the flag is on, take the value from `rocket.componentInfo(id)`
(widen `ComponentFigures`), and name the part in `skipped` when there are no
figures.

**C9. MED | `.CDX1` writes any ogive as Tangent Ogive and most Haack noses as Von Karman** | `web/src/services/files/rasaero/sustainer.ts:132-135` | VERIFIED
Desktop maps only ogive parameter 1 to Tangent Ogive and Haack 0 to Von
Karman, and refuses every other parameter (`RASAeroCommonConstants.java:256-276`).
The app writes a secant ogive (0.5) or a Haack at 0.2 as a different nose, so
RASAero computes drag for a shape the design does not have.
Fix: refuse with a keyed error, as `noseFlipped` does, outside desktop's
tolerance of 0.01.

**C10. MED | `.CDX1` exports the default parachute with no recovery** | `web/src/services/files/rasaero/recovery.ts:14-22` | VERIFIED
`ev` defaults to `KERNEL_DEPLOYMENT.deployEvent`, which is `ejection`, and
anything but apogee or altitude is written `Event False / EventType None`. So
every chute on the default event, and most imported ones, exports as no
recovery, with no notice; desktop raises `RASAeroExport.error21` instead. The
Cd fallback is 0.75 where the kernel flies `Parachute.DEFAULT_CD` 0.8
(`RecoveryDevice.java:26`). The event is read from the node, not the active
configuration's override.
Fix: refuse or name the part for an unsupported event; fall back to the kernel
Cd; read the selected configuration's deployment.

**C11. MED | An old unload journal is replayed over newer autosaves from the same tab** | `web/src/state/useWorkspaceEffects.ts:197-203`; `web/src/services/storage/workspaceStore.ts:118-125, 567-590` | VERIFIED (code path; the crash precondition is reasoned)
Every time the tab is hidden, `onHidden` calls `flush()`, which writes the
unload journal. Nothing clears it after a later successful autosave
(`clearJournal` runs only in `load()`), and `journalIsCurrent` returns true at
once when `meta.writer === j.tab`, before comparing `base` or `t`. If the
session then ends without a final pagehide (a browser crash, a killed process,
or a final `saveSync` that exceeds the localStorage quota), the next launch
reopens the design as it was at the earlier hide.
Fix: after each successful write for an id, drop a journal for that id older
than the snapshot; or compare `j.t` with `meta.updatedAt` for a same-tab
journal.

**C12. MED | A failed IndexedDB read rebuilds a stored list from empty** | `web/src/services/storage/idbKeyValueStore.ts:362-374, 395-401` | VERIFIED
When `txUpdate` fails with a non-quota error, `update()` seeds the reducer with
`readIdb(key)`, and `readIdb` returns null both for "nothing stored" and for a
failed read. With IndexedDB failing mid-session (for example WebKit's
"Connection to Indexed Database server lost"), the reducer rebuilds the
design library index, or a custom motor, material, launch site or template
list, from `[]`. That one-item list goes to the localStorage fallback,
`demote` deletes the full IndexedDB copy if it can, and the next session's
`promote` writes the short list over it. Every other saved design is then
unlisted.
Fix: have `readIdb` tell absent from unreadable; when IndexedDB is unreadable
and the fallback holds nothing, refuse the write so `storage-full` surfaces.

**C13. LOW | `.rkt` fin tab depth on a tapered parent uses the whole taper** | `web/src/services/files/rktImport.ts:527-533` | VERIFIED
Desktop (`rocksim/importt/FinSetHandler.java:361-369`) subtracts the parent's
radius drop under the tab only; the app subtracts the full fore-to-aft drop,
so a TTW tab on a tail cone comes in short and the fin light.

**C14. LOW | Freeform fin span ignores a last point below the root** | `web/src/tree/finPlanform.ts:201-214` | VERIFIED formula
`FreeformFinSet.getSpan()` is `max - min(lastY, 0)` after `clampLastPoint`.
The app uses the outline's y-max, so the PDF parts table's span is short on a
boattail or tail cone.

**C15. LOW | A node with no `position` reads as top, 0** | `web/src/tree/nodeProps.ts:126-131` | VERIFIED
The bridge sets the axial method only when a position exists
(`ComponentFactory.java` ~827). Otherwise fins and internal parts keep
`BOTTOM`, lugs and buttons `MIDDLE`. A hand-edited `.ork` with no
`<axialoffset>` draws fins at the parent's top while they fly at the bottom.

**C16. LOW | `chainOuterRadius` reads a keyless body tube as 0** | `web/src/tree/nodeProps.ts:82` | VERIFIED
The bridge builds it at 0.012 m and `bodyTubeRadius` two functions below says
so. Pods and boosters on such a tube are placed closer than the kernel puts
them, and `scaleRocket.maxBodyDiameter` under-reads. Fix: call
`bodyTubeRadius(n)`.

**C17. LOW | A transition with one zero end cannot run** | `web/src/services/design/requiredComponent.ts:185` | VERIFIED
Both radii are required non-zero, though `componentDb.ts:311-314` allows one
closed end and the kernel flies it. Picking SEMROC `BC-08542 [R]` disables
Run. Fix: for typed ends, require at least one end greater than 0.

**C18. LOW | A centering ring with no `outerRadius` and an explicit bore flies with zero wall** | `web/src/services/design/requiredComponent.ts:219-235` | VERIFIED (kernel)
`RadiusRingComponent.setInnerRadius` raises the outer radius to the bore and
turns automatic off, so `{innerRadius: 0.03}` builds a massless ring the app
draws filling the bore. `.ork` import always sets the flag; `.rkt`
(`rktImport.ts:421-428`) can leave the key out. Fix: treat an absent
`outerRadius` as automatic, in `syncAutoRadii` or the bridge.

**C19. LOW | `quietReplace` still saves on tab hide** | `web/src/state/useWorkspaceEffects.ts:197-203`; `web/src/state/fileSlice.ts:374` | VERIFIED
Only the debounced autosave is stopped. After File > New a tab switch creates
an unwanted "Rocket" library row; after File > Open it re-stamps `updatedAt`,
so the library sorts by last opened. Fix: skip the hidden save, the journal
and `flushActive` when nothing changed since the last write.

**C20. LOW | Opening a `.ork` does not flush the outgoing design** | `web/src/state/fileSlice.ts:247-314` | VERIFIED
`openDesign` flushes (`fileSlice.ts:370-377`); `openOrkFile` and
`openExample` do not, and the autosave cleanup cancels the pending save. An
edit less than 500 ms before an import is lost. Fix: `await flushActive()`
first.

**C21. LOW | A held drift sweep does not age when Settings > Simulation changes** | `web/src/state/store.ts:1712-1722` (reader `DriftSweepPanel.tsx:70`) | VERIFIED
The sweep records the tree and the row's inputs but not the global run
preferences, so the landing region stays current after a time step or seed
change. Fix: store the effective prefs and age on `changedPrefKeys`.

**C22. LOW | Some actions record an undo step for a write that changes nothing** | `web/src/state/store.ts:1170-1191, 1284-1287, 1345-1357` | VERIFIED
`setDeployment`, `setSeparation`, `patchLaunch`, `renameSim` and `setSimPref`
call `beginEdit()` without comparing values. A no-op clears redo, and the new
object makes `sameSimInputs` drop an in-flight run. Fix: return early when
the value is unchanged, as `patchSelected` does.

**C23. LOW | Multilevel wind refuses to run over a hidden field** | `web/src/components/sim/LaunchPanel.tsx:232-245, 547-636`; `web/src/services/flight/requiredLaunch.ts:17-25` | VERIFIED
`windAverage` and `windStdDev` stay required while the multilevel panel hides
them, and the only way back to them (the Average radio) deletes the profile.
Fix: require them only when `windLevels` is empty.

**C24. LOW, FIXED | The weather key is saved only on blur** | `web/src/components/sim/WeatherKeyField.tsx:27` | VERIFIED
Resolution: the weather key and the Esri map key share
`components/common/UserKeyField.tsx`, which also writes an edited key when
the field unmounts, so closing Settings with Escape keeps it. A field that was
not edited writes nothing, so a key saved in another tab survives. Pinned by
`tests/components/sim/WeatherKeyField.test.tsx` (fails against the field from
before the fix) and `tests/components/sim/EsriKeyField.test.tsx`.

**C25. LOW | The aft view turns roll the opposite way from the side view** | `web/src/components/canvas/AftView.tsx:529` vs `schematicShapes.tsx:210, 342, 599, 658-661` | VERIFIED
The side view draws theta + roll; the aft view's SVG `rotate(roll)` is
clockwise on screen, giving phi - roll. A single lug at roll 90 sits on
opposite sides in the two views. Fix: `rotate(-roll)` (and negate the drag
delta), with a test of one lug in both views.

**C26. LOW | Tree shortcuts act on the selected row, not the focused one** | `web/src/components/design/ComponentTree.tsx:398-405`, `useTreeEdit.ts:35-75` | VERIFIED
Arrow keys move focus without selecting, so Ctrl+X on row B cuts row A. Fix:
select the focused row first, or make selection follow focus.

**C27. LOW | A fin template's label can sit on the page before its outline** | `web/src/services/report/templatesSection.ts:218-231` | VERIFIED
The label is drawn before `ensure(p, h + 6)` breaks the page. Fix: ensure
`7 + h + 6` first.

**C28. LOW | The parts table shows no material for chutes, streamers and shock cords** | `web/src/services/report/partsSection.ts:168`, `reportCsv.ts:170` (data from `reportModel.ts:132-133`) | VERIFIED
Only `materialName` is read; these parts keep `surfaceMaterialName` and
`lineMaterialName` (`materialSlots.ts:26-29`). Fix: fill from
`materialSlots`, with the matching density unit.

**C29. LOW | The `.CDX1` roughness warning is dropped** | `web/src/services/files/rasaero/surface.ts:230-236`, `web/src/state/fileSlice.ts:652-661` | VERIFIED
A rough or polished finish exports as zero roughness, as on desktop, but the
English warning built for it never reaches the user (`saveRasaero` ignores
`warnings`), where desktop warns. Fix: a keyed note shown like `saveRkt`'s
`skipped`.

**C30. LOW | `.rkt` stage overrides always read back as subtree overrides** | `web/src/services/files/rktExport.ts:799-809` | VERIFIED
`RockSimHandler` (lines 219-262) treats `StageNMass` as the whole stage. A
stage-only override opens in desktop as the subtree's. Fix: name it in
`skipped` (`errors.rktSkip.subtreeOverride`).

**C31. LOW | One unload journal slot for the whole origin** | `web/src/services/storage/workspaceStore.ts:77, 353-355, 569-591` | VERIFIED
With two tabs on different designs, the next boot drops the other tab's
journal (`journal.id !== this.activeId`), and a simultaneous close overwrites
one with the other. Up to 500 ms of edits lost. Fix: key the journal per
design or tab.

**C32. LOW | A malformed thrustcurve.org reply surfaces as an English TypeError** | `web/src/services/motors/thrustcurve.ts:253, 348-350` | VERIFIED
A `null` body or element throws after `post()` returns, bypassing
`fetchFailure`. Fix: guard the shape and map to `errors.thrustcurve.badData`.

**C33. MED | A shoulder flies with the part's wall while the app and the `.ork` say 0** | `engine-java/src/api/java/api/ComponentFactory.java` (cases "nosecone" and "transition"); `engine-java/src/java/info/openrocket/core/rocketcomponent/Transition.java:492-520` | VERIFIED (kernel and desktop)
When a node carries a shoulder length but no shoulder thickness, the bridge
sets the length and nothing else, and `Transition.setForeShoulderLength` (and
its aft and nose cone twins) seeds a shoulder going from length 0 to a length
with the part's own wall. The panel shows a wall of 0, and the `.ork` writes
0, which desktop flies. Six of the bundled examples open this way: their nose
cone shoulders fly with a 2 to 5 mm wall in the app and none in desktop.
Fix: have the bridge always set the shoulder wall (0 when absent), or have the
importers and `defaultNode` carry it, so the app, the file and both kernels
agree. Pinned by `fieldReadback.kernel.test.ts` and the `fields` audit step.

**C34. LOW | The panel shows 0 where the kernel flies its constructor default** | `web/src/tree/kernelDefaults.ts:45`; `web/src/services/design/treeEdit.ts` (`defaultNode`) | VERIFIED (kernel)
`KERNEL_DEFAULTS` has no row for: line instance count (1) on lugs, rail
buttons, centering rings and bulkheads; lug and rail button `angleOffset`
(pi); parachute `cd` (0.8) and `lineCount` (6); packed `radius` of parachutes,
streamers and shock cords; tube fin `thickness` (0.002). A new lug, button,
ring or bulkhead therefore shows 0 copies, and a new parachute, streamer or
shock cord shows a packed diameter of 0 (`defaultNode` writes neither key)
while each flies the kernel's value. Fix: add the rows (verified the way
`kernelDefaults.kernel.test.ts` verifies the others), or seed the keys in
`defaultNode`.

**C35. LOW | A nose cone's automatic shoulder follows the tube's bore past its own base** | `web/src/services/design/autoShoulder.ts:57-76` | VERIFIED (kernel)
`syncAutoShoulders` sizes the shoulder to the bore of the tube behind it, so a
cone narrower than the tube (a 26 mm cone on a 100 mm tube) gets a 96 mm
shoulder. The kernel now flies a stated shoulder as desktop's loader does
(C1), so the app and the kernel agree on the number; the number is still one
desktop's editor would never produce, and on a flipped cone desktop's loader
cuts it to the base, as the kernel now does too (`NoseCone`'s shoulder setter
caps it at the base). Fix: cap the automatic shoulder at the base radius, with
a test that takes the cap from `NoseCone.setShoulderRadius`.

**C36. MED | The `.ork` writes `auto` for line length and cord length, which desktop 24.12 does not read** | `web/src/services/files/ork/exportWriters.ts:337, 360` | VERIFIED (desktop)
Every new parachute and shock cord is automatic, so every saved design that
has one writes `<linelength>auto</linelength>` or `<cordlength>auto</cordlength>`.
Desktop 24.12 has no automatic line or cord length (`javap` of its `Parachute`
and `ShockCord` shows no such setter) and opens them at its defaults: the
every-part sample flies 0.45 m lines and a 3.75 m cord in the app and 0.3 m
and 0.4 m in desktop. Fix: write the resolved number (from `componentInfo`, as
C8 needs for `.rkt`) where desktop cannot read `auto`.

**C37. MED | `.rkt` lugs open in desktop with a larger outer diameter** | `web/src/services/files/rktExport.ts:312-317` (via `writeSurfaceTube`, 363-367) | VERIFIED (desktop probe)
The writer emits `OD` before `ID`. Desktop's RockSim `LaunchLugHandler` (`engine-java/.openrocket-src/core/src/main/java/info/openrocket/core/file/rocksim/importt/LaunchLugHandler.java:61-68`, the same in the 24.12 jar) applies
them in that order, and `LaunchLug.setInnerRadius` rebuilds the outer radius
as the bore plus the current wall (the 1 mm default). The default design's lug
opens at 2.75 mm radius instead of 2.0 mm, about 1.9 times its frontal area.
A probe file with `ID` first opens at 2.0 mm. Fix: write `ID` before `OD` for
launch lugs.

**C38. LOW | `.rkt` export drops repeated lugs and rings without saying so** | `web/src/services/files/rktExport.ts` (no `instanceCount` handling for line instances) | VERIFIED (desktop)
RockSim has no repeat count, and desktop's own export drops it too, so two
centering rings or two lugs open in desktop as one. The writer splits
clusters and pod sets and names other parts it cannot carry in `skipped`, but
says nothing here. Fix: name the part in `skipped`, or write one part per
copy as the cluster split does.

**C39. LOW | The panel shows 0 for a ring part's or tube fin's outer diameter that is absent; the kernel builds it automatic** | `web/src/services/design/fieldRange.ts` (`fieldValue`); `engine-java/src/api/java/api/ComponentFactory.java` (cases "tubecoupler", "centeringring", "bulkhead", "engineblock", "tubefinset") | VERIFIED (kernel)
A tube coupler with no `outerRadius` is built with its outer radius automatic,
and the other ring parts and tube fins keep a radius that follows the parent.
The panel shows 0 for each. Imported `.rkt` rings can leave the key out
(C18). Fix: show the resolved figure, or have `syncAutoRadii` set the flag and
the number when the key is absent.

**C40. LOW, FIXED | A new cluster showed a spacing of 0** | `web/src/services/design/componentFields.ts` (`clusterScale`) | VERIFIED (kernel)
Choosing a cluster writes only `cluster`, and the Cluster scale row showed 0
while the kernel, the `.ork` writer and the drawing use 1. The field now
declares `whenAbsent: 1`. Pinned by `fieldReadback.kernel.test.ts` (its
3-ring cluster seed).

**C41. LOW, FIXED | A clippable transition with no clip flag showed Clipped off** | `web/src/services/design/fieldRange.ts` (`fieldValue`) | VERIFIED (kernel)
The kernel flies it clipped (`Transition.setShapeType` sets clipped to
`isClippable()`) and the `.ork` writer writes true; an imported `.rkt`
transition carries no flag. `fieldValue` now shows the shape's own. Pinned by
`fieldReadback.kernel.test.ts` (its shape seeds).

**C42. MED | `.rkt` writes a mass-only override with its CG at the part's front** | `web/src/services/files/rktExport.ts:216-219` | VERIFIED (desktop)
A part with a mass override and no CG override goes out as `KnownCG`
`mm(overrideCg ?? 0)` with `UseKnownCG` 1, so `BaseHandler.setOverride`
gives it a CG override of 0. Desktop's own `BasePartDTO` writes
`getOverrideCGX()`, which is the part's own CG when the CG is not overridden.
The bundled simulation-extensions and simulation-scripting examples, and the
overridden parachutes in four others, open with their CG moved to the part's
front. Fix: write `KnownCG` from `componentInfo(id).cgX` for a mass-only
override, and name the part in `skipped` when there are no figures.

**C43. HIGH, FIXED | The bridge never applies a stage's mass or CG override** | `engine-java/src/api/java/api/OpenRocketEngine.java:309-331` (stages are built with `new AxialStage()` and only `applySeparationConfig`) | VERIFIED (kernel and desktop)
Resolution: the override block in `ComponentFactory.create` is now
`ComponentFactory.applyOverrides`, and `buildRocket` calls it for each stage
after attaching its parts (a parallel stage already went through `create`).
The every-part sample gives its booster a mass and CG override for the whole
stage. Pinned by `tests/engine/stageOverride.kernel.test.ts` (the stage holds
the stated override, its mass breakdown flies 1.36 kg, and a lower stage's CG
override is measured from that stage's front; both cases fail against the
engine from before the fix) and by the `fields` step of `npm run audit`,
which now agrees with desktop on the dual-parachute-deployment sustainer and
the every-part booster. The finding as reported:
The common overrides in `ComponentFactory.create` run for parts, never for a
stage, and nothing applies them to stages. The app reads a stage's override
from the file, shows it, and writes it back, and desktop applies it; the
app's kernel flies the stage without it. The bundled dual-parachute-deployment
example's sustainer carries a 1.36 kg override, with its subcomponents
covered, that the app does not fly. Fix: apply the overrides to each stage and
parallel stage after they are built, and add a stage override to the
every-part design.

**C45. LOW | A zip whose data descriptors carry no signature is refused** | `web/src/services/files/ork/importUnpack.ts` (`unzipCapped`) | VERIFIED (fflate; desktop REPORTED)
APPNOTE 4.3.9.3 lets a data descriptor (sizes after the data) omit its
signature. fflate's streaming `Unzip` then trims the wrong number of bytes
when it finds the end of the member, and the file is refused with
`errors.file.archiveCorrupt`. Java's `ZipInputStream` accepts both forms, so
desktop opens such a file; the central-directory reader before S2 did too.
Desktop and fflate write the signature, so only a `.ork` re-zipped by an
uncommon streaming tool meets this. Fix: read such a member through the
central directory, with the same caps.

**C44. MED | Two automatic ends that follow each other keep their stored radius in the app** | `web/src/services/design/autoRadius.ts` (`syncAutoRadii`) | VERIFIED (kernel and desktop)
In the bundled dual-parachute-deployment example the nose cone's base
(`<aftradius>auto 0.028321`) and the body tube behind it (`<radius>auto
0.025`) each follow the other. Desktop flies the tube at 28.3 mm, and so does
the kernel in this build; the kernel's answer for such a pair depends on which
part was read first (`BodyTube.getAutoOuterRadius` caches the part it
follows), so a test of the fix takes its expected value from desktop
(`check:fields`), not from a read of the kernel; the app's resolver leaves the node at the stored 25 mm, so the panel
and the drawing show 25 mm and the `.rkt` writer emits a 50 mm OD, which
desktop then flies. Fix: resolve a mutual pair as the kernel does, and add the
pair to `geometryParity.kernel.test.ts` and to the read-back test's seeds.
Pinned today only by the `fields` step of `npm run audit`.

## 🟡 Accessibility

**A1. MED, FIXED | The last visible stage chip is an inert toggle** | `web/src/components/canvas/FlightChart.tsx:75-80, 258-273` | VERIFIED
Resolution: the only stage still shown is `aria-disabled`, with the reason
("At least one stage stays on the chart.") as its title in every locale. It
stays focusable, so the reason can be read, and turns back on as soon as
another stage is shown. Pinned by
`tests/components/canvas/flightChartReadouts.test.tsx` ("the stage chips"),
which fails against the chart from before the fix (it set no such state).
The finding as reported:
`toggleStage` refuses to hide the last stage, but the chip stays enabled with
`aria-pressed=true` and gives no feedback. Fix: disable it (or
`aria-disabled` with a reason) when it is the only one on.

**A2. MED, FIXED | The caliper readout fails contrast in light and daylight** | `web/src/components/canvas/SchematicCalipers.tsx:94-105, 183-194` | VERIFIED (code; contrast computed from `index.css` tokens by the agent)
Resolution: both caliper boxes are drawn in the theme's surface color
(`token('surface')`) under the accent text. Pinned by
`e2e/schematic-interaction.spec.ts` ("the caliper readouts hold 4.5:1"), one
test per theme, which measures the rendered text against its box in the
browser. With the old fixed box the same measurement is 3.81:1 in light and
3.29:1 in daylight.
The finding as reported:
9 px bold `var(--accent)` text on a fixed `rgba(13,14,18,0.92)` box: about
3.2:1 in light and 2.7:1 in daylight. No gate sees it: the calipers are off in
every scanned state, and axe does not judge SVG text. Fix: draw the tag from
theme tokens, or use `token('sch-label')` for the text.

## 🟠 Tooling and gates

**T1. MED | Native `<details>` popups are not on the popup list** | `web/tests/popupSurfaces.test.ts:17, 50`; `web/e2e/a11y.spec.ts:666-673` | VERIFIED
The list counts `aria-expanded=` only, so `CheckMenu` (`CheckMenu.tsx:61`,
behind the motor picker and dashboard filters and columns) and the Off the
rail details (`OffTheRail.tsx:236`) are never opened in a scan. Popups also
lack the "scans at least surfaces" check dialogs have: `ComponentTree` lists 2
and has 1 scan, and the row fold (`ComponentTree.tsx:204`) is never scanned.
Fix: count `<details`, add the scans, add the count check.

**T2. MED | The engine banner, update banner and view fallback are never scanned** | `web/e2e/a11y.spec.ts:687-701`, `web/e2e/base.ts:206-220` | VERIFIED
Every scan waits for the engine, so `EngineNotice` (loading, stalled, failed),
`UpdateToast` (`UpdateToast.tsx:282`) and `ErrorBoundary`'s fallback
(`ErrorBoundary.tsx:51`) are never on screen under axe, in any theme. Fix:
force each state and scan it.

**T3. MED | The Help and Safety scans can pass on the loading placeholder** | `web/e2e/a11y.spec.ts:331-334`, `web/src/components/layout/HelpPageFrame.tsx:44-58` | VERIFIED code, REPORTED timing
They wait only for the dialog; the docs frame is `opacity-0` until ready, and
with `public/docs` missing the scan passes on `help.missing`. There is no CI
precondition like `help-dialog.spec.ts:33-41`, and Safety is never scanned
loaded. Fix: wait for the frame's ready state; fail under `CI` without
`public/docs/index.html`.
Seen failing: in a full `npx playwright test` run on 2026-10-13 the dark theme
"Popup / help contents" scan reported a link in the docs frame at 2.3:1
(#817043 on #4d3800), colors of the frame partway through its fade; the same
scan passed 8 of 8 runs alone and in two other full runs. The next full run
failed the same way on the "Help" scan, same element and same colors, so the
frame passes through one state that fails, and a scan that does not wait for
it settled lands there under load. A scan that reads a frame before it
settles fails at random as well as passing on a placeholder.

**T4. MED | `scriptsReferenced` counts a script naming itself** | `web/tests/scriptsReferenced.test.ts:174-189` | VERIFIED
The haystack includes each script's own file. `gen-icons.mjs:2`,
`sync-components.mjs:23`, `sync-examples.mjs:11`, `sync-motors.mjs:8`,
`sync-contributors.mjs:15`, `sync-materials.mjs:7` and `lib/dataManifest.mjs`
name themselves by path, so the gate stays green if they lose every caller.
None is orphaned today. Fix: build the haystack without the script's own
file.

**T5. MED | Which CI check guards master is not stated** | `.github/workflows/dev.yml:40-57`, `ci.yml:3-6`, `docs/DEVELOPER.md:190` | REPORTED (branch protection not visible)
The only required check named is `Dev / verify`, from a push to a branch in
this repository. If the pull request run is not required, a failing merge
result reaches master and Pages; a pull request from a fork can never get
`Dev / verify`. Fix: a `verify` aggregator in `ci.yml` and require it.

## 🟠 Reference data

**R1. HIGH | The published parts catalog comes from an older pipeline** | `.github/workflows/sync-catalogs.yml:26-29` (master's copy runs the schedule) | VERIFIED
Scheduled runs use master's workflow, which checks out
`dbcook/openrocket-database@772db251` instead of the
`openrocket/openrocket-database@1512874a` OpenRocket 24.12 pins, and has no
`check:digests`, no entity decoding and no parachute fields. The `data`
branch (30104dbe) serves 5231 parts: 123 without a digest (113 LOC Precision,
4 Rocketarium, 3 LOC, 2 BalsaMachining, 1 Maadcow), 4 rail buttons desktop
24.12 does not have, 3 digests on two rows each, 23 descriptions with a raw
`&gt;`, no parachute line or packed fields, and a manifest that still names
materials and contributors. The committed copy is correct: 5228 rows,
per-type counts equal to `PresetDump` for 24.12, every digest 1:1.
Fix: once this pipeline is on master, dispatch Sync Catalogs; add a `push`
trigger on master for `web/scripts/**`, the pin file and the workflow.

**R2. MED, FIXED | The app prefers the data host's catalog even when it is older** | `web/src/services/app/remoteData.ts:49, 244-253` | VERIFIED
Resolution: the data host is the only source of the motors and components in
a build that has one, so there is no older copy to prefer or fall back to.
`vite.config.ts` leaves the build's own copy of the two out of the output and
the precache; offline, the service worker answers from its cached download
(`astra-catalogs`), which `services/app/warmCatalogs.ts` fetches in the
background on the first visit. Pinned by `tests/services/app/remoteData.test.ts`
(a hosted catalog is never read from the build, even with the host down; these
fail against the loader from before the change) and
`tests/services/app/warmCatalogs.test.ts`.
The finding as reported:
The host copy wins whenever it parses. `isComponentRow`
(`componentDb.ts:296-303`) accepts parachute rows without the new fields, and
`parachutePatch` (`treeEdit.ts:543-551`) then falls back to 6 lines, default
materials and no packed size. Fix: a schema version in the manifest; prefer the
build's copy when the host's is older or different.

**R3. LOW, FIXED | The default thrust curve can depend on API order** | `web/scripts/sync-motors.mjs:176-182, 213-221` | VERIFIED code, REPORTED variability
Resolution: the ranking is `scripts/lib/rankCurves.mjs`, which ends on the
file's thrustcurve.org `simfileId`, so two files that tie on source, format and
sample count always come out the same way round. The sync refuses a file with
no id rather than fall back to API order. Desktop has no fixed final key either
(`ThrustCurveMotorSet`: sample count, then comment length, then insertion
order). Pinned by `tests/services/motors/rankCurves.test.ts` (every order of
three tied files ranks the same; fails against the comparator from before the
fix). The catalog changes at the next sync.
The finding as reported:
Ties on source, format and sample count keep the API's order, and `curves[0]`
is the default flight curve and sets the loaded mass. Five motors tie at index
0: AeroTech H242 (241 vs 250 Ns), I195 (420 vs 466), I435 (552 vs 587), I284
(585 vs 591), Hypertek J250 (716 vs 644). Fix: a final tie-break on the
samples or file id.

## Upkeep

No severity; not counted with the defects.

**U1. A comment states something untrue or out of date**
- Fixed with S1: `web/src/services/files/ork/importUnpack.ts` said "Streamed, so the count stops the inflation" of a reader that was not; the reader now is, and the comment describes the slices. `web/tests/services/files/designFile.test.ts:147-151` ("capped like a zip member's") is now true.
- `web/src/services/motors/rseParser.ts:17-18`: "No `MotorDigest` ... nothing here does that". `ork/embeddedMotors.rseDigest` and `motorDigest.ts` do.
- `web/src/services/files/ork/embeddedMotors.ts:74-78`: the `rseDigest` doc omits that desktop hashes MASS_SPECIFIC when `auto-calc-mass` is absent or true.
- `web/src/services/files/rktImport.ts:527-529`: describes a tab depth rule desktop does not use (C13).
- `web/src/services/motors/thrustcurve.ts:15`: "may also lack motorId"; `CatalogMotor` has no `motorId` field.
- `web/src/services/storage/workspaceStore.ts:353`: "a design that no longer exists"; the check is "not the active design" (C31).
- `web/src/services/storage/idbKeyValueStore.ts:279-287`: "A copy in the fallback is always the newer one" does not hold for a fallback built from a null seed (C12).
- `tree/componentKinds.ts` `rollAngleOf` ("as the kernel flies it"), untrue for a lug or rail button angle past 180 degrees. See C3.
- `web/src/components/design/MaterialPicker.tsx:33-44`: the component's JSDoc sits above `MaterialUse`.
- `web/src/components/canvas/GroundTrack.tsx:67-68`: "Share the chart's unit scope". `FlightChart` uses unscoped `distance`; GroundTrack and `EnvironmentLanding.tsx:53` use `unitScope('sim','apogee')` while the Downrange tile uses `unitScope('sim','downrange')` (`SimSummary.tsx:179`), so the same landing distance can read in two units.
- `web/src/components/canvas/Rocket3D.tsx:26-27`: "cylinders for tubes"; tubes are annulus lathes.
- `web/src/services/report/layout.ts:235, 245`: `hexToRgbTuple` and `finSetsOf` "Exported for test"; both are used in `src`.
- `web/src/services/report/markingGuide.ts:155-159`: fin rotation is written in `ork/exportParts.ts:305-307`, not `exportWriters.ts`.
- `web/src/services/files/ork/exportDesignInfo.ts:~5`: "OpenRocket 24.12, the pinned upstream". The pinned upstream is `unstable` at 591c5e5; 24.12 is the desktop release.
- `web/src/tree/placement.ts:17-20` ("separation 0 by default"), `web/src/tree/nodeProps.ts:112-117` (top, 0 is "the kernel's own default"), `web/src/tree/finPlanform.ts:190-200` (y-max is the span). See C2, C15, C14.
- `web/src/engine/openRocketEngine.ts:27-28`: WASM-GC "(faster, smaller)"; the WASM is 2.7 MB against a 1.1 MB JS chunk.
- `web/src/engine/openRocketEngine.ts:725-728`: `StaticInfo.cd` is filled by `computeStaticInfo` in `services/design/buildRocket.ts:109`, not the store.
- `web/src/services/parts/componentDb.ts:16-21`: names `Parachute.loadPreset` (it is `loadFromPreset`) and says every other part folds mass into density; rail buttons use a mass override (`componentDb.ts:140-143`).
- `web/src/services/flight/flightColumns.ts:8-11`: the app asks for `full` series (`simulations.ts:513`); only forecast runs use `summary`.
- `web/src/services/design/treeEdit.ts:498-503`: `presetShoulder` is not applied as `Transition.loadFromPreset` applies it (`Transition.java:933-936, 949-952`); no shipped row has the differing shape.
- `web/tests/srcExportReach.test.ts:67-68`: knip does not report a type exported only for tests. `RocketSpec` (`openRocketEngine.ts:493`) is used only by tests; move it to `tests/testing`.
- `web/tests/scriptsReferenced.test.ts:176-178`: the self-match claim (T4).
- `web/scripts/lib/digestCoverage.mjs:105-107`: "parts about 98%"; the pipeline gives 100%.
- `.github/workflows/sync-catalogs.yml:12-13`: the local refresh recipe leaves out `npm run sync:database`.
- `web/scripts/sync-examples.mjs:27-29`: only motors and components are served from the data branch.

- `web/src/services/flight/flightConfigs.ts:430, 432`: the join separators are literal U+0001 and U+0002 characters in the source, invisible in an editor; write them as `'\u0001'` and `'\u0002'`. (A test comment in `orkImportHostile.test.ts` carried the same bytes and was rewritten with S2.)

**U2. User and maintainer docs that state what the code does not do**
- Fixed: `docs/DEVELOPER.md` said `npm run audit` runs `verify:ci`; it runs the coverage half, and now says so.
- `docs/AUDIT_PROMPT.md:25`, `.github/workflows/deploy.yml:5`, `docs/DEVELOPER.md:196`: "deploy runs no gates"; `deploy.yml:83` runs `npm run build` (typecheck, lint, vite build).
- `docs/AUDIT_PROMPT.md:27` and `web/e2e/a11y.spec.ts:541-545`: every popup is "scanned in the state the page does not open in". `LoadedBanner`'s notes open by default (`settings.ts:497`) and are scanned open (`a11y.spec.ts:619-623`); see also T1.
- Fixed: `docs/AUDIT_PROMPT.md` pointed slice 1 at `engine-java/src/java/info/openrocket/core/file/`, which does not exist; it now names `engine-java/.openrocket-src/core/src/main/java/info/openrocket/core/file/`.
- `docs/ARCHITECTURE.md:131`: `sync:motors` only stages; `sync:motor-digests` writes `public/data`.
- `docs/ARCHITECTURE.md:167-168`: `sync-components` reads the jar's materials through MaterialDump (`materials.generated.json` only with `--internal`), and PresetDump reads the release's `.orc` files.
- `docs/ARCHITECTURE.md:174`: rows the build lacks are removed, and the refusal rule is per key (`digestChanges`) plus the floors.

**U3. A duplicated helper or list that has drifted**
- `web/src/services/motors/curveFinalize.ts:33-51` and `web/src/services/files/ork/embeddedMotors.ts:39-55`: two ports of `finalizeThrustCurve`; only one sorts first, and desktop sorts before hashing, so `rseDigest` misses on out-of-order rows (the designation match covers it today).
- The line instance separation default of 0 in `exportWriters.ts:45`, `tree/placement.ts:28` and `importTags.ts:178` (C2).
- `web/src/tree/nodeProps.ts`: `chainOuterRadius` and `bodyTubeRadius` disagree on a keyless tube (C16).
- `web/src/components/layout/HeaderDialogs.tsx:73, 103`: Save As builds its own name chain and skips `tree.name`; `appInfo.ts:140` `designNameOf` is "the one copy". A rocket renamed in Rocket configuration is offered its file name.
- `web/src/components/layout/SettingsTabs.tsx:437-490`: `NumRow`/`NumField` copy `common/NumberRow.tsx` (padding and unit width differ) because `NumberRow` has no `commitOnBlur`.
- `web/src/components/canvas/chartSummary.ts:44`: a local `withUnit` that always inserts a space; the shared one (`i18n/format.ts:67`) attaches the degree sign, so screen reader summaries read "12.3 °".
- `web/src/components/sim/MotorComparePane.tsx:12-16, 18-20`: the same doc block twice.
- `web/scripts`: the built-in material density map is built from the jar in `sync-components.mjs:180-196` and from `materials.generated.json` in `sync-preset-digests.mjs:96-101`, which holds a material 24.12 lacks; `arg()` is copied five times with different missing-flag results.
- `web/e2e/a11y.spec.ts:51` waits 20 s for the Aero chart, `a11y-phone.spec.ts:45` the default; `a11y.spec.ts:157-163` repeats `resultView` (`:235-239`).

**U4. Gaps in the mechanical gates**
- `commentsStateTheConstraint.test.ts` does not scan the web root configs, the workflow YAML, `website/src` or `index.html`. Scanned by hand with its patterns: no history comments found.
- `geometryParity.kernel.test.ts` never builds: automatic transition ends wider than 25 mm with shoulders (C1); a lug with `instanceCount` above 1 or a keyless separation (C2); pod or booster `angleOffset` other than 0, or compares their angles; inner tube `clusterRotation`, `radialPosition` or `radialDirection`; a freeform outline not starting at [0, 0]; tab offset methods `absolute` or `after`; tube fin `rotation`; a keyless `position` (C15). It never compares `finSpan` with `getSpan`, and checks profiles only through `stationRadius`, not `rocketSideView` or `profileMm`.
- `geometryFlags.test.ts`: no 'PDF parts table' in `FIN_READERS` (C14); no RockSim export in `READERS` or `UNAFFECTED` (`rktExport.ts:544, 677` read `flipped` and `profileEnds`); `rocketPrintExport.solidFor` only in `FIN_READERS`. One shape per part, `shapeParameter` never toggled, no flag set inside a pod; for the filled tube with a ring, four readers react only to the tube.
- The `meshExport` test checks only the GLB magic (C6).

## Recommended order of attack

Each fix removes its `KNOWN` entries from `fieldReadback.kernel.test.ts` and `check-desktop-fields.mjs`; those checks are its test, and a fix not pinned by them needs one whose expected value comes from the kernel, the Java or desktop. Run the change audit (`docs/AUDIT_PROMPT_CHANGES.md`) on each batch.

1. Done: **C43** and **C1**.
2. **C33**: always set the shoulder wall in the bridge; six bundled examples fly a different nose cone from desktop until it lands.
3. Done: **S1**, **S2** and **S3**.
4. Small, verified file fixes: **C3** (one argument), **C37** (write `ID` before `OD`), **C42** (the part's own CG for a mass-only override), **C10** (refuse the event, kernel Cd), **C9** (refuse the parameter), **C6** (GLB in meters).
5. **C2** and **C34**: the missing rows in `KERNEL_DEFAULTS`, verified by `kernelDefaults.kernel.test.ts`, then the drawing, writer and importer reading them. With them, **C44**: resolve a mutual pair of automatic ends as the kernel does.
6. **C12** and **C11**: the two lost-work paths in storage, each with a store test.
7. **C4**: per-target patches and mixed markers in the launch panel.
8. **C5**, **C8** and **C36**: all need kernel figures through the bridge (`componentInfo` and the motor estimates); do them in one bridge change.
9. **C7**: report digits.
10. The gate gaps **T1** to **T4**, then the U4 test generator gaps, so the next audit has less to find by hand.
11. **R1**: put the catalog pipeline on master and dispatch it.
12. **T5**: confirm the required check.
13. The LOW findings, grouped by file: storage C19 to C21, C31 and C32; state C22; tree C14 to C16; importers C13, C17, C18; design C34, C35 and C39; launch panel C23; canvas C25 and C26; report C27 and C28; writers C29, C30, C38; reader C45.
14. Upkeep, by rule: U2 first, since docs are what a reader acts on.

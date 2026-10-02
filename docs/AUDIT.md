# AUDIT - `web/` engineering audit

Date: 2026-10-01. Branch `test` at b610c12. Run per `docs/AUDIT_PROMPT.md`, six
parallel review agents over five slices, every HIGH finding re-verified against
the source before entry here.

Scope: the `web/` package. `web/src/engine/vendor/` is generated TeaVM output and
was not audited. `engine-java/` has its own prompt and its own report.

## How to read the verification tags

- **VERIFIED** means the cited lines were read and the claim confirmed
  independently of the agent that raised it.
- **REPORTED** means a review agent raised it with a file:line and a failure
  scenario, and it is plausible on inspection, but it was not independently
  re-read. Treat these as leads, not as facts.
- Three agent-supplied line citations were wrong by 100 lines or more. Every
  citation below was re-resolved by content. If a line number does not match what
  you see, search for the quoted expression.

## Gate picture, measured

Established directly, not relayed:

| Gate                                        | Covers                                                                                                      | Trigger                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `format:check`                              | all of `web/` minus `.prettierignore`, including all 10 locale files                                        | PR, master, push to `dev`        |
| `spell`                                     | `web/src`, `web/tests`, `web/e2e`, `web/scripts`, workflows, root `*.md`, `docs/**`, and `en.json` only      | PR, master, push to `dev`        |
| `typecheck`                                 | 3 tsconfigs (src plus tests, e2e, node configs)                                                             | PR, master, push to `dev`        |
| `lint`                                      | 705 files, 0 errors, 0 warnings, no type-aware rules                                                        | PR, master, push to `dev`        |
| `knip`                                      | exits 0 clean                                                                                               | PR, master, push to `dev`        |
| `vitest run`                                | 235 files, 3252 tests, all passing                                                                          | PR, master, push to `dev`        |
| coverage floor                              | `lines >= 55` only                                                                                          | PR and master only               |
| `vite build`                                | not in `verify`                                                                                             | PR and master only               |
| e2e, 3 shards                               | 29 specs, Chromium                                                                                          | PR and master only               |
| engine `parity`, `reproducible`, `validate`  | all three present and running                                                                               | PR and master only               |

Measured coverage, this run: lines **74.13%**, statements 72.92%, branches
65.83%, functions 65.15%. The floor is 55 and applies to lines only.

Confirmed closed, do not re-report: `knip` is clean. `prettier --check` passes on
every matched file including `web/src/i18n/locales/es.json`, so the prompt's claim
of pre-existing drift is stale. `validate` does run in CI, in `gates.yml`, so the
engine prompt's claim that nothing runs it is stale. All five `eslint-disable`
comments target an enabled rule and none is inert.

---

## Security

### S1. CSV formula injection in the flight-events export (MED, VERIFIED)

`web/src/services/exports/csvExport.ts`, the `text()` helper used by
`flightEventsCsv`, quotes and strips newlines but does not neutralize a leading
`=`, `+`, `-`, `@`, TAB or CR. The Event, Source and Stage columns carry component
and stage names taken from the imported design, so they are attacker-controlled
through a shared `.ork`.

The project's own rule lives one file away: `reportCsv.ts` prefixes an apostrophe
when `/^[=+\-@\t\r]/` matches, and its comment says "Same rule as
flightPathExport.ts". Spreadsheets strip CSV quoting before evaluating, so quoting
alone does not stop it.

Fix: reuse `reportCsv.ts`'s `cell()`.

### S2. The `.ork` caps bound bytes but not element count (MED, REPORTED)

`web/src/services/files/ork/importLimits.ts` caps archive entries, per-entry and
total inflate bytes, nesting depth, configuration count, fin count, instance
count, point count and line count. It does not cap total component count, and
`importReaders.ts` `convertChildren` walks every `<subcomponents>` child with no
ceiling. Each component is then re-scanned once per declared configuration by
`importConfigs.ts`, which caps the configuration side only and whose comment
reasons explicitly about this product.

A `<bodytube/>` is about 13 bytes, so the 64 MiB per-entry ceiling admits millions
of components from a small zip. The result is a hung tab, not the clear error
`importLimits` promises.

Fix: add a component counter to `importLimits` and throw from `convertChildren`
and `rktImport.readParts` in the style of the nesting-depth error.

### S3. Embedded motor files are parsed without caps (MED, REPORTED)

`web/src/services/motors/rseParser.ts` `parseRse` maps every `<engine>` in the
document and every `data > eng-data` row with no limit. It is reached with no file
picker: `loadOrk.ts` parses each `.rse` member the untrusted `.ork` carried. The
`.ork` reader caps fin points and line counts for this exact reason; the
embedded-motor path caps nothing.

Fix: cap engines per file and samples per engine, and report truncation as an
import note the way `readPointList` does.

### S4. Unescaped template output for unknown extensions (LOW, REPORTED)

`flightPathExport.ts` `escaperFor` returns identity by default, so a user Mustache
template whose name does not resolve to kml, gpx, xml or csv renders every value
unescaped. `templateStore.parseTemplateFilename` defaults a bare name to `txt`.

Fix: add a `json` case and make the default strip control characters.

### S5. The response cap bounds the buffer, not the transfer (LOW, VERIFIED)

`web/src/services/app/fetchProgress.ts` throws "response too large" without
calling `reader.cancel()`, and neither caller aborts the controller afterward. The
abandoned transfer stays in flight while the fallback base is tried.

Fix: `await reader.cancel()` before throwing, or abort in the caller's catch.

**Verified clean, do not re-report.** Zip-bomb caps are genuinely applied on the
path the app uses: `importUnpack.ts` counts entries and sums `originalSize` inside
fflate's pre-inflate `filter`, with hostile tests firing each cap. Unbounded
`<subcomponents>` recursion throws past depth 100 in both readers. XML escaping is
applied to every file-sourced string on all three export formats. DXF group-code
injection is blocked by an ASCII filter. Remote fetches have staged abort timers,
content-length checks, streamed caps and shape validation on both the network and
cache paths. No `obj[untrustedKey] = ...` write exists anywhere in the parser
slice. No `dangerouslySetInnerHTML` in any component. All external links carry
`rel="noreferrer"` or `rel="noopener noreferrer"`. XXE is not applicable under
browser `DOMParser`.

---

## Correctness

### C1. The fin planform is duplicated in the 2D schematic (HIGH, VERIFIED)

`web/src/components/canvas/schematicShapes.tsx` builds the trapezoid polygon and
the elliptical arc itself. It imports only `FIN_DEFAULTS`, `finRootChord` and
`finSpan` from `tree/finPlanform.ts`, not `finPlanformPoints`.

Two kernel rules that `trapezoidFinPoints` applies are missing from the copy:

- the tip collapse, where `tip > 0.0001` emits a three-point triangle rather than
  a trapezoid with a zero-length tip edge;
- the root floor, `Math.max(root, MIN_ROOT)`.

So a `.ork` carrying `rootChord <= 0` draws a degenerate polygon in the side view
while the 3D view, the STL, the DXF and the PDF all draw the floored shape.

The docblock on `tree/finPlanform.ts` names the 2D schematic as a consumer and
states that no consumer may sample a fin outline itself. The comment above the arc
reads "a true half-ellipse", which is the same phrase the module history records
as how the previous wrong curve propagated.

Fix: call `finPlanformPoints(child)` and project the returned pairs, as the
freeform branch already does.

### C2. The recurrence guard scans the wrong tree (HIGH, VERIFIED)

`web/tests/tree/finPlanform.kernel.test.ts`, in the `no module grows its own fin
sampler` block, resolves its scan root with
`fileURLToPath(new URL('..', import.meta.url))`. From
`web/tests/tree/finPlanform.kernel.test.ts` that is **`web/tests/`**, not
`web/src/`. It then excludes `*.test.ts` and `*.test.tsx`.

Proven by executing the guard's own directory walk against that root: it reads
exactly six files, all of them helpers under `web/tests/testing/`, and not one
source file. None of its three `ALLOWED` paths exists under that root.

This guard is the stated defense against the elliptical-fin bug recurring, the bug
that survived three audits. It has never examined a source file, and C1 is a live
violation it should have caught.

A second hole remains even after the root is fixed: the pattern
`/Math\.(sin|cos|acos|asin)\(Math\.PI/` requires `Math.PI` as the literal first
token, so a sampler written the way `finPlanform.ts` itself writes it, binding the
angle to a local first, does not match.

Fix: point the root at `../../src/`, broaden the pattern to any
`Math.(sin|cos|tan|asin|acos|atan2)` in a file that also mentions a fin key, and
confirm the guard fails on a deliberate copy before trusting it again.

### C3. The stability percentage is recomputed app-side (HIGH, VERIFIED) - FIXED 2026-10-02

**Fixed.** All three sites now read `info.stabilityPercent`. Details at the end of
this entry.

`web/src/services/report/designInfo.ts` pushed
`((info.cp - info.cg) / info.length) * 100`.

`StaticInfo` carries `stabilityPercent` on the same object, and its docblock in
`web/src/engine/openRocketEngine.ts` says, verbatim: "Read from here rather than
computed per view as `((cp - cg) / length) * 100`, which is the right shape over
the wrong denominator: `length` bounds every component, so any design with a
non-aerodynamic part outside the aerodynamic envelope reads a percentage the
desktop does not show." The sibling field's docblock adds "Do not re-derive either
one here."

The correct divisor, `lengthAerodynamic`, is also on the object and documented as
"Not the same as length". This value is written into saved `.ork` files, so it
outlives the session.

**Two more sites the audit missed.** The audit named one file; there were three.
`web/src/services/report/reportCsv.ts` and `web/src/services/report/pdfPage.ts`
both carried the identical expression,
`info.length > 0 ? ((info.cp - info.cg) / info.length) * 100 : 0`, feeding the
`Stability (%)` row of the exported summary CSV and of the printed PDF report. Both
were found by grepping for the expression after fixing the first, not by the slice
file lists. So the three writers would have disagreed with the four view components
as well as with the desktop: `InfoOverlay`, `SchematicOverlay`, `StabilityBadge` and
`StabilityCallout` all already read `info.stabilityPercent` with the comment "The
engine's own figure, not ours". The report writers were the only holdouts, and the
PDF is the copy that goes to a launch.

**What was done.** All three sites now read `info.stabilityPercent`, each with a
comment naming the aerodynamic-length denominator. The old
`length > 0 ? ... : 0` fallbacks emitted a literal `0` for a design with no usable
length; the value now passes through each module's own formatter, which degrades
honestly, `round` to an empty cell in the CSV and `fmtNum` to a dash in the PDF,
matching how `designInfo`'s `push` omits the row.

**The test was vacuous and is not any more.** `designInfo.test.ts` asserted only
`expect(f['Stability (%)']).toBeDefined()`, which passes under either formula, and
its fixture cast past `stabilityPercent` with `as StaticInfo` so the field was
`undefined`. The fixture now carries `lengthAerodynamic: 0.4` against
`length: 0.425` and `stabilityPercent: 31.5`, chosen so the wrong denominator
yields 29.65 and the right one 31.5, and the assertion pins the value. Verified
discriminating: restoring the old expression fails the test
(`expected ... to match object { value: '31.5' }`), restoring the fix passes it.
This is the pattern C2 asks for applied to a second port, and it is why the
original formula survived three audits here.

All three fixtures were vacuous the same way, and all three are fixed:
`reportPdf.golden.test.ts` and `reportCsv.test.ts` also cast past
`stabilityPercent`, so the first run after the fix produced a blank percentage in
the PDF golden rather than a number. Each fixture now carries a
`lengthAerodynamic` shorter than its `length`, and the CSV test gained the
assertion it never had. The PDF golden moved on exactly four lines, `12.5 %` to
`13.6 %`, which is the wrong denominator giving way to the right one; nothing else
in the snapshot changed.

Gates rerun locally, all green: `format:check`, `spell` (673 files),
`typecheck` (3 projects), `lint` (`--max-warnings 0`), `knip`, and the full unit
suite at 235 files / 3252 tests.

### C4. Grounding a stage does not rebuild the engine (HIGH, VERIFIED)

The rebuild effect in `web/src/state/useWorkspaceEffects.ts` depends on
`[ready, enginePhase, components, seated]`. `seated` is `seatedMotorsKey`, which is
`mountId:specSerial` per live mount; `liveMotors` iterates `findMounts(tree)` and
checks `config.motors[id]`, with no reference to `grounded`. `setStageFlies`
replaces `configs` only, so neither key moves.

`buildConfiguredRocket` does honor it: it calls `setStageActiveById(id, false)` for
every grounded stage.

So after grounding a booster the worker flies the sustainer-only rocket while
`info` still describes the full stack. The stats strip, the stability badge, the
Run button and the RASAero launch mass all describe a different rocket from the one
that flew.

Fix: fold `config.grounded` into the rebuild key, or add a
`buildKey(tree, config)` in `services/design/buildRocket.ts` covering every input
the build reads.

### C5. `loadOrk` discards two carried configuration fields (HIGH, VERIFIED)

`OrkFlightConfig` declares `separations: Record<string, OrkSepOverride>` and
`grounded: string[]`, both non-optional, both documented as "carried for the same
reason the deployments are". `LoadedConfig` in
`web/src/services/files/loadOrk.ts` declares only `id`, `name`, `motors` and
optional `deployments`, and the mapping copies only those four.

So opening a `.ork` whose configuration carries
`<stage number="1" active="false"/>` or a `<separationconfiguration>` silently
drops both. `saveOrk` then writes the undefined value back and the file loses the
setting permanently.

The existing round-trip test passes because it goes `importOrk` to `exportOrk`
directly and never through `loadOrk`.

Fix: add both fields to `LoadedConfig`, copy them in the mapping and in the
fallback literal, forward them in `wireLoadedOrk`, and extend the two tests.

### C6. Printable solids bypass mesh validation (HIGH, VERIFIED)

`validateSolid` is called at exactly one place, inside `solidForNode`. Two export
paths call `discSolid` directly and so skip it:
`web/src/services/files/componentExport.ts` and
`web/src/services/exports/rocketPrintExport.ts`.

The choke-point comment on `solidForNode` says "Every printable solid leaves
through here". Centering rings, bulkheads, couplers and engine blocks do not.

An explicit `outerRadius: 0` lathes four on-axis points, `dropDegenerate` removes
every triangle, and `makeWatertight` returns early on `boundaryEdges === 0` before
its own throw, so a zero-triangle STL downloads reporting success.

Fix: route both call sites through a wrapper that applies
`validateSolid(geo, meshTolerances(geo).area)` and returns null on issues.

### C7. A coupler wall at or past the radius prints a solid rod (HIGH, VERIFIED)

`web/src/services/design/discGeometry.ts` returns
`innerR: Math.max(0, outerR - wall)` for `tubecoupler` and `engineblock`. With
`thickness >= outerR` that is 0, and `discSolid` then takes its no-bore branch.

`solidMesh.ts` guards the tube case against exactly this with
`if (!(wall < R)) return null;` and a comment naming the hazard: "printed, the part
is a 24 mm rod and nothing fits inside it". The disc path never got the guard, and
`discDims` also feeds the DXF sheet and the 3D internals, so all three agree on the
wrong part.

Fix: return null when `wall >= outerR` for both types.

### C8. Per-simulation `maxTime` has no ceiling (HIGH, VERIFIED)

The `Override` for `maxTime` in `web/src/components/sim/SimEditor.tsx` passes
`min={1}` and no `max`. The global row for the same setting in
`SettingsDialog.tsx` passes `max={10000}`, and the comment beside it names the
hazard: "maxTime / timeStep IS the solver's iteration count, and both ends were
open. 1000000 s (a plausible slip for 1000) at the default 0.01 s step asks for 100
M integration steps, with no way to interrupt the run." The per-simulation
`timeStep` override likewise lacks the global `max={10}`.

`setSimPref` stores the raw value and `simConditions` forwards it unchecked;
`settings.ts` clamps only values at or below zero.

Fix: give both overrides the caps the global rows have, ideally from one shared
constant.

### C9. Deployment and separation altitudes accept negatives (HIGH, VERIFIED)

The `deployAltitude` input in `web/src/components/config/DeploymentSection.tsx` and
the `separationAltitude` input in `SeparationSection.tsx` pass no `min` to
`NumberInput`. The design-side equivalent floors at zero through `NumberField`'s
`min = 0` default. `onSi` rejects only null and a failed conversion, not a
negative, so the value is committed into the flight configuration.

A negative deploy altitude means the kernel's altitude trigger never fires: a
design whose recovery is correct on the Design tab flies ballistic under that one
configuration, with nothing marking the field.

Fix: add `min={0}`, converted where the field is unit-scoped.

### C10. The motor grid steals arrow keys while hidden (HIGH, VERIFIED)

`web/src/components/sim/MotorGrid.tsx` registers a `window` keydown listener for
ArrowUp and ArrowDown, excluding only INPUT, SELECT and TEXTAREA. The grid's
container in `MotorDashboard.tsx` is
`${effMode === 'detail' ? 'flex' : 'hidden'}`, so in Compare or Combine mode it is
hidden by CSS but still mounted and the listener stays live. `onSelect` is
`select`, which calls `setMode('detail')`.

So pressing ArrowDown while reading the Compare pane closes it and discards the
comparison.

Fix: pass an `active` prop and bail when the grid is not the visible surface, or
bind the listener to the grid's own element.

### Correctness, medium

- **Negative masses and dimensions from a `.ork`** (REPORTED).
  `importTags.ts` `readOverrides` and `numTag` accept any finite value, so a
  negative `<overridemass>`, `<overridecg>`, `<mass>`, `<length>` or `<diameter>`
  reaches the tree and the kernel. The `.rkt` reader floors every equivalent value
  and calls the unfloored cases "an inconsistency rather than a decision";
  `repairValues.ts` clamps `density` alone. Fix: floor at 0, or extend the
  `LIMITED` table so the load reports what it moved.
- **`Number(null)` grounds the sustainer** (REPORTED). `importConfigs.ts` reads
  `stageIds[Number(flag.getAttribute('number'))]`, and `Number(null)` is 0, so a
  `<stage active="false"/>` with a missing `number` grounds stage 0. The function's
  own doc claims such a flag is dropped rather than guessed at, which holds only
  for a non-numeric value. Fix: read through `finiteNum`.
- **RockSim colors are stored unvalidated** (REPORTED). `rktImport.ts` writes
  `<Color>` verbatim into the node key the app treats as a hex string. The `.ork`
  reader validates to `#rrggbb`. Consumers feed it to SVG `fill` and to a three.js
  material, and `orkExport` silently drops anything not matching
  `/^#?([0-9a-f]{6})$/i`. No test covers `Color` on the `.rkt` path.
- **Mixed-vintage `.ork` snapshot** (REPORTED). `store.ts` `saveOrk` captures
  `tree` and `loadedMeta` up front, then awaits a catalog fetch, then reads
  `activeConfigId` and `launch` fresh. It is the only async action in the store with
  no staleness guard. Saving while the catalog is still loading, then editing,
  writes pre-edit geometry with a post-edit launch block. Fix: capture the whole
  snapshot once and take `observeWorkspace()`.
- **`patchSelected` has no no-op guard** (REPORTED). Every neighboring
  tree-editing action has one. `updateNode` always returns a fresh `components`
  array, which is the rebuild dependency, so a value-identical patch triggers a full
  kernel build. `NumberInput` fires per keystroke with the already-clamped value, so
  typing past a ceiling fires N identical patches and leaves an undo step that
  changes nothing.
- **`stackedBands` has no finiteness handling** (REPORTED).
  `components/canvas/aeroTables.ts` accumulates into `cum`, so one NaN sample emits
  the literal `NaN` into the path data and poisons every band after it. The browser
  drops the path silently. Non-finite readings demonstrably occur: `sweep.nonFinite`
  is surfaced in the UI. The sibling `buildLinePath` in the same file handles this
  and documents why.
- **Custom ejection delay commits 0 on a cleared box** (REPORTED).
  `MotorDialog.tsx` uses a raw `<input type="number">` with
  `clampEntry(parseFloat(v), 0, PLUGGED_DELAY) ?? 0`, so clearing the field to
  retype stores a 0-second charge. This is the failure `NumberInput`'s draft buffer
  exists to prevent.
- **Kernel default drift in three places** (REPORTED, with Java citations).
  `solidMesh.ts` uses `outerRadius` 0.012 for both `innertube` and `launchlug`
  where the kernel builds 0.0095 and 0.0022, and `thickness` 0.0005 for `bodytube`
  where the kernel uses 0.0003. `discGeometry.ts` uses a bare 0.003 for
  `tubecoupler` length where the kernel builds 0.05. `reportGeometry.ts` uses 0.08
  for tube fin set length where the kernel uses 0.1. A launch lug at 5.5 times its
  flown radius does not fit the rocket that was simulated. Fix: read
  `KERNEL_DEFAULTS`, which exists so these have one home.
- **Unit drift between the two surfaces for one setting** (VERIFIED).
  `SimEditor.tsx` hardcodes `unit="°"` and an inline `* 180 / Math.PI` for
  `maxAngleStep`, while `SettingsDialog.tsx` resolves it through
  `u.at(unitScope(...), 'angle')` and says in a comment that it was changed to that
  "rather than an inline `* 180 / Math.PI`". `angle` has a `rad` option, so a user
  working in radians sees the two surfaces disagree.
- **Map scale ignores the unit preference** (REPORTED). `SiteMap.tsx` `scaleLabel`
  hardcodes m and km while every other readout in the same file goes through
  preferences and `distance` offers `ft`.
- **Cubic image trace on the main thread** (REPORTED).
  `services/design/finImage.ts` `simplify` is triply nested over whatever
  `traceOutline` returns, whose own bound is `8 * width * height`, and
  `FreeformFinActions.tsx` passes the full `createImageBitmap` result with no
  downscale. The documented workflow is tracing a fin off a photograph. Tests use
  single-digit ASCII fixtures only.
- **`finTabFront` is a second copy of a private helper** (VERIFIED).
  `components/canvas/schematicGeometry.ts` duplicates `finTabFrontEdge` from
  `tree/finPlanform.ts` and omits the clamps `finTabSpan` applies around it. Its
  only consumer is the tab renderer below. Two test files pin the duplicate, which
  makes the drift look covered.
- **The schematic tab is unclamped** (VERIFIED). `schematicShapes.tsx` `renderTab`
  computes the through-the-wall tab from raw `tabLength` with no clamp into
  `[0, rootChord]`, while `reportGeometry.ts` goes through `finTabSpan`, which
  clamps both ends. A tab longer than the root chord, a state the app explicitly
  warns about, draws past the fin edges while the DXF, the STL and the PDF all cut
  the clamped tab.
- **Imperial and metric unit tables do not match the desktop setters** (REPORTED,
  with Java citations). Six entries differ: metric `surfaceDensity` and
  `lineDensity`, imperial `surfaceDensity` (and its chosen unit is not in the Java
  group at all), `force`, `impulse` and `pressure`. All conversion factors were
  checked and are correct, so nothing is stored wrong, but the comment asserts
  fidelity that is not there.
- **`multiStageSummaries` can leave a stale kernel handle** (REPORTED).
  `reportModel.ts`'s `finally { restore(buildWhole()) }` does not protect against
  `buildWhole()` itself throwing, in which case `restore` never runs and the store
  holds a superseded handle. Nothing re-triggers the rebuild, because its
  dependencies did not change, so the aero pane stays dead until an unrelated edit.
- **Geolocation and file reads land on the wrong rows** (REPORTED).
  `LaunchPanel.tsx`'s geolocation callbacks, `WindProfileDialog.tsx`'s `importCsv`,
  `MotorDialog.tsx`'s `onImport` and `onDelete`, and `FlightPathExport.tsx`'s
  `onImport` all resolve after an await with no mounted or generation guard.
  `onChange` writes to whatever rows are the current edit targets, which may not be
  the ones that were on screen. `MotorDialog.pick` already implements the `pickGen`
  pattern in the same file.
- **Tile load forces a full re-render per tile** (REPORTED). `GroundTrack.tsx`'s
  `onLoad` sets a fresh object literal while `onError` directly beneath it uses the
  identity-preserving functional form. Combined with unmemoized point strings over
  a track with no decimation, switching the layer on a long flight stalls the tab.
- **Diameter caliper prints no unit** (REPORTED). `SchematicCalipers.tsx` omits
  `u.sym('length')` on the diameter readout while the length readout directly above
  includes it. The `aria-valuetext` does carry the symbol, so sighted users get less
  than screen-reader users.
- **Two zoom controls are inert at the default view** (REPORTED). `AftView.tsx`
  never disables the zoom-out and fit buttons; at the default view both are no-ops
  because of a clamp and a shared module constant. `SchematicControls.tsx` gates the
  equivalent pair. A control that looks clickable and does nothing is a bug in this
  project regardless of rationale.

### Correctness, low

`flightPathExport` bridges interior gaps with a straight line where the sibling
chart breaks the path. The freeform branch of `schematicShapes` draws nothing below
three points where the 3D view and the PDF both fall back to `FREEFORM_FALLBACK`.
`motorDb` does one IndexedDB transaction per motor, so a manufacturer-range import
is quadratic and reports nothing on partial failure. `settings.ts` `saveSettings`
swallows a quota failure with a bare `catch {}` while every other store in the
slice was deliberately converted to propagate one. `materialStore.isMaterial`
accepts a zero or negative density. `rktImport` materializes the whole `PointList`
before the point cap applies. `replaceWorkspace` resets eight transient fields but
not `info` or `rocket`, so for one frame a new blank design shows the previous
design's mass. `meshValidate`'s orientation check counts directed edges and so
passes a mesh wound consistently inside out, with no signed-volume check.
`finImage` uses `?? 0` on channel reads, where 0 is pure black and reads as fin.
`scaleNode` returns `{ ...n }`, aliasing `children` and any malformed point row,
and `componentActions` calls it directly. `windStdDev` and the turbulence percent
have no upper bound anywhere between the box and the solver. `SiteMap`'s wheel
handler zooms the map and also scrolls the enclosing form.

---

## Architecture and tooling

### T1. The working branch is gated by nothing (HIGH, VERIFIED)

`ci.yml` triggers on `pull_request` only. `deploy.yml` triggers on
`push: branches: [master]`. `dev.yml` triggers on `push: branches: [dev]`.

The checkout is on branch `test` with five commits. No workflow trigger matches it,
so not one of format, spell, typecheck, lint, knip, unit tests, e2e or coverage
runs on any commit being worked on.

Fix: `branches-ignore: [master]` or `branches: ['**']` in `dev.yml`.

### T2. The motor collision check cannot fail the publish (HIGH, REPORTED)

In `.github/workflows/sync-catalogs.yml` the motor row-key collision check lives in
the Summary step, prints a warning, never sets a non-zero exit, and runs after the
publish step. `web/scripts/sync-motors.mjs` `assertSane` has floors for empty
output, too few curves and a shrink past 90%, but no duplicate check.

The workflow's own comment says a collision "makes two distinct motors select as
one". It runs weekly with `contents: write` against the `data` branch the live app
reads, so a collision reaches every user's motor picker with a green workflow.

Fix: move the duplicate check into `assertSane` and throw.

### T3. The spell gate's `files` list is an allowlist with real holes (HIGH, VERIFIED by probe)

`cspell.json` `files` lists `web/src/i18n/locales/en.json` and no other locale, and
does not list `web/*.{ts,js}` at all.

Demonstrated by the review agent and since reverted: injecting a value with three
British spellings and one plain misspelling into `web/src/i18n/locales/es.json`,
plus a similar comment into `vite.config.ts`, `playwright.config.ts` and
`eslint.config.js`, then running `npm run spell`, reported
`Files checked: 671, Issues found: 0`. Every planted error passed.

So the nine non-English locale files carry user-visible UI text outside the gate,
and the root config files, which hold some of the longest prose comments in the
repo, are unchecked for both spelling and British spellings.

Fix: add `web/*.{ts,js}`, and add the locale files with per-locale `language`
settings or at minimum run the flagged-words list over them.

### T4. The storage namespace is misspelled, and the gate was taught to accept it (HIGH, VERIFIED)

`.cspell/project-words.txt` whitelists both the correct project name and a
double-letter misspelling of it, on consecutive lines.

The misspelling is the dominant spelling: 58 occurrences across 29 files under
`web/`, covering 17 distinct namespace keys including `designs:index`,
`designs:active`, `workspace`, `settings:v`, `motors:custom`, `materials:custom`,
`templates:custom` and `parts:custom`. The only key on the correct spelling is
`ENGINE_PREF_KEY`, which is also quoted as a user-facing debug instruction.

So the app has two storage namespaces and the one holding every saved design is
misspelled. No prefix sweep exists today, so this is not yet a data-loss bug, but
any future "clear app data" or quota sweep over one prefix silently misses the
other.

Fix: pick one spelling, migrate with a read-old write-new shim, and delete the
misspelling from `project-words.txt` so the gate cannot re-admit it.

### T5. Help has no automated coverage at all (HIGH, VERIFIED)

`web/e2e/help-dialog.spec.ts` skips on `existsSync('public/docs/index.html')`.
`web/public/docs/` is gitignored, confirmed with `git check-ignore`, and untracked,
and the `e2e` job's steps are checkout, setup-node, `npm ci`, playwright install
and `npm run e2e --shard`, with no `docs:build`. So every test in that spec is
skipped in every CI run and the shard exits 0.

Separately, `e2e:offline-help` exists in `package.json` and is run by no workflow,
while its sibling `e2e:offline-data` is run in `update-flow`. The script's own
header explains why it matters: the docs are built into the app rather than only
published.

So the in-app Help dialog and offline Help, the launch-site-with-no-signal case the
PWA exists for, have zero automated coverage, and both jobs are green.

Fix: run `npm run docs:build` in the e2e job, and add `npm run e2e:offline-help`
beside `e2e:offline-data`.

### T6. No type-aware lint rules (MED, VERIFIED by probe)

`web/eslint.config.js` extends `tseslint.configs.recommended`, not
`recommendedTypeChecked`, and sets no `parserOptions.project` or `projectService`
anywhere. So `no-floating-promises`, `no-misused-promises`, `await-thenable` and
the whole `no-unsafe-*` family never run.

Demonstrated with a temporary probe config, since deleted: **30 errors**, being 3
`no-floating-promises` (`ComponentExportButton.tsx`, `AppHeader.tsx`,
`i18n/index.ts`) and 26 `no-misused-promises` across twelve components.

None of the three floating ones is a live unhandled rejection today, because the
store actions they call catch internally. That is the point: the invariant making
them safe is convention only. A new store action that forgets it produces a click
that silently does nothing, with every gate green.

Fix: enable `recommendedTypeChecked` for `src/**`, or at minimum the two promise
rules with `checksVoidReturn: { attributes: false }`.

### T7. knip cannot see test-only src exports (MED, REPORTED)

`knip.json` puts `tests/**` and `e2e/**` in `project`, so a test import counts as a
use. The review agent verified 14 src exports whose only reference in src is their
own declaration, reached from tests alone. `knip --production` is not a usable
alternative: it reports none of them and emits 10 false-positive unused
dependencies.

Of the 14, one is explicitly named a test-only export and is intentional. The rest
are listed under dead code below.

Fix: split tests into a knip workspace, or add a second invocation whose `project`
is `src/**` only.

### T8. eslint walks 70 generated files to apply no rules (MED, REPORTED)

`eslint.config.js` `ignores` omits `public` and `src/engine/vendor`, which both
`.prettierignore` and knip exclude. `eslint .` processes 705 files, 70 of them
generated, including the 2.9 MB vendored engine bundle. `--print-config` resolves 0
enabled rules for those, because the first block's `files` list is root-anchored.

The real risk is the next change: a config block added without a `files` key, the
normal way to add a project-wide rule, would immediately fire on all 70 under
`--max-warnings 0`.

Fix: add `'public'` and `'src/engine/vendor'` to `ignores`.

### T9. The kernel-driving tests have under 10% timeout headroom (MED, VERIFIED)

`web/tests/engine/rodClearanceModel.test.ts` sets
`vi.setConfig({ testTimeout: 60_000 })` and takes **54.6s** for its 11 tests when
run alone.

Under the full suite it failed once here: one test reported 93.6s against the 60s
timeout and the file took 465s. On a quiet machine the full suite passes, 235 files
and 3252 tests in 314s. That failing run also had six audit agents competing for
the machine, which is heavier than a CI runner, so the failure itself is not
evidence of a CI problem. The headroom is: 54.6s of work against a 60s cap.

`vitest.config.ts` already documents this exact class of problem for
`engineBoundary.test.ts` and fixed it by capping `maxWorkers` to 4.
`rodClearanceModel.test.ts` is a newer kernel-driving test that the cap does not
save.

The consequence is specific and was reproduced: vitest writes no
`coverage-summary.json` on failure, so `gates.yml`'s coverage step falls into its
"the suite did not finish" branch and the run reports no coverage at all.

Fix: raise the timeout on the kernel-driving files, or move them to a separate
non-parallel project.

### T10. The coverage floor has 19 points of slack and is not in `verify` (MED, VERIFIED)

`vitest.config.ts` sets `thresholds: { lines: 55 }` against a measured 74.13%. Only
lines is floored; branches at 65.83% and functions at 65.15% are reported and not
gated.

`npm run verify` ends in a bare `vitest run`, and `dev.yml` runs plain `verify`, so
the floor is reached only through `gates.yml`'s `npm run verify -- --coverage`.

The config comment states the intent plainly: the floor "exists to catch a change
that deletes a test file or a whole tested module, which drops lines by whole
points, not to make every PR raise the number." That is a reasonable policy, so the
finding is narrower than "the floor is too low": a change deleting roughly a fifth
of the suite is green, and the documented local pre-push list does not check
coverage at all.

Fix: put `test:coverage` in `verify` instead of bare `vitest run`.

### Architecture, medium

These are design findings, not defects. Each names a concrete split.

- **`store.ts` `runSims`** is 170 lines doing six unrelated jobs: the design
  blocker gate, the runnability split, batch dispatch, two error-aggregation
  buffers, i18n rendering and workbench navigation. The pure part, which rows fly
  and which are refused and why, is a pure function trapped in an action; three test
  files drive the whole store and a stubbed worker to assert arithmetic. Lift
  `{ flying, skipped }` into `services/flight/runPlan.ts`.
- **`store.ts` `openOrkFile`** has the same shape for the import path: the
  library-naming policy with two modal dialogs, the safety-limit note text and the
  banner assembly are all inline. Lift `importBanner()` into `services/files/` and
  `homeForImport` into `designLibrary` with the dialogs injected.
- **`Simulation.outdated` is maintained by hand in seven places** plus a React
  effect with two refs. It is derivable: `simInputs` and `sameSimInputs` already
  compute the pair, and `runSims` captures `flownFrom` and then discards it. Store
  it on the result and expose `outdated` as a selector; that deletes the
  invalidation effect, `hydrationGen`, `markOutdated` and `markPrefsOutdated`. Two
  shipped misses are already recorded in comments.
- **The engine rebuild is not debounced** while the autosave beside it is debounced
  500 ms and the sim work was moved off-thread for this reason. `NumberInput` emits
  per keystroke, so dragging a dimension slider runs one full main-thread kernel
  build per input event. `useAeroSweep` already solves this for the cheaper call.
  Give the rebuild the same deferral.
- **Auto-run is an effect, not a command.** `CenterView.tsx` fires a simulation, a
  user action with worker side effects, from an effect whose guard is `!runFailed`,
  where the selector exists only to break the loop and `SimRun` carries a whole
  `RocketTree` reference for no other reason. The store comment records the shipped
  failure, a reproducible timeout retried without limit. A second hole remains: the
  design-blocker early return writes `err` but no `simRuns` entry, so the guard does
  not cover it.
- **God components.** `CenterView.tsx` (480-line body, eight concerns),
  `HelpDialog.tsx` (536-line body, six concerns, seven `useState` and five
  `useEffect`), `FlightPathExport.tsx`'s dialog (575 lines with two hydrate and
  persist field lists that must stay in lockstep). Each entry in the agent reports
  names the hooks to extract.
- **Duplicated helpers.** Two exported `Stat` components, in
  `components/common/Stat.tsx` and `components/sim/MotorDetail.tsx`, with different
  markup and type scale, each imported by two files in the same area, so
  `import { Stat }` means different things. Two exported `withUnit`, in
  `i18n/format.ts` and `components/sim/motorFormat.ts`, where only the i18n one
  closes degrees up, and sibling files disagree about which they get. One `numOf` in
  `rktExport.ts` byte-identical to `nodeProps.numOpt`. Launch site bounds spelled
  out in three places while a comment claims they are named once.
- **`TreeSchematic`'s `vertical` mode is unreachable.** The only call site never
  passes it; the phone quarter-turn is done in CSS. About 12 live branches plus a
  `textUp` callback spread at eight call sites that now always returns `{}`. This
  also masks what would be a real accessibility bug if revived: `role="img"` on an
  SVG whose shapes still carry `onClick`.

### Tooling, low

`knip.json` `entry` names neither `index.html` nor `src/main.tsx`, so the app graph
resolves only by plugin auto-detection, which is why `--production` collapses.
`scripts/**/*.mjs` is all entry, so an orphan script is invisible, with no live
violation since all 14 scripts are referenced. The root config files are outside
`project`, so a dead helper there is invisible. `cspell.json`'s `*.md` is
root-anchored, so `website/README.md`, `website/docusaurus.config.ts` and
`website/sidebars.ts` are unchecked. Nothing asserts the src-to-`en.json` direction
of the i18n triangle, so a mistyped translation key renders the raw key with no gate
failing, verified clean today across 328 files against 1449 keys. The `validate`,
`build-and-test` and `e2e` jobs have no `timeout-minutes`, so the 360-minute
default applies per shard. `vite build` and the coverage floor are unreachable
through the documented local pre-push list. `sync-motors.mjs` measures its shrink
floor against the committed copy, which the workflow says it deliberately does not
touch, so the baseline drifts behind the live branch. `.prettierignore`'s comment
calls `public/docs` "committed for the static host" when it is gitignored.

---

## Tests and accessibility

### Tests

- **The fin recurrence guard is vacuous.** See C2. This is the most important test
  finding in the audit.
- **`shapeProfile.test.ts` has no kernel anchoring** (REPORTED, with Java
  citations). It never reads `engine-java`, and every clipped-profile assertion
  computes its expected value by calling `shapeRadius`, the function under test.
  Independent closed-form interior assertions exist only for `conical` and `power`.
  `ellipsoid`, `ogive`, `parabolic` and `haack` are pinned only by reaching full
  radius at the endpoint and by monotonicity, which is exactly the property set the
  wrong fin curve shared with the right one. At the midpoint the kernel gives
  `r * sqrt(3)/2 = 0.866r` and a sine arch gives `0.707r`, and nothing in the file
  distinguishes them. Add a `shapeProfile.kernel.test.ts` in the shape of the fin
  one.
- **Three modules cannot be verified at all** (REPORTED). `markingGuide.ts`,
  `finTabAuto.ts` and `finImage.ts` are ports of OpenRocket `swing` classes, and the
  Java is not committed: `engine-java/src/java` carries only `core`. `finTabAuto`
  decides the depth of a slot cut through the airframe. Vendor the three files at
  the pinned ref and add drift guards.
- **`discGeometry.ts` has no test file at all**, and it is the module the DXF
  sheet, the print solids and the 3D internals all share for ring and coupler
  sizing. `tubeRadii`, `plateOuter`, `mountBore`, `nodeContext`, `discDims` and
  `boreAt` are untested; so are `scaleNode` and `stationRadius`.
- **A golden test asserts a flag that has no reader.** `reportPdf.golden.test.ts`
  passes `include: false` as if it suppressed a stage. See the dead-code entry.
- **`stackedBands`' only test never feeds it a non-finite sample**, while its
  sibling `chartDomain` is tested for NaN in the same file.

### Accessibility

- `useFocusTrap.ts`'s `FOCUSABLE` list omits `iframe`, and `HelpDialog`'s entire
  content is an iframe and the last element in the panel. So a keyboard-only or
  screen-reader user can reach every control of the Help dialog and never the help
  text it exists to show.
- `SettingsDialog.tsx` and `DesignLibraryDialog.tsx` declare `role="tablist"` and
  `role="tab"` with `aria-selected`, but there is no `role="tabpanel"` and no
  `aria-controls` anywhere in the slice, and no arrow-key handling, so the eight
  Settings tabs are eight separate tab stops. A half-applied pattern is worse than
  plain buttons, which do not promise a panel.
- `ImageExportMenu.tsx` puts `role="menu"` on a container whose children include a
  bare `<span>` and a label-wrapped checkbox, so the six width buttons announce as
  "HD, 4K, 8K, HD, 4K, 8K" with nothing saying which three are PNG. The comment
  directly above flags this exact hazard class and then reintroduces it.
- `SiteMap.tsx`'s map host is a `role="group"` div driven entirely by pointer and
  wheel events, with no `tabIndex` and no `onKeyDown`. Picking a launch site from
  the map, the component's stated reason for existing, has no keyboard path.
- Glyph-only buttons with `title` but no `aria-label`: `PropertyPanel.tsx`'s move
  up and move down, two color resets in `AppearanceSection.tsx` and
  `SettingsDialog.tsx`, and `FlightPath3D.tsx`'s reset and loop. 19 of 23 glyph-only
  buttons in the slice do carry one, so this is drift.
- Two places wrap a color input and a reset button in one `<label>`, which
  `DimensionFields.tsx` fixed and documented: "A row, not one big `<label>`. The
  switch below is a SECOND control, and a label may only bind to one."
- `MotorGrid.tsx` and `MotorComparePane.tsx` are the only tables in the slice
  without `scope="col"`, and the former is the one that runs to a thousand rows.
- `CatalogLoading.tsx`'s `CatalogError` has no `role="alert"`, and it renders into
  an already-present cell, so a failed catalog download is silent.
- `WindProfileDialog.tsx` has an svg with both `role="img"` and
  `aria-hidden="true"`, which contradict.

**Verified clean, do not re-report.** Every one of the 23 dialog files routes
through `common/Dialog.tsx` or `common/AlertDialog.tsx`, both of which call
`useFocusTrap` on the panel and restore focus to the opener; Escape goes to the
topmost surface only via a document-order stack. `ComponentTree` is a correct
`role="tree"` with roving tabindex and full arrow-key handling. The caliper handles
and both chart crosshairs are keyboard-operable with live readouts. The aero heat
cells always carry the number as a non-color cue and legend their ramp. Every
toggle sets `aria-pressed`. three.js disposal is handled at every site the agents
could find, with the render-target path disposing in a `finally` even on throw.

---

## Dead code

knip exits 0, so everything here is something knip structurally cannot see, per
T7. Each was confirmed by grepping all of `web/src`, with test-only usage noted.

Reached only from tests, no production consumer:

| Export                            | Note                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `meshValidate.describeIssues`     | doc comment says "for an export error message"; no such message exists                         |
| `updateCheck.promptDue`           | `UpdateToast` reimplements the snooze inline; 7 tests assert a gate the app does not run        |
| `stabilityGadget.calloutGadget`   | 45 lines plus a 45-line test; `Rocket3D` composes two callouts instead. Hardcodes `'cal'` too   |
| `meshValidate.isValidSolid`       |                                                                                                |
| `api.specToTree`                  |                                                                                                |
| `simClient.simConcurrency`        |                                                                                                |
| `helpSearch.resetHelpIndex`       |                                                                                                |
| `treeEdit.findMountId`            |                                                                                                |
| `materials.findMaterial`          |                                                                                                |
| `componentDb.filterComponents`    |                                                                                                |
| `componentFilter.odBounds`        |                                                                                                |
| `rocketReport.thrustToWeight`     |                                                                                                |
| `idbKeyValueStore.isStorageDegraded` | redundant with the `onStorageDegraded` subscription in the same file                        |

`openRocketEngine.__setEngineForTests` is a **test-only export (intentional)** and
is named as such. A further 96 src exports are referenced from their own file plus
tests, which is the same intentional pattern and is not dead.

Other dead weight:

- `ExportDialog.tsx` and `services/report/options.ts`: `StageOption.include` is
  threaded from the dialog into `ReportOptions` and has no reader. `reportPdf.ts`
  reads only `parts` and `finTemplates`. It has no control either, and `allOn`
  ignores it, so it cannot round-trip. The golden test passes `include: false` as if
  it suppressed a stage.
- `orkImport.importOrk`'s `opts.configId` parameter and the `requested` branch it
  feeds are unreachable: the only production caller passes no second argument. The
  re-import it implies would also mint fresh node ids while
  `loadedMeta.exportMotors` still keys the old ones.
- `TreeSchematic`'s `vertical` mode, covered under architecture above.

**Verified clean.** No default-export drift, only `App.tsx` and `i18n/index.ts`,
both sanctioned. No re-export barrels. File naming is consistent. All six authored
CSS classes are referenced. No dead or missing i18n keys across 1449 keys and 10
locales. Every declared dependency resolves to a real import or a package binary.
`import './kernelLogSink.js'` is a side-effect import and knip correctly does not
flag it.

---

## Recommended order of attack

Front-loaded with small verified fixes; large refactors last.

**1. Make the guard real before touching anything it guards.** Fix C2's scan root
and pattern, watch it fail on C1, then fix C1 and the unclamped schematic tab.
Doing this first means the fin fixes land behind a gate that actually holds. One
test file, two edits.

**2. One-line fixes that close a wrong-number path.** C3 is **done** (both sites,
plus a test that now tells the two formulas apart). Remaining: C8 (two `max`
props), C9 (two `min` props), C7 (one null return), S1 (reuse `cell()`). All four
are single-expression changes with a verified failure scenario. Note what C3 turned
up: the same wrong expression existed in a second exporter the audit had not
flagged, so when fixing one of these, grep for the expression rather than trusting
the file list.

**3. Turn the gates on.** T1 (branch trigger), T3 (two `files` entries), T5
(`docs:build` in the e2e job plus one script line), T8 (two `ignores` entries), T2
(move the duplicate check into `assertSane`). T1 first: until it lands, nothing else
in this list is checked on the branch it is written on.

**4. T6, type-aware lint.** Enable it, then fix the 30 errors it names. Do this
after step 3 so the result is actually enforced. Expect the 26
`no-misused-promises` to be mostly JSX handlers that
`checksVoidReturn: { attributes: false }` quiets.

**5. T4, the namespace misspelling.** Pick a spelling, write the read-old write-new
shim, delete the whitelist line. This is mechanical but touches 29 files and
changes persisted-data keys, so it wants its own change and its own test.

**6. C4, C5, C6.** Three correctness fixes with real test work attached: C5 needs
two tests extended, C4 needs the rebuild-trigger test's missing case, C6 needs a
validation wrapper and a degenerate-input test.

**7. Kernel default drift and the untested geometry module.** Replace the four
invented literals with `KERNEL_DEFAULTS` reads, then add
`tests/services/design/discGeometry.test.ts`, which is the least covered module
carrying the most shared consequence.

**8. Add the missing kernel anchors.** `shapeProfile.kernel.test.ts` with
interior-point assertions transcribed from the Java, not from `shapeRadius`. Then
vendor the three `swing` sources so `markingGuide`, `finTabAuto` and `finImage`
stop being unverifiable.

**9. Dead code.** Delete the 12 unreachable exports, `StageOption.include`,
`importOrk`'s unused parameter and `TreeSchematic`'s `vertical` mode. Mechanical
once T7's second knip invocation exists to keep it from growing back.

**10. Deferred refactors.** The `outdated` derivation, `runSims` and `openOrkFile`
extraction, the rebuild debounce, auto-run as a command, and the three god
components. Each is a real improvement and none is urgent; the `outdated`
derivation has the best ratio, since it deletes more machinery than it adds and has
two shipped misses on its record.

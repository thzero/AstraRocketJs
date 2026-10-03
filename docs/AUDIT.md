# AUDIT - `web/` engineering audit

<!-- cspell:ignore astrarrocketjs -->

Date: 2026-10-01. Branch `test` at b610c12. Run per `docs/AUDIT_PROMPT.md`, six
parallel review agents over five slices, every HIGH finding re-verified against
the source before entry here.

Scope: the `web/` package. `web/src/engine/vendor/` is generated TeaVM output
and was not audited. `engine-java/` has its own prompt and its own report.

**Status, 2026-10-03.** Every SECURITY finding (S1 to S5) and every CORRECTNESS
finding at every severity (10 HIGH, 19 MED, 12 LOW) is fixed, each with a test
proven to discriminate: the fix was reverted, the test watched to fail, and the
fix restored. That includes the `.rkt` component cap S2 left open. Every TOOLING
finding is fixed too: T1 to T5 at HIGH, T6 to T10 at MED, and eight of the nine
tooling-LOW items, with only the i18n triangle left open by decision. The dead
code, the duplicated helpers and the test list are done. What remains is the
architecture refactors, the accessibility list, and all 32 findings in
`docs/AUDIT_ENGINE.md`, which has not been touched.

Two MED findings in this report were closed without being worked on: C1 removed
the duplicate `finTabFront` and the unclamped schematic tab as collateral. They
are marked FIXED BY C1 rather than quietly deleted, because they are the cheapest
evidence that the finding groups below are real shapes rather than a filing
convenience.

## How to read the verification tags

- **VERIFIED** means the cited lines were read and the claim confirmed
  independently of the agent that raised it.
- **REPORTED** means a review agent raised it with a file:line and a failure
  scenario, and it is plausible on inspection, but it was not independently
  re-read. Treat these as leads, not as facts.
- Three agent-supplied line citations were wrong by 100 lines or more. Every
  citation below was re-resolved by content. If a line number does not match
  what you see, search for the quoted expression.

## Gate picture, measured

Established directly, not relayed:

| Gate                                        | Covers                                                                                                      | Trigger                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `format:check`                              | all of `web/` minus `.prettierignore`, including all 10 locale files                                        | PR, master, every branch          |
| `spell`                                     | `web/src`, `web/tests`, `web/e2e`, `web/scripts`, workflows, root `*.md`, `docs/**`, and `en.json` only      | PR, master, every branch          |
| `typecheck`                                 | 3 tsconfigs (src plus tests, e2e, node configs)                                                             | PR, master, every branch          |
| `lint`                                      | 668 files, 0 errors, 0 warnings, two type-aware promise rules on                                             | PR, master, every branch          |
| `knip`                                      | exits 0 clean                                                                                               | PR, master, every branch          |
| `vitest run`                                | 263 files, 3490 tests, all passing                                                                          | PR, master, every branch          |
| coverage floor                              | lines 70, branches 62, functions 61, statements 69 (`verify:ci`)                                             | PR, master, every branch          |
| `vite build`                                | in `verify`, before the suite (~20 s)                                                                        | PR, master, every branch          |
| e2e, 3 shards                               | 29 specs, Chromium, docs built so Help is covered                                           | PR and master only               |
| engine `parity`, `reproducible`, `validate`  | all three present and running                                                                               | PR and master only               |

Measured coverage, 2026-10-02 after the correctness work: lines **74.86%**
(10751/14360), statements 73.56%, branches 66.51%, functions 66.07%. The floor is
55 and applies to lines only. It was 74.13% / 72.92% / 65.83% / 65.15% on
2026-10-01, so the 146 tests added across 16 files moved lines up 0.73 points -
which is what you would expect from tests aimed at specific defects rather than at
uncovered modules.

Confirmed closed, do not re-report: `knip` is clean. `prettier --check` passes
on every matched file including `web/src/i18n/locales/es.json`, so the prompt's
claim of pre-existing drift is stale. `validate` does run in CI, in `gates.yml`,
so the engine prompt's claim that nothing runs it is stale. All five
`eslint-disable` comments target an enabled rule and none is inert.

---

## Security

### S1. CSV formula injection in the flight-events export (MED, VERIFIED) - FIXED 2026-10-02

`web/src/services/exports/csvExport.ts`, the `text()` helper used by
`flightEventsCsv`, quotes and strips newlines but does not neutralize a leading
`=`, `+`, `-`, `@`, TAB or CR. The Event, Source and Stage columns carry
component and stage names taken from the imported design, so they are
attacker-controlled through a shared `.ork`.

The project's own rule lives one file away: `reportCsv.ts` prefixes an
apostrophe when `/^[=+\-@\t\r]/` matches, and its comment says "Same rule as
flightPathExport.ts". Spreadsheets strip CSV quoting before evaluating, so
quoting alone does not stop it.

**Fixed.** `text()` now prefixes an apostrophe on a leading `= + - @` or TAB
inside the quoting. Deliberately stricter on `-` than `flightPathExport`'s
escaper, which relaxes it so negative longitudes stay numeric: every value here
is a name, and `-1+HYPERLINK(...)` does evaluate. The other two writers in the
file were checked and are safe as they stand: `aeroTableCsv` is safe by
construction (its `Cd_` prefix means a cell never leads with a trigger) and
`flightDataCsv` puts names only on comment-character lines.

Also found: the two existing copies of this rule have already drifted.
`reportCsv.cell` treats any leading `-` as a trigger, `flightPathExport` uses
`^-(?![\d.])`, and `reportCsv`'s comment claims they are the same rule. Left as
is, because the difference is correct (one handles names, the other also
pre-formatted numerics), but the comment is wrong and one shared pair of helpers
would be better than three copies.

### S2. The `.ork` caps bound bytes but not element count (MED, VERIFIED) - FIXED 2026-10-02

`web/src/services/files/ork/importLimits.ts` caps archive entries, per-entry and
total inflate bytes, nesting depth, configuration count, fin count, instance
count, point count and line count. It does not cap total component count, and
`importReaders.ts` `convertChildren` walks every `<subcomponents>` child with no
ceiling. Each component is then re-scanned once per declared configuration by
`importConfigs.ts`, which caps the configuration side only and whose comment
reasons explicitly about this product.

A `<bodytube/>` is about 13 bytes, so the 64 MiB per-entry ceiling admits
millions of components from a small zip. The result is a hung tab, not the clear
error `importLimits` promises.

**Fixed.** `MAX_COMPONENTS = 10_000` in `importLimits.ts`, with a running
`nodeCount` on `OrkImportContext` incremented in the one place every child
enters the tree (`convertChildren`) and again in `readStages`, throwing the same
style of clear error as the depth cap. A running total rather than per-level,
because the readers recurse.

Not done: the same gap in `rktImport.readParts`. The `.rkt` reader has its own
context type and its own depth cap, so it wants the same treatment separately.

### S3. Embedded motor files are parsed without caps (MED, VERIFIED) - FIXED 2026-10-02

`web/src/services/motors/rseParser.ts` `parseRse` maps every `<engine>` in the
document and every `data > eng-data` row with no limit. It is reached with no
file picker: `loadOrk.ts` parses each `.rse` member the untrusted `.ork`
carried. The `.ork` reader caps fin points and line counts for this exact
reason; the embedded-motor path caps nothing.

**Fixed.** `MAX_RSE_ENGINES = 2000` and `MAX_RSE_SAMPLES = 20_000` in
`rseParser.ts`. The engine count is checked on the `NodeList` BEFORE the spread,
so a crafted member is refused without first materializing a million-element
array. Both throw rather than truncating with a note: unlike a fin outline, a
motor curve silently shortened is a different motor.

### S4. Unescaped template output for unknown extensions (LOW, VERIFIED) - FIXED 2026-10-02

`flightPathExport.ts` `escaperFor` returns identity by default, so a user
Mustache template whose name does not resolve to kml, gpx, xml or csv renders
every value unescaped. `templateStore.parseTemplateFilename` defaults a bare
name to `txt`.

**Fixed.** A `json` case escaping through `JSON.stringify(raw).slice(1, -1)`, so
it agrees with every parser and leaves the surrounding quotes to the template as
the csv and xml cases do. The default branch now replaces C0 controls and DEL
with a space: it cannot invent an unknown format's quoting rules, but it can
refuse the characters that forge a record boundary in any text format. Printable
punctuation is left alone, since in an unknown format it is as likely to be
content.

### S5. The response cap bounds the buffer, not the transfer (LOW, VERIFIED) - FIXED 2026-10-02

`web/src/services/app/fetchProgress.ts` throws "response too large" without
calling `reader.cancel()`, and neither caller aborts the controller afterward.
The abandoned transfer stays in flight while the fallback base is tried.

**Fixed.** `await reader.cancel().catch(() => {})` before the throw. The catch
matters: `cancel` can itself reject on a stream the network already errored, and
that must not replace the reason we are here.

All five are now fixed, each with tests: 18 new cases across
`orkImportHostile.test.ts`, `csvExport.test.ts`, `rseParser.test.ts`, a new
`fetchProgress.test.ts` and a new `flightPathExport.escapers.test.ts`. Every cap
has a paired test that it still admits what a real design uses, so none of them
can be tightened into a false refusal unnoticed.

**Verified clean, do not re-report.** Zip-bomb caps are genuinely applied on the
path the app uses: `importUnpack.ts` counts entries and sums `originalSize`
inside fflate's pre-inflate `filter`, with hostile tests firing each cap.
Unbounded `<subcomponents>` recursion throws past depth 100 in both readers. XML
escaping is applied to every file-sourced string on all three export formats.
DXF group-code injection is blocked by an ASCII filter. Remote fetches have
staged abort timers, content-length checks, streamed caps and shape validation
on both the network and cache paths. No `obj[untrustedKey] = ...` write exists
anywhere in the parser slice. No `dangerouslySetInnerHTML` in any component. All
external links carry `rel="noreferrer"` or `rel="noopener noreferrer"`. XXE is
not applicable under browser `DOMParser`.

---

## Correctness

### C1. The fin planform is duplicated in the 2D schematic (HIGH, VERIFIED) - FIXED 2026-10-02

`web/src/components/canvas/schematicShapes.tsx` builds the trapezoid polygon and
the elliptical arc itself. It imports only `FIN_DEFAULTS`, `finRootChord` and
`finSpan` from `tree/finPlanform.ts`, not `finPlanformPoints`.

Two kernel rules that `trapezoidFinPoints` applies are missing from the copy:

- the tip collapse, where `tip > 0.0001` emits a three-point triangle rather
  than a trapezoid with a zero-length tip edge;
- the root floor, `Math.max(root, MIN_ROOT)`.

So a `.ork` carrying `rootChord <= 0` draws a degenerate polygon in the side
view while the 3D view, the STL, the DXF and the PDF all draw the floored shape.

The docblock on `tree/finPlanform.ts` names the 2D schematic as a consumer and
states that no consumer may sample a fin outline itself. The comment above the
arc reads "a true half-ellipse", which is the same phrase the module history
records as how the previous wrong curve propagated.

**Fixed.** The three planar fin branches collapsed into ONE that takes its
outline from `finPlanformPoints(child) ?? FREEFORM_FALLBACK` and projects the
returned pairs, which is what the freeform branch already did. 74 lines of local
geometry deleted, and the trapezoid now gets the tip collapse and the `MIN_ROOT`
floor it was missing. The elliptical fin is drawn as the kernel's own 31-point
outline rather than an SVG arc: indistinguishable at schematic scale, and it is
the shape the 3D view, the STL, the DXF and the PDF all cut, which an idealized
arc could not promise.

The tab half is fixed with it: `renderTab` goes through `finTabSpan`, so the
drawn tab is the clamped one. That made `schematicGeometry.finTabFront` -- the
duplicate private helper this report flags under MED -- dead, so it and the two
test blocks that pinned the duplicate are gone. `FIN_DEFAULTS` is also no longer
re-exported from `finPlanform`: a consumer can take fin DIMENSIONS from
`kernelDefaults`, but what it gets from the planform module is a planform. knip
caught that re-export going unused, which is the mechanism working.

### C2. The recurrence guard scans the wrong tree (HIGH, VERIFIED) - FIXED 2026-10-02

`web/tests/tree/finPlanform.kernel.test.ts`, in the `no module grows its own fin
sampler` block, resolves its scan root with `fileURLToPath(new URL('..',
import.meta.url))`. From `web/tests/tree/finPlanform.kernel.test.ts` that is
**`web/tests/`**, not `web/src/`. It then excludes `*.test.ts` and `*.test.tsx`.

Proven by executing the guard's own directory walk against that root: it reads
exactly six files, all of them helpers under `web/tests/testing/`, and not one
source file. None of its three `ALLOWED` paths exists under that root.

This guard is the stated defense against the elliptical-fin bug recurring, the
bug that survived three audits. It has never examined a source file, and C1 is a
live violation it should have caught.

A second hole remains even after the root is fixed: the pattern
`/Math\.(sin|cos|acos|asin)\(Math\.PI/` requires `Math.PI` as the literal first
token, so a sampler written the way `finPlanform.ts` itself writes it, binding
the angle to a local first, does not match.

**Fixed, and the premise was wrong.** The root is now `../../src/`, and a new
test asserts the walk reaches `tree/finPlanform.ts` and
`components/canvas/schematicShapes.tsx`, finds over 200 files, and that every
allowlist entry names a file that exists. A guard with no precondition check is
how this one passed vacuously for its whole life.

But broadening the trig pattern would NOT have caught C1, and that is the more
useful finding. `schematicShapes` drew its ellipse with an SVG `A` arc and its
trapezoid with a polygon literal: no trigonometry anywhere. A textual trig rule
would have passed it forever even pointed at the right tree, and when broadened
it instead flagged five files whose trig is legitimate angular placement. The
invariant is WHERE THE OUTLINE COMES FROM, not how it is spelled.

So the guard is now two tests. A provenance test over a named list of
fin-drawing modules, each of which must reference `finPlanformPoints`,
`finCutContour` or `finPlanformMm` -- importing `FIN_DEFAULTS` or `finRootChord`
does not count, because a consumer can hold every dimension and still draw its
own curve, which is exactly what happened. And the original narrow trig pattern,
kept because it is free and has no false positives. The provenance test failed
on exactly `schematicShapes.tsx` and nothing else before C1 was fixed.

### C3. The stability percentage is recomputed app-side (HIGH, VERIFIED) - FIXED 2026-10-02

**Fixed.** All three sites now read `info.stabilityPercent`. Details at the end
of this entry.

`web/src/services/report/designInfo.ts` pushed `((info.cp - info.cg) /
info.length) * 100`.

`StaticInfo` carries `stabilityPercent` on the same object, and its docblock in
`web/src/engine/openRocketEngine.ts` says, verbatim: "Read from here rather than
computed per view as `((cp - cg) / length) * 100`, which is the right shape over
the wrong denominator: `length` bounds every component, so any design with a
non-aerodynamic part outside the aerodynamic envelope reads a percentage the
desktop does not show." The sibling field's docblock adds "Do not re-derive
either one here."

The correct divisor, `lengthAerodynamic`, is also on the object and documented
as "Not the same as length". This value is written into saved `.ork` files, so
it outlives the session.

**Two more sites the audit missed.** The audit named one file; there were three.
`web/src/services/report/reportCsv.ts` and `web/src/services/report/pdfPage.ts`
both carried the identical expression, `info.length > 0 ? ((info.cp - info.cg) /
info.length) * 100 : 0`, feeding the `Stability (%)` row of the exported summary
CSV and of the printed PDF report. Both were found by grepping for the
expression after fixing the first, not by the slice file lists. So the three
writers would have disagreed with the four view components as well as with the
desktop: `InfoOverlay`, `SchematicOverlay`, `StabilityBadge` and
`StabilityCallout` all already read `info.stabilityPercent` with the comment
"The engine's own figure, not ours". The report writers were the only holdouts,
and the PDF is the copy that goes to a launch.

**What was done.** All three sites now read `info.stabilityPercent`, each with a
comment naming the aerodynamic-length denominator. The old `length > 0 ? ... :
0` fallbacks emitted a literal `0` for a design with no usable length; the value
now passes through each module's own formatter, which degrades honestly, `round`
to an empty cell in the CSV and `fmtNum` to a dash in the PDF, matching how
`designInfo`'s `push` omits the row.

**The test was vacuous and is not any more.** `designInfo.test.ts` asserted only
`expect(f['Stability (%)']).toBeDefined()`, which passes under either formula,
and its fixture cast past `stabilityPercent` with `as StaticInfo` so the field
was `undefined`. The fixture now carries `lengthAerodynamic: 0.4` against
`length: 0.425` and `stabilityPercent: 31.5`, chosen so the wrong denominator
yields 29.65 and the right one 31.5, and the assertion pins the value. Verified
discriminating: restoring the old expression fails the test (`expected ... to
match object { value: '31.5' }`), restoring the fix passes it. This is the
pattern C2 asks for applied to a second port, and it is why the original formula
survived three audits here.

All three fixtures were vacuous the same way, and all three are fixed:
`reportPdf.golden.test.ts` and `reportCsv.test.ts` also cast past
`stabilityPercent`, so the first run after the fix produced a blank percentage
in the PDF golden rather than a number. Each fixture now carries a
`lengthAerodynamic` shorter than its `length`, and the CSV test gained the
assertion it never had. The PDF golden moved on exactly four lines, `12.5 %` to
`13.6 %`, which is the wrong denominator giving way to the right one; nothing
else in the snapshot changed.

Gates rerun locally, all green: `format:check`, `spell` (673 files), `typecheck`
(3 projects), `lint` (`--max-warnings 0`), `knip`, and the full unit suite at
235 files / 3252 tests.

### C4. Grounding a stage does not rebuild the engine (HIGH, VERIFIED) - FIXED 2026-10-02

The rebuild effect in `web/src/state/useWorkspaceEffects.ts` depends on `[ready,
enginePhase, components, seated]`. `seated` is `seatedMotorsKey`, which is
`mountId:specSerial` per live mount; `liveMotors` iterates `findMounts(tree)`
and checks `config.motors[id]`, with no reference to `grounded`. `setStageFlies`
replaces `configs` only, so neither key moves.

`buildConfiguredRocket` does honor it: it calls `setStageActiveById(id, false)`
for every grounded stage.

So after grounding a booster the worker flies the sustainer-only rocket while
`info` still describes the full stack. The stats strip, the stability badge, the
Run button and the RASAero launch mass all describe a different rocket from the
one that flew.

**Fixed with the second option**, because the first would have left the next
input to be missed the same way. `buildKey(tree, config)` in `buildRocket.ts`
now covers every configuration input `buildConfiguredRocket` reads: the seated
motors with their ignition, plus the grounded stages as a sorted set. The effect
keys on it instead of on `seatedMotorsKey`.

The deployment and separation overrides are deliberately NOT in the key, and the
docblock says why: `configuredTree` bakes them in, but they move when recovery
fires and when a stage lets go, which is flight timing and changes no static
mass or dimension. Keying on them would mean a kernel build per chute-altitude
keystroke.

The test needed a TWO-stage design, which is worth recording: the store refuses
to ground the only stage ("something has to fly"), so the first version passed
against the single-stage default for the wrong reason. Verified discriminating
by reverting the key to `seatedMotorsKey` and watching it fail.

### C5. `loadOrk` discards two carried configuration fields (HIGH, VERIFIED) - FIXED 2026-10-02

`OrkFlightConfig` declares `separations: Record<string, OrkSepOverride>` and
`grounded: string[]`, both non-optional, both documented as "carried for the
same reason the deployments are". `LoadedConfig` in
`web/src/services/files/loadOrk.ts` declares only `id`, `name`, `motors` and
optional `deployments`, and the mapping copies only those four.

So opening a `.ork` whose configuration carries `<stage number="1"
active="false"/>` or a `<separationconfiguration>` silently drops both.
`saveOrk` then writes the undefined value back and the file loses the setting
permanently.

The existing round-trip test passes because it goes `importOrk` to `exportOrk`
directly and never through `loadOrk`.

**Fixed, all four places.** Both fields added to `LoadedConfig`, copied in the
per-config mapping, added to the stand-in literal for a file that declares no
configurations, and forwarded in `wireLoadedOrk` -- which now spreads all three
carried fields rather than special-casing the deployments, so the next one
cannot be missed the same way. Both named tests extended, and the fixtures
gained a separation override and a grounded stage so the assertions have
something real to carry.

### C6. Printable solids bypass mesh validation (HIGH, VERIFIED) - FIXED 2026-10-02

`validateSolid` is called at exactly one place, inside `solidForNode`. Two
export paths call `discSolid` directly and so skip it:
`web/src/services/files/componentExport.ts` and
`web/src/services/exports/rocketPrintExport.ts`.

The choke-point comment on `solidForNode` says "Every printable solid leaves
through here". Centering rings, bulkheads, couplers and engine blocks do not.

An explicit `outerRadius: 0` lathes four on-axis points, `dropDegenerate`
removes every triangle, and `makeWatertight` returns early on `boundaryEdges ===
0` before its own throw, so a zero-triangle STL downloads reporting success.

**Fixed, as one choke point rather than a line repeated per path.** The
validation moved out of `solidForNode` into a private `validated()` that both it
and a new `discSolidForNode()` call, and the two bypassing callers use the
latter. The comment claiming every printable solid leaves through one place is
now true.

Writing the test turned up two things this finding did not separate. A zero
LENGTH is not a degenerate case: `discSolid` reads a length at or below 1e-6 as
"not stated" and substitutes 2 mm, deliberately, so a ring whose length the file
omitted is still exportable. That is now pinned, so the new guard cannot later
be widened into refusing it. A negative outer radius IS a hole, and not one
validation can close: `validateSolid`'s orientation check counts DIRECTED edges,
which a consistently reversed winding satisfies, so an inside-out lathe passes.
`discSolid` now refuses a non-positive outer radius where the dimension is read.
That closes the LOW `meshValidate` item for this path; the validator's blindness
to an inverted mesh remains true in general.

### C7. A coupler wall at or past the radius prints a solid rod (HIGH, VERIFIED) - FIXED 2026-10-02

`web/src/services/design/discGeometry.ts` returns `innerR: Math.max(0, outerR -
wall)` for `tubecoupler` and `engineblock`. With `thickness >= outerR` that is
0, and `discSolid` then takes its no-bore branch.

`solidMesh.ts` guards the tube case against exactly this with `if (!(wall < R))
return null;` and a comment naming the hazard: "printed, the part is a 24 mm rod
and nothing fits inside it". The disc path never got the guard, and `discDims`
also feeds the DXF sheet and the 3D internals, so all three agree on the wrong
part.

**Fixed.** `discDims` returns null when `!(wall < outerR)` for `tubecoupler` and
`engineblock`, matching the policy `solidMesh`'s tube branch already states.
`discGeometry.ts` also had no test file at all, which this report notes
separately; it has one now, including the exact-equality boundary that
`Math.max(0, outerR - wall)` turned into a 0 bore rather than a refusal.

### C8. Per-simulation `maxTime` has no ceiling (HIGH, VERIFIED) - FIXED 2026-10-02

The `Override` for `maxTime` in `web/src/components/sim/SimEditor.tsx` passes
`min={1}` and no `max`. The global row for the same setting in
`SettingsDialog.tsx` passes `max={10000}`, and the comment beside it names the
hazard: "maxTime / timeStep IS the solver's iteration count, and both ends were
open. 1000000 s (a plausible slip for 1000) at the default 0.01 s step asks for
100 M integration steps, with no way to interrupt the run." The per-simulation
`timeStep` override likewise lacks the global `max={10}`.

`setSimPref` stores the raw value and `simConditions` forwards it unchecked;
`settings.ts` clamps only values at or below zero.

**Fixed, from one shared constant.** `SIM_BOUNDS` in
`services/storage/settings.ts` now holds the min and max for `timeStep`,
`maxTime` and `maxAngleStep` in SI, and BOTH surfaces read it: the global rows
in `SettingsDialog` and the per-simulation `Override` rows in `SimEditor`, which
gained a `max` prop threaded through both of its render paths. Two copies of a
bound was the actual bug, not the missing number.

The test reads the SOURCE rather than a render, deliberately: the failure was a
MISSING prop, and a render test that does not know to look for `max` passes
either way. It also asserts the worst legal combination keeps the iteration
count somewhere a browser can finish.

### C9. Deployment and separation altitudes accept negatives (HIGH, VERIFIED) - FIXED 2026-10-02

The `deployAltitude` input in `web/src/components/config/DeploymentSection.tsx`
and the `separationAltitude` input in `SeparationSection.tsx` pass no `min` to
`NumberInput`. The design-side equivalent floors at zero through `NumberField`'s
`min = 0` default. `onSi` rejects only null and a failed conversion, not a
negative, so the value is committed into the flight configuration.

A negative deploy altitude means the kernel's altitude trigger never fires: a
design whose recovery is correct on the Design tab flies ballistic under that
one configuration, with nothing marking the field.

**Fixed.** `min={alt.toUi(0)}` on both, so the floor is in the user's unit as
the field is. Each carries a comment naming why `onSi` alone was not enough: it
rejects a null or a failed conversion, not a negative.

### C10. The motor grid steals arrow keys while hidden (HIGH, VERIFIED) - FIXED 2026-10-02

`web/src/components/sim/MotorGrid.tsx` registers a `window` keydown listener for
ArrowUp and ArrowDown, excluding only INPUT, SELECT and TEXTAREA. The grid's
container in `MotorDashboard.tsx` is `${effMode === 'detail' ? 'flex' :
'hidden'}`, so in Compare or Combine mode it is hidden by CSS but still mounted
and the listener stays live. `onSelect` is `select`, which calls
`setMode('detail')`.

So pressing ArrowDown while reading the Compare pane closes it and discards the
comparison.

**Fixed with the `active` prop.** `MotorDashboard` passes `effMode ===
'detail'`, and the effect returns early when it is false, with `active` in its
dependency list. Binding to the grid's own element was the other option and
would also work, but the prop states the actual invariant: a hidden surface does
not own a global key.

Three tests, including the one that matters: the grid still mounted and still
rendering its rows must not answer ArrowDown. They needed the `scrollIntoView`
stub `ComponentTree.test.tsx` already uses, since jsdom does not lay out.

### Correctness, medium - ALL FIXED 2026-10-02

Nineteen findings, seventeen fixed here and two closed earlier as collateral of
C1. They are not nineteen unrelated bugs: they fall into six repeating shapes,
and the fix for each shape is one thing rather than one patch per site.

**Untrusted file values reached the tree.** The same gap S2 closed for byte
counts, on the value axis. `numTag` accepted any finite number, so a `.ork` could
state a negative length, radius, thickness, chord or mass and have it reach the
mesh, the mass integral and the kernel. There is now a `nonNegTag` beside it,
applied to every dimension and mass, with the ONE signed fin dimension
(`<sweeplength>`, negative for a forward-swept fin) left on `numTag` and said so
in the comment. The `.rkt` reader already floored every dimension it read and
says in its own words that the handlers which do not are "an inconsistency rather
than a decision"; the two formats now follow one rule. A negative mass, CG or Cd
override is DROPPED rather than floored, because an override of zero is a real
instruction and a file stating nonsense asked for no override.

**A default or a unit spelled locally instead of read from its one home.** Four
of these, and the kernel-default drift is the one that produced a wrong physical
part: three literals disagreed with `ComponentFactory`, so an exported launch lug
came out at 5.5 times its flown radius. Every one now reads `KERNEL_DEFAULTS`,
per type, and a type the factory states no default for returns `NaN` so the part
is SKIPPED rather than invented. The test measures the geometry rather than
asserting against a literal, so it fails when a consumer stops reading the table.

**An await resolving onto state that had moved.** Three. `saveOrk` was the only
async action in the store with no staleness handling at all; it snapshots one
vintage now, and aborts if the workspace was replaced under it. The five
callbacks that wrote to "whatever rows are current" got `useLatest`, which is the
`pickGen` pattern `MotorDialog` already had, named once instead of written five
times.

**A raw input where `NumberInput` should be.** Two delay boxes committed a value
the moment the field was CLEARED to retype: a 0-second ejection charge and a
0-second air-start, both flown by the kernel, both reachable by pressing
Backspace. Both go through the draft buffer that exists for this.

**Draw code diverging from export code.** Both closed by C1.

**Non-finite values and main-thread cost.** `stackedBands` was worse than a gap
in a line: one NaN accumulated into the running sum, so the literal string `NaN`
went into the path data and every band stacked above it was poisoned, and the
browser silently drops a path it cannot parse.

- **Negative masses and dimensions from a `.ork`** (REPORTED) - FIXED 2026-10-02. `importTags.ts`
  `readOverrides` and `numTag` accept any finite value, so a negative
  `<overridemass>`, `<overridecg>`, `<mass>`, `<length>` or `<diameter>` reaches
  the tree and the kernel. The `.rkt` reader floors every equivalent value and
  calls the unfloored cases "an inconsistency rather than a decision";
  `repairValues.ts` clamps `density` alone. Fix: floor at 0, or extend the
  `LIMITED` table so the load reports what it moved.
- **`Number(null)` grounds the sustainer** (REPORTED) - FIXED 2026-10-02. `importConfigs.ts` reads
  `stageIds[Number(flag.getAttribute('number'))]`, and `Number(null)` is 0, so a
  `<stage active="false"/>` with a missing `number` grounds stage 0. The
  function's own doc claims such a flag is dropped rather than guessed at, which
  holds only for a non-numeric value. Fix: read through `finiteNum`.
- **RockSim colors are stored unvalidated** (REPORTED) - FIXED 2026-10-02. `rktImport.ts` writes
  `<Color>` verbatim into the node key the app treats as a hex string. The
  `.ork` reader validates to `#rrggbb`. Consumers feed it to SVG `fill` and to a
  three.js material, and `orkExport` silently drops anything not matching
  `/^#?([0-9a-f]{6})$/i`. No test covers `Color` on the `.rkt` path.
- **Mixed-vintage `.ork` snapshot** (REPORTED) - FIXED 2026-10-02. `store.ts` `saveOrk` captures
  `tree` and `loadedMeta` up front, then awaits a catalog fetch, then reads
  `activeConfigId` and `launch` fresh. It is the only async action in the store
  with no staleness guard. Saving while the catalog is still loading, then
  editing, writes pre-edit geometry with a post-edit launch block. Fix: capture
  the whole snapshot once and take `observeWorkspace()`.
- **`patchSelected` has no no-op guard** (REPORTED) - FIXED 2026-10-02. Every neighboring
  tree-editing action has one. `updateNode` always returns a fresh `components`
  array, which is the rebuild dependency, so a value-identical patch triggers a
  full kernel build. `NumberInput` fires per keystroke with the already-clamped
  value, so typing past a ceiling fires N identical patches and leaves an undo
  step that changes nothing.
- **`stackedBands` has no finiteness handling** (REPORTED) - FIXED 2026-10-02.
  `components/canvas/aeroTables.ts` accumulates into `cum`, so one NaN sample
  emits the literal `NaN` into the path data and poisons every band after it.
  The browser drops the path silently. Non-finite readings demonstrably occur:
  `sweep.nonFinite` is surfaced in the UI. The sibling `buildLinePath` in the
  same file handles this and documents why.
- **Custom ejection delay commits 0 on a cleared box** (REPORTED) - FIXED 2026-10-02.
  `MotorDialog.tsx` uses a raw `<input type="number">` with
  `clampEntry(parseFloat(v), 0, PLUGGED_DELAY) ?? 0`, so clearing the field to
  retype stores a 0-second charge. This is the failure `NumberInput`'s draft
  buffer exists to prevent.
- **Kernel default drift in three places** (REPORTED, with Java citations) - FIXED 2026-10-02.
  `solidMesh.ts` uses `outerRadius` 0.012 for both `innertube` and `launchlug`
  where the kernel builds 0.0095 and 0.0022, and `thickness` 0.0005 for
  `bodytube` where the kernel uses 0.0003. `discGeometry.ts` uses a bare 0.003
  for `tubecoupler` length where the kernel builds 0.05. `reportGeometry.ts`
  uses 0.08 for tube fin set length where the kernel uses 0.1. A launch lug at
  5.5 times its flown radius does not fit the rocket that was simulated. Fix:
  read `KERNEL_DEFAULTS`, which exists so these have one home.
- **Unit drift between the two surfaces for one setting** (VERIFIED) - FIXED 2026-10-02.
  `SimEditor.tsx` hardcodes `unit="°"` and an inline `* 180 / Math.PI` for
  `maxAngleStep`, while `SettingsDialog.tsx` resolves it through
  `u.at(unitScope(...), 'angle')` and says in a comment that it was changed to
  that "rather than an inline `* 180 / Math.PI`". `angle` has a `rad` option, so
  a user working in radians sees the two surfaces disagree.
- **Map scale ignores the unit preference** (REPORTED) - FIXED 2026-10-02. `SiteMap.tsx`
  `scaleLabel` hardcodes m and km while every other readout in the same file
  goes through preferences and `distance` offers `ft`.
- **Cubic image trace on the main thread** (REPORTED) - FIXED 2026-10-02.
  `services/design/finImage.ts` `simplify` is triply nested over whatever
  `traceOutline` returns, whose own bound is `8 * width * height`, and
  `FreeformFinActions.tsx` passes the full `createImageBitmap` result with no
  downscale. The documented workflow is tracing a fin off a photograph. Tests
  use single-digit ASCII fixtures only.
- **`finTabFront` is a second copy of a private helper** (VERIFIED) - FIXED by C1.
  `components/canvas/schematicGeometry.ts` duplicates `finTabFrontEdge` from
  `tree/finPlanform.ts` and omits the clamps `finTabSpan` applies around it. Its
  only consumer is the tab renderer below. Two test files pin the duplicate,
  which makes the drift look covered.
- **The schematic tab is unclamped** (VERIFIED) - FIXED by C1. `schematicShapes.tsx`
  `renderTab` computes the through-the-wall tab from raw `tabLength` with no
  clamp into `[0, rootChord]`, while `reportGeometry.ts` goes through
  `finTabSpan`, which clamps both ends. A tab longer than the root chord, a
  state the app explicitly warns about, draws past the fin edges while the DXF,
  the STL and the PDF all cut the clamped tab.
- **Imperial and metric unit tables do not match the desktop setters**
  (REPORTED, with Java citations) - FIXED 2026-10-02. Six entries differ: metric `surfaceDensity`
  and `lineDensity`, imperial `surfaceDensity` (and its chosen unit is not in
  the Java group at all), `force`, `impulse` and `pressure`. All conversion
  factors were checked and are correct, so nothing is stored wrong, but the
  comment asserts fidelity that is not there.
- **`multiStageSummaries` can leave a stale kernel handle** (REPORTED) - FIXED 2026-10-02.
  `reportModel.ts`'s `finally { restore(buildWhole()) }` does not protect
  against `buildWhole()` itself throwing, in which case `restore` never runs and
  the store holds a superseded handle. Nothing re-triggers the rebuild, because
  its dependencies did not change, so the aero pane stays dead until an
  unrelated edit.
- **Geolocation and file reads land on the wrong rows** (REPORTED) - FIXED 2026-10-02.
  `LaunchPanel.tsx`'s geolocation callbacks, `WindProfileDialog.tsx`'s
  `importCsv`, `MotorDialog.tsx`'s `onImport` and `onDelete`, and
  `FlightPathExport.tsx`'s `onImport` all resolve after an await with no mounted
  or generation guard. `onChange` writes to whatever rows are the current edit
  targets, which may not be the ones that were on screen. `MotorDialog.pick`
  already implements the `pickGen` pattern in the same file.
- **Tile load forces a full re-render per tile** (REPORTED) - FIXED 2026-10-02. `GroundTrack.tsx`'s
  `onLoad` sets a fresh object literal while `onError` directly beneath it uses
  the identity-preserving functional form. Combined with unmemoized point
  strings over a track with no decimation, switching the layer on a long flight
  stalls the tab.
- **Diameter caliper prints no unit** (REPORTED) - FIXED 2026-10-02. `SchematicCalipers.tsx` omits
  `u.sym('length')` on the diameter readout while the length readout directly
  above includes it. The `aria-valuetext` does carry the symbol, so sighted
  users get less than screen-reader users.
- **Two zoom controls are inert at the default view** (REPORTED) - FIXED 2026-10-02. `AftView.tsx`
  never disables the zoom-out and fit buttons; at the default view both are
  no-ops because of a clamp and a shared module constant.
  `SchematicControls.tsx` gates the equivalent pair. A control that looks
  clickable and does nothing is a bug in this project regardless of rationale.

### Correctness, low - ALL FIXED 2026-10-02

Twelve findings, every one a failure that left no trace. What they had in common
is why they were only ever going to be found by reading the code: a refused write
that resolved cleanly, a quadratic import that merely felt slow, a scaled node
that shared an array with the node it came from.

`flightPathExport` bridged interior gaps with a straight line where the sibling
chart breaks the path. It now skips a sample whose time, altitude or position is
not finite, rather than planting the rocket on the pad at sea level mid-flight
and drawing a line down to it and back. The gap still closes, because a KML
`LineString` and a GPX `trkseg` are one polyline per branch by format and the
templates are a published contract - but a line between two measured points is an
interpolation, where a fabricated point is an invention.

The freeform branch of `schematicShapes` drew nothing below three points where
the 3D view and the PDF both fall back to `FREEFORM_FALLBACK`. **Closed by C1**,
which collapsed the three fin branches into one `finPlanformPoints(child) ??
FREEFORM_FALLBACK`.

`motorDb` did one IndexedDB transaction per motor, so a manufacturer-range import
was quadratic and reported nothing on a partial failure. `MotorStore` gained
`addCustomMotors`, one atomic `kv.update` for the whole file: linear, and
all-or-nothing, so a refused write stores no part of the batch instead of some of
it. The new-order rule is pinned, because repeated single adds produced
newest-first and a batch must not quietly reorder the picker.

`saveSettings` swallowed a quota failure with a bare `catch {}` while every other
store in the slice was deliberately converted to propagate one. It returns a
boolean now, and `SettingsProvider` raises the same storage banner the design
library and the workspace raise. The store is imported lazily there, and not for
weight: a static edge would construct the workspace store as a side effect of
loading the provider, and the store reads `loadSettings()` at construction, so a
test that mocks the settings module would build the store against the mock before
it had one.

`materialStore.isMaterial` accepted a zero or negative density. It requires `> 0`
now, which is the rule the `.ork` reader, the `.rkt` reader and
`ComponentFactory` all already apply to a density: every reader divides or
multiplies by it, so a zero is a part with no mass and a negative one lightens
the rocket.

`rktImport` materialized the whole `PointList` before the point cap applied. It
scans with `indexOf` now, the way the `.ork` reader's sibling walk already does:
the bound is on what gets BUILT, not only on what gets kept.

`replaceWorkspace` reset eight transient fields but not `info` or `rocket`, so
for one frame a new blank design showed the previous design's mass. Both are
cleared, to the same `null` the rebuild effect uses for "not built yet".

`meshValidate`'s orientation check counted directed edges and so passed a mesh
wound consistently inside out. It now also computes the signed volume, and
reports `inside-out` when a closed, consistently wound surface faces inward. The
test proves the old check could not see it: a flipped tube is still reported as
consistently wound, because flipping every triangle flips every directed edge
too and the counts come out identical.

`finImage` used `?? 0` on channel reads, where 0 is pure black and reads as fin.
A byte past the end of the array now reads as background, so a truncated decode
can no longer invent an outline out of data that is not there.

`scaleNode` returned `{ ...n }`, aliasing `children` and any malformed point row.
Children are left off entirely, which is what its own doc always said ("Children
are handled by the caller") and what both callers already supply; a point row it
cannot scale is copied rather than shared.

`windStdDev` and the turbulence percent had no upper bound anywhere between the
box and the solver. The scatter is bounded by `MAX_WIND_SPEED_MS` itself - no
safety code states a figure for a deviation, so borrowing the wind cap beats
inventing a second number - and the percentage stops at 100, four rungs past the
"extreme" band `turbulenceLevel` names. Both surfaces that edit it carry it.

`SiteMap`'s wheel handler zoomed the map and also scrolled the enclosing form,
because React's `onWheel` is registered passive at the root and the
`preventDefault` inside it did nothing. It is a native non-passive listener now,
the same mechanism `useWheelZoom` and `useChartZoom` already use.

---

## Architecture and tooling

### T1. The working branch is gated by nothing (HIGH, VERIFIED) - FIXED 2026-10-02

`ci.yml` triggers on `pull_request` only. `deploy.yml` triggers on `push:
branches: [master]`. `dev.yml` triggers on `push: branches: [dev]`.

The checkout is on branch `test` with five commits. No workflow trigger matches
it, so not one of format, spell, typecheck, lint, knip, unit tests, e2e or
coverage runs on any commit being worked on.

**Fixed** with `branches-ignore: [master]`. Every push to every branch but
master now runs `npm run verify`: format, spell, typecheck, lint, knip and the
unit suite. master is the one exclusion, and only because `deploy.yml` already
runs the full gate set there. A branch with a PR open deliberately runs both
this and `ci.yml`; two minutes of duplicate web checks is worth not having to
reason about which branches have PRs. Tag pushes still do not trigger it, since
a branch filter of either kind confines `push` to branches.

What makes this worth recording is that it was the SECOND attempt. `dev.yml`'s
own header already said a push with no PR open "was checked by NOTHING" and that
the previous audit "called for a workflow on every push" -- and then the trigger
was written as `branches: [dev]`, which closed the hole for one branch name and
left it open for every other. Naming the branch was the bug.

`web/tests/ciTriggers.test.ts` now asserts the trigger matrix leaves no push
unchecked, and fails if `dev.yml`'s trigger is narrowed back to a `branches:`
list. Verified discriminating by restoring `branches: [dev]` and watching it
fail. The assertion is textual on purpose: the hazard is the shape of the
config, and parsing would mean importing a YAML package that is only present
transitively, which `knip` would then report as unlisted.

Not changed: the workflow is still NAMED `Dev`. GitHub reports the check as
"<workflow name> / <job id>", so renaming it renames "Dev / verify" and would
silently break any branch-protection rule requiring that name. That wants doing
together with the protection settings, and a comment in the file says so.

### T2. The motor collision check cannot fail the publish (HIGH, VERIFIED) - FIXED 2026-10-02

In `.github/workflows/sync-catalogs.yml` the motor row-key collision check lives
in the Summary step, prints a warning, never sets a non-zero exit, and runs
after the publish step. `web/scripts/sync-motors.mjs` `assertSane` has floors
for empty output, too few curves and a shrink past 90%, but no duplicate check.

The workflow's own comment says a collision "makes two distinct motors select as
one". It runs weekly with `contents: write` against the `data` branch the live
app reads, so a collision reaches every user's motor picker with a green
workflow.

**Fixed, and the rule now has one definition instead of three.** The collision
check is in `assertSane`, where it joins the same `problems` array the other
three floors use and so hits the existing `Refusing to write
motors.generated.json` throw. That runs at line 216 and the write is at 217, so
a collision means nothing is written and the publish step has nothing to push.
The warning-only block is gone from the Summary step, which could never have
failed the job from after the publish anyway.

Moving it created the drift risk the finding is really about, so that is handled
too. The expression existed three times: `keyOf` in the app, the workflow's
inline copy, and now the script's. A plain `.mjs` cannot import the TypeScript
`keyOf` (no loader), so the script's copy lives alone in
`scripts/lib/motorRowKey.mjs` and `tests/services/motors/motorRowKey.test.ts`
pins it to `keyOf` over six catalog shapes, including the `?? ''` branch that
makes a missing code and an empty code the same key. Two copies held equal by a
test beats three copies held equal by hope.

Verified against the real shipped catalog, not a fixture: 815 motors, zero
collisions today, and a planted duplicate is reported with its full key (a
Quest micro motor).

### T3. The spell gate's `files` list is an allowlist with real holes (HIGH, VERIFIED by probe) - FIXED 2026-10-02

`cspell.json` `files` lists `web/src/i18n/locales/en.json` and no other locale,
and does not list `web/*.{ts,js}` at all.

Demonstrated by the review agent and since reverted: injecting a value with
three British spellings and one plain misspelling into
`web/src/i18n/locales/es.json`, plus a similar comment into `vite.config.ts`,
`playwright.config.ts` and `eslint.config.js`, then running `npm run spell`,
reported `Files checked: 671, Issues found: 0`. Every planted error passed.

So the nine non-English locale files carry user-visible UI text outside the
gate, and the root config files, which hold some of the longest prose comments
in the repo, are unchecked for both spelling and British spellings.

**Fixed, in two different ways, because cspell can only do half of it.**

`web/*.{ts,js}` is now in `files`, which put the root configs in the gate and
immediately found a real British spelling in `playwright.config.ts` (the
British form of "serializes", not repeated here for the same reason). Also needed one project-words entry, `swiftshader`, the
ANGLE backend named in the Playwright launch args.

The nine translated locale files are checked by a TEST instead,
`tests/i18n/localeFlagWords.test.ts`, because cspell genuinely cannot do it:
spell-checking a translation needs that language's dictionary and the `cspell`
package bundles none of the nine. Pointing it at `es.json` would flag every
Spanish word. The forbidden-word half needs no dictionary and is the half that
matters, since the list is entirely British forms. It is read OUT of
`cspell.json` rather than copied, so the two cannot drift.

Measured before writing it, which changed the design: French legitimately
contains six of the forbidden words, and German and Dutch each contain one more.
A blanket sweep would have failed on correct French. So there is a small
explicit per-locale allowance of native collisions, and a further test keeps
that allowance honest by refusing an entry for a word nobody forbids. The six
are enumerated in the test's `NATIVE` table and deliberately not repeated here,
because they are forbidden words and this report is itself spell-checked.
Verified discriminating: planting two of them in `es.json` fails with both
named.

### T4. The storage namespace is misspelled, and the gate was taught to accept it (HIGH, VERIFIED) - FIXED 2026-10-02

`.cspell/project-words.txt` whitelists both the correct project name and a
double-letter misspelling of it, on consecutive lines.

The misspelling is the dominant spelling: 58 occurrences across 29 files under
`web/`, covering 17 distinct namespace keys including `designs:index`,
`designs:active`, `workspace`, `settings:v`, `motors:custom`,
`materials:custom`, `templates:custom` and `parts:custom`. The only key on the
correct spelling is `ENGINE_PREF_KEY`, which is also quoted as a user-facing
debug instruction.

So the app has two storage namespaces and the one holding every saved design is
misspelled. No prefix sweep exists today, so this is not yet a data-loss bug,
but any future "clear app data" or quota sweep over one prefix silently misses
the other.

**Fixed, in two steps on the same day.** First the centralization: one owner,
`STORAGE_PREFIX` with an `nsKey()` helper in `services/storage/storageKeys.ts`,
with the literal gone from 13 source modules, 14 test files and the e2e harness.
And one namespace instead of two: `ENGINE_PREF_KEY` was the single
correctly-spelled key and now builds from the same prefix.

Then the rename itself, **with no migration**. This was first deferred on the
grounds that the prefix is the IndexedDB database name and the key prefix for
every saved design, so correcting it meant moving real user data. That reasoning
was wrong about this repo: the app is **0.1.0 preview**, and the only thing under
the old prefix is a developer's or a preview user's scratch design. There is
nothing to migrate, so there is no migration. Data still sitting under
`astrarrocketjs` is simply not read any more.

One read chain was kept, for exactly one key. `ENGINE_PREF_KEY` is a DEBUG switch
quoted in the docs (`localStorage.setItem(ENGINE_PREF_KEY,'js')`), so someone who
set it by hand is not asked to do it twice; the old prefix is in
`LEGACY_ENGINE_PREF_KEYS`. A design under the old prefix is scratch and is
deliberately dropped; a backend override someone set this morning is a live
instruction. That asymmetry is the whole of the migration story.

**The guard had to change shape with the rename**, which is the part worth
remembering. While the prefix was a typo, "this string appears in exactly these
files" was a usable test. Spelled correctly it is the package name and the product
name, so it legitimately appears in `package.json`, the docs, the page title and
the manifest - the old test would have flagged all of them. What a file can still
get wrong by hand is a KEY, and a key is the prefix followed by a COLON, so that
is what the test looks for now. It also pins `STORAGE_PREFIX` against the literal
`'astrarocketjs'`, because every other assertion in the file derives from the
constant and so would pass for any spelling at all.

Three `.mjs` harnesses had the old key spelled out, as they must (no TS loader, so
they cannot import the constant). Left unchanged they would have seeded settings
the app no longer reads - and the comment above each one claims the mismatch is
self-detecting, which is true but only at the point the offline check fails. All
three are corrected.

One thing the guard turned up and the rename deliberately did NOT touch. The
kernel's patch marker tag is `PATCH(astrarrocketjs)`, the same misspelling, in 25
patched sources plus the extraction tooling that greps for it. It is a different
thing that happened to share a spelling, it is not a storage key, and renaming it
would mean re-blessing every patched file against `DIVERGENCE.txt`. The test skips
`engine-java` and says why.

### T5. Help has no automated coverage at all (HIGH, VERIFIED) - FIXED 2026-10-02

`web/e2e/help-dialog.spec.ts` skips on `existsSync('public/docs/index.html')`.
`web/public/docs/` is gitignored, confirmed with `git check-ignore`, and
untracked, and the `e2e` job's steps are checkout, setup-node, `npm ci`,
playwright install and `npm run e2e --shard`, with no `docs:build`. So every
test in that spec is skipped in every CI run and the shard exits 0.

Separately, `e2e:offline-help` exists in `package.json` and is run by no
workflow, while its sibling `e2e:offline-data` is run in `update-flow`. The
script's own header explains why it matters: the docs are built into the app
rather than only published.

So the in-app Help dialog and offline Help, the launch-site-with-no-signal case
the PWA exists for, have zero automated coverage, and both jobs are green.

**Fixed, both halves, plus the thing that let it hide.** The `e2e` and
`update-flow` jobs now install the website's dependencies and run `npm run
docs:build` for themselves, and `update-flow` runs `npm run e2e:offline-help`
beside its `offline-data` sibling. Verified by building the docs locally and
running the spec: 7 passed, having skipped in every CI run there has ever been.
`e2e:offline-help` also passes, and had never been executed by any workflow.

The durable part is the third change. `help-dialog.spec.ts` now THROWS in CI
when the docs are missing, naming the step that should have built them, and
skips only locally. A silent skip is what made this invisible: the shard
reported green while testing nothing, so adding the build step without that
change would leave the same hole one `continue-on-error` or one dropped step
away. Verified both ways: with the docs removed, `CI=1` fails with the message
and a bare run still skips 7.

Cost: the docs build is paid once per shard, three times over, which is the
price of the docs being a build input rather than only a published artifact. A
single `docs` job uploading an artifact would pay it once, but a download step
that silently delivers nothing puts the skip back, and loud-and-local beats
cheap-and-quiet here.

### T6. No type-aware lint rules (MED, VERIFIED by probe) - FIXED 2026-10-02

`web/eslint.config.js` extends `tseslint.configs.recommended`, not
`recommendedTypeChecked`, and sets no `parserOptions.project` or
`projectService` anywhere. So `no-floating-promises`, `no-misused-promises`,
`await-thenable` and the whole `no-unsafe-*` family never run.

Demonstrated with a temporary probe config, since deleted: **30 errors**, being
3 `no-floating-promises` (`ComponentExportButton.tsx`, `AppHeader.tsx`,
`i18n/index.ts`) and 26 `no-misused-promises` across twelve components.

None of the three floating ones is a live unhandled rejection today, because the
store actions they call catch internally. That is the point: the invariant
making them safe is convention only. A new store action that forgets it produces
a click that silently does nothing, with every gate green.

**Fixed.** `parserOptions` now names all three tsconfigs and the two promise rules
are `error`.

`projectService: true` was the first attempt and is the modern recommendation, but
it auto-discovers the nearest `tsconfig.json` and nothing else. This project
deliberately has three, so every e2e spec and every root config came back "was not
found by the project service": **31 parse errors**, a louder failure than the one
being fixed. The explicit `project` array is the same three runs `npm run
typecheck` makes.

The rest of `recommendedTypeChecked` is deliberately NOT adopted. The `no-unsafe-*`
family fires on every `as unknown as` boundary cast, and this app has them on
purpose at the kernel seam where the vendored TeaVM bundle has no types to check
against. Taking that set means deciding what to do at that seam, which is its own
change and a large one.

The probe predicted 30 errors. The real count was **13**, because
`checksVoidReturn: { attributes: false }` removes the 26 JSX handler props - a prop
is declared `() => void` and React has never awaited one, so `onClick={async () =>
...}` is the ordinary way to write an async handler and flagging it is flagging
React. What was left:

- **3 floating promises in components**, as predicted: `CenterView`'s auto-run
  effect, `ComponentExportButton`'s menu item, and `AppHeader`'s file input.
- **4 misused promises the probe counted as JSX attributes and are not.** They are
  OBJECT properties in `AppHeader`'s `actions={{ ... }}`: `onNew`, `onExportOrk`,
  `onExportRkt` and `onExportRasaero`, each a store action passed straight into a
  slot declared `() => void`. `attributes: false` does not and should not cover
  these.
- **1 in `i18n/index.ts`**: the top-level `.init()`.
- **5 in `useWorkspaceEffects.test.tsx`**, all un-awaited `act(...)`.

**The components got a helper rather than a `void`.** `void onSave()` satisfies the
rule and preserves the hazard exactly as the finding describes it: safe only because
the action catches internally, so a new action that forgets gives a click that does
nothing with every gate green. `state/fireAction.ts` attaches the handler the action
should have had, so a forgotten catch reaches the same error banner a remembered one
uses. Six call sites, one test proving a rejection lands in `err`.

**The five test hits were a type accident worth fixing properly.** `act` has two
overloads - a `void` callback returns `void`, anything else returns a `Promise`. Each
of these was `act(() => vi.advanceTimersByTime(400))` or `act(() =>
window.dispatchEvent(...))`, and both of those expressions RETURN a value
(the timer instance, a boolean), so the arrow picked the promise overload and the
test was typed as an async act it never awaited. Bracing the bodies selects the
`void` overload. No rule config, no suppression, and the tests are more honest than
they were.

**`i18n.init()` gets a `.catch` with a reason.** Every translation is bundled so
there is no fetch to fail; a rejection means the config is wrong, and the symptom is
the app coming up showing raw keys with nothing anywhere saying why. It logs rather
than using the store's banner, because this runs at module load before the store
exists and a broken i18n cannot translate its own message.

`tests/lintScope.test.ts` asks the linter what it concluded - `isPathIgnored` and
`calculateConfigForFile` - rather than reading the config as text, because a
`files`/`ignores` interaction is exactly what a regex over the source gets wrong.

### T7. knip cannot see test-only src exports (MED, REPORTED) - FIXED 2026-10-02

`knip.json` puts `tests/**` and `e2e/**` in `project`, so a test import counts
as a use. The review agent verified 14 src exports whose only reference in src
is their own declaration, reached from tests alone. `knip --production` is not a
usable alternative: it reports none of them and emits 10 false-positive unused
dependencies.

Of the 14, one is explicitly named a test-only export and is intentional. The
rest are listed under dead code below.

**Fixed, and BOTH suggested fixes in this finding turned out not to work.** Worth
recording, because they look obviously right.

A second knip run with `project: ['src/**/*.{ts,tsx}']` reports **nothing**. knip
resolves importers through the TypeScript program, so a `tests/` file importing an
src export counts as a use however `project` is scoped. Demonstrated rather than
assumed: a deliberately unreferenced export was planted in `rocketReport.ts`, the
same file as the known test-only `thrustToWeight`, and the src-only run flagged the
plant and not `thrustToWeight`. Giving that run its own tsconfig with `include:
['src']` changes nothing, for the same reason.

So the rule is `web/tests/srcExportReach.test.ts`, which is the shape this repo
already uses for a gate a tool cannot express (`ciTriggers`, `storageKeys`,
`lintScope`). It walks `src`, and for each exported VALUE asks three questions: is it
used inside its own module, is it mentioned in any other src file, is it mentioned in
a test. Only the third-yes-two-no case is reported.

The same-file check is the half that matters. Without it the scan reports **fifty-four**
names instead of fourteen, because an export a sibling function in the same module
calls is not dead by any reading - knip spells that `ignoreExportsUsedInFile`. With
it, the scan independently reproduces the audit's number exactly: **14**, being the 13
in the dead-code table plus `__setEngineForTests`, which is a deliberate seam and says
so where it is declared.

The list is a **baseline, not an endorsement**, and is labeled that way in the file.
Adjudicating "intentional seam" or "dead" line by line is the dead-code pass, and
labeling fourteen entries from a distance would be guessing in a file that then reads
as authoritative. What it does is stop the set growing in silence, and make the
cleanup verifiable: delete a dead export and the second assertion fails until its
line goes too. A third assertion pins the count, so a regex that stops matching
cannot send an empty scan green.

Two knip config gaps from the tooling-low list were closed while here, since they are
the same file: `index.html` is now an `entry` (the app graph resolved only by plugin
auto-detection before), and the root config files are in `project`. knip is still
clean after both. `knip --production` still emits its ten false-positive unused
dependencies and is still not run by any gate; that is untouched.

### T8. eslint walks 70 generated files to apply no rules (MED, REPORTED) - FIXED 2026-10-02

**Fixed.** `'public'` and `'src/engine/vendor'` added to `ignores`: `eslint .` went
from 732 files to 662.

The hazard was the next change, not the cost, exactly as the finding says. Covered by
`tests/lintScope.test.ts`, which asks `isPathIgnored` for a vendor file and a
`public` file and then checks that `src`, `tests`, `e2e` and `scripts` are all still
linted - a one-sided test here would pass just as happily on `ignores: ['.']`.

`eslint.config.js` `ignores` omits `public` and `src/engine/vendor`, which both
`.prettierignore` and knip exclude. `eslint .` processes 705 files, 70 of them
generated, including the 2.9 MB vendored engine bundle. `--print-config`
resolves 0 enabled rules for those, because the first block's `files` list is
root-anchored.

The real risk is the next change: a config block added without a `files` key,
the normal way to add a project-wide rule, would immediately fire on all 70
under `--max-warnings 0`.

### T9. The kernel-driving tests have under 10% timeout headroom (MED, VERIFIED) - FIXED 2026-10-02

`web/tests/engine/rodClearanceModel.test.ts` sets `vi.setConfig({ testTimeout:
60_000 })` and takes **54.6s** for its 11 tests when run alone.

Under the full suite it failed once here: one test reported 93.6s against the
60s timeout and the file took 465s. On a quiet machine the full suite passes,
235 files and 3252 tests in 314s. That failing run also had six audit agents
competing for the machine, which is heavier than a CI runner, so the failure
itself is not evidence of a CI problem. The headroom is: 54.6s of work against a
60s cap.

`vitest.config.ts` already documents this exact class of problem for
`engineBoundary.test.ts` and fixed it by capping `maxWorkers` to 4.
`rodClearanceModel.test.ts` is a newer kernel-driving test that the cap does not
save.

The consequence is specific and was reproduced: vitest writes no
`coverage-summary.json` on failure, so `gates.yml`'s coverage step falls into
its "the suite did not finish" branch and the run reports no coverage at all.

Reproduced a second time on 2026-10-02, this time under `npm run test:coverage`
itself rather than under a plain run: 1 failed of 3470, the whole suite taking
520s against its usual 65s, the same file and the same timeout. That run also had
a competing vitest process holding the coverage directory, so again it is not
evidence about CI, and a clean `test:coverage` on an idle machine immediately
afterwards passed all 3471 and reported its coverage normally. What the failure
does show is that the file which tips over is the one the coverage GATE depends on
finishing, and that it still takes 55.2s alone against a 60s cap - the headroom
has not moved, and the thing that consumes it is load, which a CI runner has.

**Fixed by raising the cap, and by giving it one home.** FOUR files fly the real
kernel, not one: `engineBoundary`, `rodClearanceModel`, `loadOrk.unbuildable` and
`exampleLibrary`. Each spelled `60_000` with a paragraph of its own explaining why,
and `tests/testing/kernelTimeout.ts` is that paragraph once with the number in one
place. Each file still opts in by importing it, because a global bump would slacken
the ~3480 tests that have no business taking seconds and hide exactly what a timeout
is for.

**180 s, three times the slowest measured file.** A timeout exists to catch a HANG,
and three minutes catches a hang as well as one does: a deadlocked kernel is not
going to finish in 170 s. What it stops catching is a loaded runner, which was never
worth failing a build over. Sizing it just over the work was the actual mistake -
54.6 s against a 60 s cap is not a margin, it is a coincidence.

The separate non-parallel project was the other option and is worse here: it splits
the suite into two runs for four files, and `maxWorkers: 4` already addresses the
contention that caused the original engineBoundary problem.

### T10. The coverage floor has 19 points of slack and is not in `verify` (MED, VERIFIED) - FIXED 2026-10-02

`vitest.config.ts` sets `thresholds: { lines: 55 }` against a measured 74.86%.
Only lines is floored; branches at 65.83% and functions at 65.15% are reported
and not gated.

`npm run verify` ends in a bare `vitest run`, and `dev.yml` runs plain `verify`,
so the floor is reached only through `gates.yml`'s `npm run verify --
--coverage`.

The config comment states the intent plainly: the floor "exists to catch a
change that deletes a test file or a whole tested module, which drops lines by
whole points, not to make every PR raise the number." That is a reasonable
policy, so the finding is narrower than "the floor is too low": a change
deleting roughly a fifth of the suite is green, and the documented local
pre-push list does not check coverage at all.

**Fixed, both halves, and the second one has a price worth stating.**

The floors are now `lines: 70, branches: 62, functions: 61, statements: 69` against a
measured 74.85 / 66.52 / 66.00 / 73.55 - about five points of room each, which still
absorbs a refactor moving code between files and no longer lets a fifth of the suite
be deleted silently. Branches and functions were reported in the job summary and
enforced by nothing, which made them decoration; they are also where coverage
actually erodes, since a new `if` with no test for its other side moves branches and
leaves lines alone.

The floor is reached on every push now, not only on a PR, and WITHOUT slowing the
command a developer types. The first attempt did it the way this finding literally
prescribed - `verify` ending in `test:coverage` - and that took `verify` from about
90 s to about 350 s, which is a bad trade: nobody needs to pay 270 s of
instrumentation to learn that lines moved a tenth of a point, and a pre-push gate
that slow is a pre-push gate people stop running.

The shape that gets both is one shared list with two endings. `gates` is
format, spell, typecheck, lint, knip and `vite build`; `verify` is `gates` plus
`vitest run`; `verify:ci` is `gates` plus `test:coverage`. `dev.yml` and `gates.yml`
both run `verify:ci`, so the floors are enforced on every push, and the gate set
still cannot drift between CI and a developer's machine, which is the property the
single `verify` list existed for.

Measured: `verify` 99 s including the production build, `verify:ci` about 350 s.

### Architecture, medium

These are design findings, not defects. Each names a concrete split.

- **`store.ts` `runSims`** is 170 lines doing six unrelated jobs: the design
  blocker gate, the runnability split, batch dispatch, two error-aggregation
  buffers, i18n rendering and workbench navigation. The pure part, which rows
  fly and which are refused and why, is a pure function trapped in an action;
  three test files drive the whole store and a stubbed worker to assert
  arithmetic. Lift `{ flying, skipped }` into `services/flight/runPlan.ts`.
- **`store.ts` `openOrkFile`** has the same shape for the import path: the
  library-naming policy with two modal dialogs, the safety-limit note text and
  the banner assembly are all inline. Lift `importBanner()` into
  `services/files/` and `homeForImport` into `designLibrary` with the dialogs
  injected.
- **`Simulation.outdated` is maintained by hand in seven places** plus a React
  effect with two refs. It is derivable: `simInputs` and `sameSimInputs` already
  compute the pair, and `runSims` captures `flownFrom` and then discards it.
  Store it on the result and expose `outdated` as a selector; that deletes the
  invalidation effect, `hydrationGen`, `markOutdated` and `markPrefsOutdated`.
  Two shipped misses are already recorded in comments.
- **The engine rebuild is not debounced** while the autosave beside it is
  debounced 500 ms and the sim work was moved off-thread for this reason.
  `NumberInput` emits per keystroke, so dragging a dimension slider runs one
  full main-thread kernel build per input event. `useAeroSweep` already solves
  this for the cheaper call. Give the rebuild the same deferral.
- **Auto-run is an effect, not a command.** `CenterView.tsx` fires a simulation,
  a user action with worker side effects, from an effect whose guard is
  `!runFailed`, where the selector exists only to break the loop and `SimRun`
  carries a whole `RocketTree` reference for no other reason. The store comment
  records the shipped failure, a reproducible timeout retried without limit. A
  second hole remains: the design-blocker early return writes `err` but no
  `simRuns` entry, so the guard does not cover it.
- **God components.** `CenterView.tsx` (480-line body, eight concerns),
  `HelpDialog.tsx` (536-line body, six concerns, seven `useState` and five
  `useEffect`), `FlightPathExport.tsx`'s dialog (575 lines with two hydrate and
  persist field lists that must stay in lockstep). Each entry in the agent
  reports names the hooks to extract.
- **Duplicated helpers** - FIXED 2026-10-03. Two exported `Stat` components, in
  `components/common/Stat.tsx` and `components/sim/MotorDetail.tsx`, with
  different markup and type scale, each imported by two files in the same area,
  so `import { Stat }` means different things. Two exported `withUnit`, in
  `i18n/format.ts` and `components/sim/motorFormat.ts`, where only the i18n one
  closes degrees up, and sibling files disagree about which they get. One
  `numOf` in `rktExport.ts` byte-identical to `nodeProps.numOpt`. Launch site
  bounds spelled out in three places while a comment claims they are named once.

  The two `Stat`s were not one component written twice: the motor one is a
  `<dt>`/`<dd>` pair that must sit in a `<dl>`, the common one a free-standing
  tile. Merging them would break the definition list, so the motor one is now
  `SpecItem` and says what it requires. The motor `withUnit` is now
  `withFixedUnit`, and it and `inUserUnit` both join number and symbol through
  the i18n `withUnit`, so one function owns the spacing rule. `numOf` is gone and
  `rktExport` imports `numOpt`. The bounds are `LAUNCH_SITE_LIMITS` in
  `launchLocationStore.ts`, read by the store's validator, `LocationEditor` and
  the three `LaunchPanel` site fields.
- **`TreeSchematic`'s `vertical` mode is unreachable** - FIXED 2026-10-03, by
  deleting it. The only call site never passes it; the phone quarter-turn is done
  in CSS. About 12 live branches plus a `textUp` callback spread at eight call
  sites that now always returns `{}`. This also masks what would be a real
  accessibility bug if revived: `role="img"` on an SVG whose shapes still carry
  `onClick`. The prop, `textUp`, the vertical branches in `schematicGeometry` and
  `schematicShapes`, and the `schematic.sideAriaVertical` key in all ten locales
  are gone.

### Tooling, low

Nine items. **Eight are fixed**; only 5, the i18n triangle, is open by decision.
Two of the eight turned out to rest on a claim that was wrong, and one of them
under-counted its own scope, which is recorded rather than quietly dropped.

1. **knip's `entry` named neither `index.html` nor `src/main.tsx`** - FIXED
   2026-10-02, and **the stated cause of the `--production` collapse was wrong**.
   `index.html` is the entry now, so the app graph is declared rather than resolved
   by plugin auto-detection. But `--production` still reports the same ten
   false-positive unused dependencies (`three`, `zustand`, `i18next`, the PDF writer,
   `mustache`, `fflate`, both `@react-three/*`, `react-i18next`,
   `i18next-browser-languagedetector`), and it does so with the entry declared, with
   `src/main.tsx` named explicitly, and with both marked production via knip's `!`
   suffix. All three were tried. `react` and `react-dom` are never flagged, and the
   ten that are are all imported from modules one level deeper than `main.tsx`, so
   production mode is not walking the graph it walks in the default run. That is a
   knip behavior, not a configuration gap, and no gate invokes `--production`.

2. **`scripts/**` was all `entry`, so an orphan script was invisible** - FIXED
   2026-10-02 with `tests/scriptsReferenced.test.ts`. knip cannot answer this: each
   script IS an entry, correctly, and an entry is reachable by definition; narrowing
   the pattern would be a lie, and knip has no way to know `sync-motors.mjs` is
   reached by a line in a workflow. The test asks whether each program is named by
   `package.json`, by a workflow, or by another script, and whether each
   `scripts/lib` module is imported. A planted orphan of each kind is caught.

   It immediately found something: **`openrocketJava.mjs` was sitting among the
   programs while being a library** three of them import, where `scripts/lib`
   already held the other two shared modules. Moved, with its three importers
   updated. 13 programs and 3 modules now, where the count was 14 and 2.

3. **The root config files were outside `project`** - FIXED 2026-10-02, with one
   part out of knip's reach. `*.{ts,js,mjs}` is in `project` and
   `includeEntryExports: true` is on, which was measured before being turned on: it
   costs exactly two findings and both were real, `arg` and `installedJar` in
   `openrocketJava.mjs`, exported while nothing outside the module imports them.
   Both are plain internal functions now. A planted dead export under `scripts` is
   caught, and was not before, so the flag earns its place.

   What it does NOT catch is a dead export in `vite.config.ts` or
   `vitest.config.ts`. Demonstrated both ways: a planted
   `export const plantedConfigDead` goes unreported with the flag on. knip's plugins
   treat those as configuration rather than as source and do not report their
   exports. `tsc`'s `noUnusedLocals` covers an unused LOCAL there; an unused export
   in one of four small config files is what remains, and it is outside what this
   tool can see.

4. **`cspell.json`'s `*.md` was root-anchored** - FIXED 2026-10-02. `website/*.md`
   and `website/*.{ts,js}` added, which brings in `website/README.md`,
   `website/docusaurus.config.ts` and `website/sidebars.ts`: 708 files checked to
   711, all clean. Verified by planting a misspelling in `website/README.md` and
   watching the gate fail on it.

5. **Nothing asserts the src-to-`en.json` direction of the i18n triangle.** OPEN by
   decision. `tests/i18n/keys.test.ts` checks the other direction - every English key
   is reachable from the source - so a DEAD string fails the gate and a mistyped
   `t()` call does not: it renders the raw key, in every locale, with nothing
   failing. Verified clean today across 328 files against 1449 keys, which is why it
   is low rather than a defect, but it is the only item in this section with a
   user-visible failure mode.

6. **Jobs with no `timeout-minutes` inherited the 360-minute default** - FIXED
   2026-10-03, and the item under-counted: **six** jobs across **four** workflows,
   not four jobs in one. `gates.yml` had `validate`, `build-and-test`, `e2e` (per
   shard, three ways) and `reproducible`; `deploy.yml` had `build` and `deploy`; and
   `sync-catalogs.yml` had `sync`, which holds `contents: write` against the `data`
   branch the live app reads and fetches from an upstream API - a hung fetch there
   sat on a write token for six hours.

   **15 minutes, not 10.** 10 was the instinct and the measurements argued it down:
   `validate` is 2-3 min and `reproducible` 3-4, but `build-and-test` is about 8
   (`npm ci` plus `verify:ci`) and each `e2e` shard is 7-8 (two `npm ci`s, the 51 s
   Docusaurus build, a Playwright install, then ~3.6 min of specs). A cap sized just
   over the work is the mistake T9 records, and the thing that eats the margin is
   runner load, which a shared runner has. 15 is still a 96% cut from the default and
   still reports a hang inside a quarter of an hour. `deploy` got 10, being a single
   Pages upload.

   **`dev.yml` needed raising, not adding.** It had 10, written when its comment says
   the list ran "~2 min warm" - before T10 moved that job to `verify:ci`, which made
   it about 6 min plus `npm ci`. So today's own work had left a cap with under a
   third of its budget spare. Now 15, with the comment saying why it moved.

   The two `gates` jobs in `ci.yml` and `deploy.yml` are deliberately uncapped: they
   only call `gates.yml` and run no steps of their own, so their duration is the sum
   of jobs that are each capped.

   `web/tests/ciTriggers.test.ts` now fails if any job that runs steps has no cap, or
   if one is written as a literal 360 - which is documenting the default rather than
   choosing a bound. Both halves verified by planting them.

7. **`vite build` and the coverage floor were unreachable through the documented
   local pre-push list** - FIXED 2026-10-02. Both are in `npm run verify` now, and
   `gates.yml` has lost the separate `vite build` step that made it the only place
   the build ran. `vite build` is placed BEFORE the suite, because it is ~20 s
   against the suite's ~1 min and a broken build should not be reported after
   everything else has passed. `verify` is **99 s** end to end including the build;
   coverage lives in `verify:ci`, which CI runs (see T10).

8. **`sync-motors.mjs` measures its shrink floor against the committed copy** -
   FIXED 2026-10-02, and **this claim was also wrong about CI**. The weekly workflow
   has a "Seed from the published catalogs" step that clones the `data` branch over
   `public/data/motors.generated.json` before the sync runs, precisely so the floor
   measures against what users are being served. The baseline is only the committed
   copy when the script is run BY HAND, where there is no seeding step.

   Both are legitimate baselines and the difference is worth seeing, so the script
   now names the one it used - `comparing 815 against the 815 currently in ...` - and
   says out loud when there is no readable baseline at all, which is the case where
   the shrink floor silently does not run.

9. **`.prettierignore`'s comment claimed all five paths were committed** - FIXED
   2026-10-02. `public/engine` and the `public/data` catalogs are; `public/docs` is
   the built Docusaurus site and is gitignored at `.gitignore:16`. The comment now
   says which is which and where the directory comes from, instead of sending a
   reader after files that are not in the repo.

---

## Tests and accessibility

### Tests

- **The fin recurrence guard is vacuous.** See C2. This is the most important
  test finding in the audit.
- **`shapeProfile.test.ts` has no kernel anchoring** (REPORTED, with Java
  citations) - FIXED 2026-10-03 by `tests/tree/shapeProfile.kernel.test.ts`, and
  **this finding overstated the gap**, which is worth recording because the
  correction came from measuring rather than from reading.

  The claim was that four of the six curves were pinned only by reaching full radius
  at the endpoint and by monotonicity. So each of the six branches was replaced in
  turn with a quarter sine arch - which has exactly those two properties - and the
  old file was run against each. It catches `conical`, `ellipsoid`, `power` and
  `haack`. It is blind to **`parabolic`** alone: one shape, not four. The old file
  has more shape-specific assertions than the finding credited, including an
  ellipsoid check against the virtual nose it was cut from.

  The CIRCULAR-EXPECTATION half of the finding stands and is independent of that
  count: where the old file checks interior points, it computes the expected value by
  calling `shapeRadius`, so a wrong formula produces a wrong expectation and the test
  agrees with itself. The new file transcribes all six formulas from
  `Transition.java` and reimplements them independently, sweeping seven interior
  stations, so a drift between the two says which expression to look at.

  Two things fell out of writing it. `shapeParamDefault('haack')` returns 0 and that
  is CORRECT - `HAACK` does not override `defaultParameter()`, so it inherits the
  base class's `0.0` (Transition.java:1312), and the 1/3 a reader reaches for is
  `maxParameter()`. An assertion was written against 1/3 first and the Java settled
  it. And the ogive is the only one of the six whose profile is not scale-invariant:
  it is a circular arc computed from both length and radius, so its midpoint moves
  from 0.791 R at a length-to-radius ratio of 2 to 0.750 R at 20. That is now a
  property the file asserts, because a reader comparing midpoints across fixtures
  would otherwise think one of them wrong.
- **Three modules cannot be verified at all** (REPORTED) - WILL NOT FIX, by
  decision 2026-10-03. `markingGuide.ts`, `finTabAuto.ts` and `finImage.ts` are
  ports of OpenRocket `swing` classes, and that Java is not committed:
  `engine-java/src/java` carries only `core`. So unlike every other kernel-facing
  module, there is nothing in the repo to diff them against, and `finTabAuto`
  decides the depth of a slot cut through the airframe.

  Vendoring the three files at the pinned ref was the proposed fix and was declined:
  it means carrying `swing` sources for three classes and a fourth drift guard to
  maintain. Recorded as a known unverifiable, not as an open task - if one of these
  three is ever suspected of being wrong, this entry is the reason there is no test
  to consult.
- **`discGeometry.ts` has no test file at all** - FIXED 2026-10-02 by
  `tests/services/design/discGeometry.test.ts` (see step 7). It is the module the DXF
  sheet, the print solids and the 3D internals all share for ring and coupler
  sizing. `tubeRadii`, `plateOuter`, `mountBore`, `nodeContext`, `discDims` and
  `boreAt` are untested; so are `scaleNode` and `stationRadius`.
- **A golden test asserts a flag that has no reader** - FIXED 2026-10-03 with
  the dead-code pass. `reportPdf.golden.test.ts` passes `include: false` as if it
  suppressed a stage. The flag is deleted and the test no longer passes it.
- **`stackedBands`' only test never feeds it a non-finite sample**, while its
  sibling `chartDomain` is tested for NaN in the same file. FIXED 2026-10-03 by
  `tests/components/canvas/stackedBandGaps.test.ts`.

### Accessibility

- `useFocusTrap.ts`'s `FOCUSABLE` list omits `iframe`, and `HelpDialog`'s entire
  content is an iframe and the last element in the panel. So a keyboard-only or
  screen-reader user can reach every control of the Help dialog and never the
  help text it exists to show.
- `SettingsDialog.tsx` and `DesignLibraryDialog.tsx` declare `role="tablist"`
  and `role="tab"` with `aria-selected`, but there is no `role="tabpanel"` and
  no `aria-controls` anywhere in the slice, and no arrow-key handling, so the
  eight Settings tabs are eight separate tab stops. A half-applied pattern is
  worse than plain buttons, which do not promise a panel.
- `ImageExportMenu.tsx` puts `role="menu"` on a container whose children include
  a bare `<span>` and a label-wrapped checkbox, so the six width buttons
  announce as "HD, 4K, 8K, HD, 4K, 8K" with nothing saying which three are PNG.
  The comment directly above flags this exact hazard class and then reintroduces
  it.
- `SiteMap.tsx`'s map host is a `role="group"` div driven entirely by pointer
  and wheel events, with no `tabIndex` and no `onKeyDown`. Picking a launch site
  from the map, the component's stated reason for existing, has no keyboard
  path.
- Glyph-only buttons with `title` but no `aria-label`: `PropertyPanel.tsx`'s
  move up and move down, two color resets in `AppearanceSection.tsx` and
  `SettingsDialog.tsx`, and `FlightPath3D.tsx`'s reset and loop. 19 of 23
  glyph-only buttons in the slice do carry one, so this is drift.
- Two places wrap a color input and a reset button in one `<label>`, which
  `DimensionFields.tsx` fixed and documented: "A row, not one big `<label>`. The
  switch below is a SECOND control, and a label may only bind to one."
- `MotorGrid.tsx` and `MotorComparePane.tsx` are the only tables in the slice
  without `scope="col"`, and the former is the one that runs to a thousand rows.
- `CatalogLoading.tsx`'s `CatalogError` has no `role="alert"`, and it renders
  into an already-present cell, so a failed catalog download is silent.
- `WindProfileDialog.tsx` has an svg with both `role="img"` and
  `aria-hidden="true"`, which contradict.

**Verified clean, do not re-report.** Every one of the 23 dialog files routes
through `common/Dialog.tsx` or `common/AlertDialog.tsx`, both of which call
`useFocusTrap` on the panel and restore focus to the opener; Escape goes to the
topmost surface only via a document-order stack. `ComponentTree` is a correct
`role="tree"` with roving tabindex and full arrow-key handling. The caliper
handles and both chart crosshairs are keyboard-operable with live readouts. The
aero heat cells always carry the number as a non-color cue and legend their
ramp. Every toggle sets `aria-pressed`. three.js disposal is handled at every
site the agents could find, with the render-target path disposing in a `finally`
even on throw.

---

## Dead code

**FIXED 2026-10-03.** Twelve of the thirteen exports below are deleted, along with
`StageOption.include`, `importOrk`'s `configId` parameter and `TreeSchematic`'s
`vertical` mode. `specToTree` had eight test callers building fixtures, so it moved
to `tests/testing/specTree.ts` rather than being deleted. `resetHelpIndex` stays:
it clears a module-level cache so each test starts clean, which makes it a test
seam like `__setEngineForTests`, not dead code. Those two are the whole baseline
in `tests/srcExportReach.test.ts`, the T7 gate, so a new test-only export fails
the suite. Deleting `specToTree` from `engine/api.ts` also left its `RocketSpec`
re-export unused, which knip caught and which is gone.

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

`openRocketEngine.__setEngineForTests` is a **test-only export (intentional)**
and is named as such. A further 96 src exports are referenced from their own
file plus tests, which is the same intentional pattern and is not dead.

Other dead weight:

- `ExportDialog.tsx` and `services/report/options.ts`: `StageOption.include` is
  threaded from the dialog into `ReportOptions` and has no reader.
  `reportPdf.ts` reads only `parts` and `finTemplates`. It has no control
  either, and `allOn` ignores it, so it cannot round-trip. The golden test
  passes `include: false` as if it suppressed a stage.
- `orkImport.importOrk`'s `opts.configId` parameter and the `requested` branch
  it feeds are unreachable: the only production caller passes no second
  argument. The re-import it implies would also mint fresh node ids while
  `loadedMeta.exportMotors` still keys the old ones.
- `TreeSchematic`'s `vertical` mode, covered under architecture above.

**Verified clean.** No default-export drift, only `App.tsx` and `i18n/index.ts`,
both sanctioned. No re-export barrels. File naming is consistent. All six
authored CSS classes are referenced. No dead or missing i18n keys across 1449
keys and 10 locales. Every declared dependency resolves to a real import or a
package binary. `import './kernelLogSink.js'` is a side-effect import and knip
correctly does not flag it.

---

## Recommended order of attack

Front-loaded with small verified fixes; large refactors last.

**1. Make the guard real before touching anything it guards.** Fix C2's scan
root and pattern, watch it fail on C1, then fix C1 and the unclamped schematic
tab. Doing this first means the fin fixes land behind a gate that actually
holds. One test file, two edits.

**2. One-line fixes that close a wrong-number path.** C3 and every security
finding (S1 to S5) are **done**, each with tests. Remaining: C8 (two `max`
props), C9 (two `min` props), C7 (one null return). All three are
single-expression changes with a verified failure scenario. The one thing S2 left
open, `rktImport.readParts` having the element-count gap the `.ork` reader had
closed, is FIXED 2026-10-03: `RktContext` carries the same running `nodeCount`
against `MAX_COMPONENTS`, counted at the same two points (every part entering the
tree, and every stage), with the `.ork` tests' two cases mirrored in
`rktImport.test.ts`. Note what C3 turned up: the same
wrong expression existed in a second exporter the audit had not flagged, so when
fixing one of these, grep for the expression rather than trusting the file list.

**3. Turn the gates on. DONE.** T1 to T5 are all fixed, T4 including its rename,
and T8's two `ignores` entries landed with the rest of the tooling work. T1
landed first, which is what makes the rest of this list get checked on the
branch it is written on at all.

**4. T6, type-aware lint. DONE**, and the expectation in this step was right about
the 26 JSX handlers and wrong about the count: 13 errors, not 30, and four of the
"JSX attributes" turned out to be object properties that `attributes: false` neither
covers nor should. T7, T9 and T10 went with it, so the whole tooling tier is closed.
The thing worth carrying forward is that two of the five fixes these findings
PRESCRIBED do not work - knip cannot be scoped to ignore test importers, and
`projectService` cannot see a project with three tsconfigs - both demonstrated rather
than reasoned about.

**5. T4, the namespace misspelling. DONE**, and the read-old/write-new shim this
step called for was not written, because it should not have been. The app is
0.1.0 preview; the data under the old prefix is scratch. A migration would have
been real work spent protecting nothing, and the version number was on screen the
whole time this step was being planned.

**6. The whole correctness tier is DONE.** Every HIGH, MED and LOW correctness
finding in this report is fixed: 10 HIGH, 19 MED (two of them closed as
collateral of C1) and 12 LOW. The MED and LOW lists above carry the account of
each.

Worth keeping from doing them in one pass: they were not 31 unrelated bugs. Six
shapes covered nearly all of them, and in four cases the right fix was ONE thing
covering every site rather than a patch per site - a `nonNegTag` for the value
axis of a file read, a `KERNEL_DEFAULTS` read for a default spelled locally, a
`useLatest` for a callback that resolves after the user has moved on, and
`NumberInput` for a box that commits on blank. The two already-closed ones are the
cheapest evidence that the shapes are real: C1 fixed them without being aimed at
them.

**7. Kernel default drift and the untested geometry module. DONE.** The literals
are `KERNEL_DEFAULTS` reads, `tests/services/design/discGeometry.test.ts` exists,
and `tests/tree/kernelDefaultsConsumers.test.ts` holds the three consumers to the
table by measuring the geometry they produce.

**8. Add the missing kernel anchors. DONE as far as it goes.**
`shapeProfile.kernel.test.ts` exists, with interior-point assertions transcribed
from the Java, not from `shapeRadius`. Vendoring the three `swing` sources was
declined, so `markingGuide`, `finTabAuto` and `finImage` stay unverifiable by
decision (see Tests).

**9. Dead code. DONE**, along with the duplicated helpers. See the Dead code
section and the Architecture entries. The guard against it growing back is
`tests/srcExportReach.test.ts`, not a second knip run, because knip counts a test
importer as a use however it is scoped (T7).

**10. Deferred refactors.** The `outdated` derivation, `runSims` and
`openOrkFile` extraction, the rebuild debounce, auto-run as a command, and the
three god components. Each is a real improvement and none is urgent; the
`outdated` derivation has the best ratio, since it deletes more machinery than
it adds and has two shipped misses on its record.

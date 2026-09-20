# Patch ledger — extracted OpenRocket core

Every `PATCH(...)` comment in `src/java/` points here. This is that file.

## How the pieces fit

- **`patches/` is an INPUT, not a record.** Each file here is a complete,
  hand-edited copy of the OpenRocket file at the same relative path.
  `extract/extract.mjs` writes the `patches/` file **instead of** the pristine
  upstream one. Deleting one silently reverts that override on the next
  extraction.
- **`src/java/` is the committed OUTPUT.** Gradle compiles it directly; nothing
  is applied at build time. That is why the repo builds without a checkout of
  OpenRocket.
- **`src/shims/java/`** provides classes we deliberately do *not* extract, and
  **`src/jdkstubs/`** covers a JDK gap (`java.text.Collator`).

Rule of thumb from the README: JDK gap → *jdkstub*; provide a class instead of
OpenRocket's → *shim*; edit OpenRocket's class in place → *patch*.

## Is a patch load-bearing, or a leftover?

The patch **always wins** during extraction — that is the whole mechanism. So a
stale one is not harmless: it sits there doing nothing until someone runs
`extract`, and then it silently swaps its contents into the engine.

One check tells you which you have:

| `src/java/X.java` vs upstream `X.java` | what the patch is |
| --- | --- |
| **differs** | **load-bearing.** The override is in the shipping engine. Deleting the patch reverts it on the next extraction. |
| **identical** | **a leftover.** `src/java` was put back to plain OpenRocket at some point and the patch was never removed. It is not in the engine — but it would be, the moment anyone extracts. Delete it. |

Four leftovers were removed on 2026-09-16 this way (`BarrowmanCalculator`,
`FlightConditions`, `AxialStage`, `AbstractSimulationStepper`) — their readable
diffs remain in `docs/rasaero/diffs/`. `extract --check` now prints both lists
on every run, so the distinction is visible instead of having to be
reconstructed.

## The 16 patches

| File (under `info/openrocket/core/`) | Why |
| --- | --- |
| `aerodynamics/barrowman/FinSetCalc.java` | RASAero #4 (fin airfoil), #3 (Rogers Kbf), #1 Phase 1. |
| `aerodynamics/barrowman/SymmetricComponentCalc.java` | RASAero #1 Phase 1 — opt-in supersonic nose/body aero. |
| `rocketcomponent/FinSet.java` | TWO reasons. (1) `java.awt.geom.Point2D` → `core.util.Geo2D` (no AWT under TeaVM). (2) RASAero #4: a 62-line airfoil-section API at `FinSet.java:282-348` (`airfoilSection`, `airfoilLeDiamond`, `airfoilTeDiamond`, `finLeRadius`) that `FinSetCalc.java:136-139` reads in its constructor. Re-extracting this file verbatim plus the `Geo2D` line BREAKS THE FINSETCALC COMPILE - the same failure shape the 2026-09-16 reconciliation hit with `setStubbyNoseFloor`. See `docs/rasaero/diffs/`. |
| `rocketcomponent/FreeformFinSet.java` | `java.awt.geom` (`Line2D`/`Point2D`) → `core.util.Geo2D`. |
| `rocketcomponent/ComponentAssembly.java` | `Collections.emptyList()` → `new ArrayList<>()`. |
| `rocketcomponent/FlightConfiguration.java` | `ConcurrentLinkedQueue` → `LinkedList` (TeaVM classlib gap). |
| `rocketcomponent/FlightConfigurationId.java` | `java.util.UUID` → `core.util.LongUUID` (TeaVM's UUID has no `(long, long)` constructor, `getMostSignificantBits` or `compareTo`). |
| `rocketcomponent/InstanceMap.java` | `ConcurrentHashMap` → `LinkedHashMap`; also makes iteration order stable. |
| `motor/MotorConfigurationId.java` | Same `LongUUID` swap, same TeaVM gap. |
| `simulation/BasicEventSimulationEngine.java` | `"%g"` → `"%s"` — TeaVM's `Formatter` lacks `%g`. Plus `PATCH(drogue-low-speed)`: upstream's own drogue-low-speed check, uncommented (see below). |
| `util/BoundingBox.java` | Dropped `java.awt.geom.Rectangle2D`. |
| `aerodynamics/BarrowmanDragCalculator.java` | `Reflection.construct` → an `instanceof` chain (no reflection under TeaVM); `buildCalcMap` widened to `protected`; `effectiveBaseCD`/`turbulentCompressibility` seams for the RASAero shims. |
| `aerodynamics/BarrowmanStabilityCalculator.java` | Same reflection replacement and `protected` widening, for the stability half. |
| `simulation/SimulationOptions.java` | Dropped the `java.nio.file` lookup-table subsystem — absent from TeaVM's classlib. |
| `unit/Unit.java` | Dropped `Locale.Category` — absent from TeaVM's classlib. |
| `util/ArrayList.java` | `clone()` rewritten for WASM-GC (the `ClassCastException` documented at `build.gradle:81-82`). |

Both `LongUUID` files now carry a `PATCH(teavm-uuid)` marker, so the reason no
longer has to be reverse-engineered from a diff. Every patch in the table now
says why it exists.

## Shims that pair with patches

`RASAeroDragCalculator` / `RASAeroStabilityCalculator` (in `src/shims/java/`)
subclass the Barrowman drag/stability calculators and carry the opt-in
supersonic model. `api.OpenRocketEngine.rasAeroCalculator()` wires them via
`new BarrowmanCalculator(stab, drag)`; with every flag off the result is
bit-identical to a stock `new BarrowmanCalculator()`. `Geo2D` is the awt-free
2D helper the `FinSet` / `FreeformFinSet` / `BoundingBox` patches use.

---

## Reproducibility — reconciled 2026-09-16

`extract --check` passes: **`src/java` is exactly `upstream(+patches)`**, and a
full `extract --src …` run rewrites all 271 files and changes nothing. CI holds
it there (`.github/workflows/gates.yml`, job `reproducible`) against the pinned
upstream in `extract/UPSTREAM`.

It did not pass before, and could not have: **`--check`'s exit code ignored
drift and stale entirely** (`process.exit(missing.length ? 1 : 0)`). It returned
1 only because of one bogus manifest entry, `util/QuaternionMultiply.java`,
which exists in neither upstream nor `src/java` — so deleting that line, the
obvious tidy-up, would have turned the check green over 16 drifted and 13
unmanaged files. Underneath it, a regeneration produced a tree that **did not
compile**: `patches/SymmetricComponentCalc.java` had no `setStubbyNoseFloor`,
which `RASAeroDragCalculator.java:86` and `OpenRocketEngine.java:492` both call.

What was reconciled, all by rebuilding `patches/` and the manifest from today's
`src/java` — **`src/java` itself was not touched**, so the compiled engine is
byte-for-byte what it was:

- **4 superseded patches deleted.** `BarrowmanCalculator`, `FlightConditions`,
  `AxialStage`, `AbstractSimulationStepper` were byte-identical to upstream in
  `src/java`: the override had already been retired in favour of the RASAero
  shims and upstream's own `MotorConfiguration.nozzleExitDiameter`. Keeping the
  patch file meant a re-extraction would have reintroduced the superseded
  design.
- **8 stale patches refreshed** to match `src/java`: `SymmetricComponentCalc`,
  `ComponentAssembly`, `FinSet`, `FlightConfiguration`, `FreeformFinSet`,
  `InstanceMap`, `BasicEventSimulationEngine`, `BoundingBox`. Each was a
  snapshot of an *older* upstream, so it both reverted the current file and
  dropped whatever upstream had fixed since.
- **6 hand edits given patch files** — they had `PATCH(astrarrocketjs)` markers
  in `src/java` and nothing in `patches/`, so a regeneration would have silently
  reverted them: `BarrowmanDragCalculator`, `BarrowmanStabilityCalculator`,
  `SimulationOptions`, `Unit`, `ArrayList`, and `MassComponent` (that last one
  carried no marker at all — an unannotated semantic change where upstream's
  `isCompatible` returns `true`/`InternalComponent` and ours returns
  `false`/no-children; **it needs a decision**, see below).
- **13 files added to the manifest** and the bogus entry removed. They were
  compiled all along but invisible to the extractor, which could neither refresh
  them from upstream nor notice them drifting.

### The extractor now fails on what it used to only print

- Drift, stale and unpatched files all count toward a non-zero exit, not just
  `missing`.
- A `src/java` file carrying a `PATCH(` marker with **no** `patches/`
  counterpart is an error: that is the shape that nearly cost three TeaVM-compat
  fixes the build cannot run without (`java.nio.file` and `Locale.Category` are
  absent from TeaVM's classlib; the `ArrayList.clone()` rewrite is the WASM-GC
  `ClassCastException` at `build.gradle:81-82`).
- A **new third report** — "patch(es) differ from current upstream" — closes the
  structural blind spot. For a patched file, `--check` compares `src/java`
  against *the patch*, so it can never see upstream moving underneath. It never
  could, which is how this went unnoticed.

  The per-patch numbers live in **`extract/DIVERGENCE.txt`**, which is generated
  and gated: `extract --check` recomputes every one and fails on any that moved
  without being blessed. Read them there rather than from this file. A table of
  them used to be maintained by hand here and was stale within days, which is
  precisely why the numbers are now a gate instead of prose (see the 2026-09-19
  entry below).

  **Divergence figures written in this file BEFORE 2026-09-19 are not
  comparable to `DIVERGENCE.txt`.** They came from the old counter, which was a
  line-multiset containment count rather than a diff, so it undercounted every
  file and scored some changes at zero (that is the G2 defect). `SimulationOptions`
  reading "~108 lines" below against 155 in the baseline is the counting method
  changing, not the file drifting. Treat the older numbers as history, not as
  measurements to reconcile.

### Still open — not reproducibility, but parity

**`FinSetCalc` — adopted 2026-09-16 (upstream `e6d54d8c9`).** Upstream replaced
its own scalar fin-body interference approximation with the complete NACA Report
1307 model. The approximation's own TODO had asked for exactly that, and we had
deleted that TODO to put a partial version (`kWB1307`) in its place — so both
sides had changed the same few lines.

Resolved by the standing rule, **OpenRocket wins**: upstream's model owns the
default branch; our `supersonicAero` path is opt-in and untouched beside it.
`NACA1307FinBodyInterference.java` is extracted verbatim (it imports only
`MathUtil`). Upstream's wing-incidence roll factor replaces the flat `(1 + tau)`,
and the Rogers `Kbf` carryover is now suppressed while the NACA model is active
as well as under `supersonicAero` — the new default path already carries the
body load, so adding `Kbf` on top would double-count.

Measured before and after, rebuilding both targets each time:

| `validation/score.mjs` | before | after |
| --- | --- | --- |
| classic (flags off — what everyone runs) | 8/135 | **9/135** |
| `--supersonic` (opt-in RASAero) | 61/135 | 61/135 |

The default path moved one gate point closer to the published wind-tunnel
anchors and the RASAero path did not move. Note the committed scorecards
(2026-08-04) record 7/135 and 64/135; both are stale — the 8/61 above is a fresh
measurement of the pre-merge tree.

**`MassComponent.isCompatible` needs a decision.** Ours diverges from upstream
with no `PATCH` comment and no recorded reason. It now has a patch file, so it
survives a regeneration — but somebody has to say whether the divergence is
deliberate.

**Both closed 2026-09-16.**

*Binary provenance.* `gates.yml`'s parity job now rebuilds over the committed
artifacts and runs `git diff --exit-code` on them. TeaVM's output here is
byte-deterministic (verified by building each target twice), so an unchanged
source rewrites identical bytes and the diff stays empty. It catches **both**
directions: Java edited without running `build-engine.mjs`, and a hand-edited
vendor file — the second verified by appending a line to the `.mjs` and watching
the rebuild put it back. If it ever proves flaky across OS/JDK rather than
catching real staleness, the fallback is a source+artifact SHA-256 stamp, which
is cheaper but cannot catch a hand-edited binary.

*Physics gate.* `test/parity/golden.txt` holds the 255-line JVM reference output,
compared on every run with the same tolerances as the cross-platform check (so a
golden recorded on one OS does not trip on another). Regenerate deliberately with
`node test/parity/parity.mjs --golden`, and say in the commit why the numbers
moved. Demonstrated rather than assumed: scaling fin CNα by 0.97 still printed
`parity ok` — both sides moved together, which is the whole problem — and the
golden check failed on 60+ values. `ParityMain`'s `EXCEPTION:` lines are now a
hard failure too, so a flight that fails identically on both platforms no longer
reports `parity ok`.

## Upstream bumped to `6deae5079` - 2026-09-18

`extract/UPSTREAM` moved from `c1a1a9b9f` (`release-24.12-1908`) to
`6deae50796af9356c6541c9d5e6306ebebe0186f`
(`release-22.02.beta.01-5683-g6deae5079`), and `gates.yml` was repinned to match.
The 3dpath feature branch was deliberately **not** taken: its 12 commits touch 7
`core/src/main/java` files, none of which is in the 272-entry manifest, and the
web app has its own `flightPathExport.ts`.

Six manifest files drifted and were re-extracted verbatim:

| file | what upstream changed |
| --- | --- |
| `masscalc/MassCalculation.java` | A mass override that covers subcomponents now rescales the accumulated inertia to the overridden total instead of leaving the geometric MOI in place. |
| `masscalc/RigidBody.java` | New `scaleMass(factor)`, which the above uses - MOI scales linearly with mass for fixed geometry, keeping `rebase`'s parallel-axis term consistent. |
| `models/wind/PinkNoiseWindModel.java` | New `setAveragePreservingStandardDeviation`; `clone()` now clears listeners and calls `reset()`. |
| `models/wind/MultiLevelPinkNoiseWindModel.java` | Matching `setSpeedPreservingStandardDeviation` on `LevelWindModel`; `loadFrom` re-attaches change listeners. |
| `simulation/AbstractEulerStepper.java` | Fires `firePostAerodynamicCalculation`, so recovery and tumble aerodynamics are listener-adjustable as they already were in RK4/RK6. |
| `simulation/FlightDataBranch.java` | Branches carry the `sourceComponentId` of the component they describe. |

Two **patched** files also moved upstream. Patches are full-file overrides, so
they never pick this up on their own - both changes were ported by hand:

- `simulation/BasicEventSimulationEngine.java` - the initial branch is now
  constructed with `topStage`, feeding the new `sourceComponentId` above.
  Divergence from upstream fell ~8 → ~6 lines.
- `simulation/SimulationOptions.java` - `clone()` resets `listeners` *before*
  cloning the wind models and re-attaches a `fireChangeEvent` relay from each,
  so a cloned options object hears its own wind models instead of silently
  losing the relay. Divergence fell ~112 → ~108 lines.

`extract --check` reports OK, parity is clean on both targets, and
`golden.txt` did not move: the inertia fix changes nothing for the parity
designs, which carry no covering mass override.

*Turbulence note.* Upstream's new `setAveragePreservingStandardDeviation` is the
opposite convention to the one the web UI adopted, where changing the average
holds the turbulence *intensity* (`stdDev/average`) and rescales `stdDev`. The
bridge sets `average` and `standardDeviation` explicitly on every run, so neither
setter is on our path and behavior is unchanged - but if the bridge is ever
simplified to one call, pick the convention deliberately.


---

## `PATCH(drogue-low-speed)` - 2026-09-18

`BasicEventSimulationEngine` ships the `DrogueLowSpeedWarning` block commented
out, so `SimulationConditions.drogueLowSpeedWarning` was a threshold the kernel
carried and nothing read. The patch removes the comment markers and changes
nothing else: the code inside is upstream's, verbatim.

It is the second hunk in that file's patch, alongside the `%g` formatter fix, so
the file's divergence from upstream went ~6 to ~14 lines.

**This is the smaller half of the fix.** `ComponentFactory` never called
`RecoveryDevice.setDrogue`, so `isDrogue()` was false for every device the app
built. `stageHasDrogue` therefore never went true and the kernel took the
single-deployment branch on every flight, which made `mainHighSpeedWarn`,
`mainLowSpeedWarn` and the drogue threshold unreachable whatever the options
blob said, and `RECOVERY_DROGUE_NO_MAIN` unreachable too. Parachute and streamer
nodes now carry a `drogue` key, and the web app round-trips it through
OpenRocket's own `<isdrogue>` element.

Parity is unaffected: adding a warning changes no physics, and both targets stay
clean with `golden.txt` unmoved. `web/src/engine/engineBoundary.test.ts` flies a
real dual-deployment rocket for each branch, since a warning nothing can raise
looks exactly like one that never fires.

Retire this patch if upstream ever enables the block itself.


---

## Resolved - `MassComponent` was never our patch (2026-09-18)

The ledger carried `rocketcomponent/MassComponent.java` as "an unannotated
semantic change ... needs a decision". It is not a decision anyone here made.

Our version returns `allowsChildren() == false` and `isCompatible() == false`,
carrying the comment *"Allow no components to be attached to a MassComponent"*.
That comment is **upstream's own**, and upstream deleted it in
`86d4648a3` (2026-07-05, "Allow mass components to contain internal
components"), which switched the class to `allowsChildren() == true` and
`isCompatible()` accepting any `InternalComponent`.

So this is not an override. It is **older upstream code**, frozen into
`patches/` by the 2026-09-16 reconciliation: that pass snapshotted `src/java`
into a patch file wherever a file differed from upstream, which is exactly the
case a stale carve-out produces. The absence of a `PATCH(...)` marker was the
tell, and it was read as "undocumented" rather than "not ours".

**What it costs.** The kernel throws on any design with a component inside a
mass component, verified against the built engine:

```
buildRocket(masscomponent > bulkhead)
  -> IllegalStateException: Component: [Bulkhead.Bulkhead]
     not currently compatible with component: [MassComponent.MassComponent]
```

Any `.ork` a current desktop OpenRocket saves with, say, a bulkhead inside a
mass component fails to load with that message.

**What it buys.** Nothing. `treeEdit.ts ALLOWED_CHILDREN` has no
`masscomponent` entry, so `allowedChildren('masscomponent')` is `[]` and the
editor never offers a child there whatever the kernel permits.

**Done: the patch was deleted and the tree re-extracted**, restoring upstream's
`allowsChildren() == true` / `isCompatible(InternalComponent)`. The count above
is now 16. `masscomponent > bulkhead` builds and its mass is counted, covered by
`engineBoundary.test.ts`.

The editor followed: `treeEdit.ts ALLOWED_CHILDREN` had no `masscomponent` entry
because nothing could go there, and now mirrors the kernel's own rule (any
`InternalComponent`). A rule tighter than the kernel's is the mistake to avoid
here - the engine builds whatever tree it is handed, so a narrower editor would
just reject `.ork` files the desktop writes happily. `.ork` import and export
needed nothing: both walk `<subcomponents>` generically.

Parity is unaffected (this changes no physics), and `golden.txt` did not move.


---

## Two shims stopped matching upstream - 2026-09-19

Both found by the `engine-java/` audit (`docs/AUDIT_ENGINE.md`, P1 and P2) by
diffing against the pinned upstream rather than against ourselves. Neither is a
patch: both are *shims*, and that is the point. `extract --check` walks `src/java`
against `manifest.txt` and never looks at `src/shims`, so a shim that drifts from
the class it shadows is invisible to every gate we have. These are the first two
found that way.

**`ApplicationPreferences.getAverageWindModel()` returned a dead-calm model.**
Upstream lazily creates the `PinkNoiseWindModel` and then calls
`loadWindModelState()`, seeding 2 m/s average, 0.1 turbulence intensity and
`PI/2` direction. Ours returned a bare `new PinkNoiseWindModel()`: average 0,
standard deviation 0. The consumer is
`MultiLevelPinkNoiseWindModel.addInitialLevel()`, which seeds level 0 from these
preferences, so the browser would fly a calm day where the desktop flies a breezy
one, with nothing in the UI to show for it.

It reached no flight only because `OpenRocketEngine` calls `ml.clearLevels()`
before every run. That is one line away from not being true: add a wind-levels
profile whose lowest level sits above ground, or call `resetLevels()` instead, and
the divergence goes live. Fixed by reproducing `loadWindModelState` in the shim.
The `addChangeListener(this)` half of upstream's method is deliberately not
reproduced - the shim has no change-event plumbing and nothing listens.

**`Geo2D.distance` used `Math.hypot` where `Point2D.distance` uses `sqrt`.**
`java.awt.geom.Point2D.distance`, the method `Geo2D` stands in for, is literally
`Math.sqrt(dx*dx + dy*dy)`. `Math.hypot` is a different function: the JVM's is the
FDLIBM scaled algorithm, TeaVM 0.15.0's is the naive form. Measured over 200k
fin-scale coordinate pairs, they disagree by 1 ULP on about 12% of them.

Note the polarity, because it is the opposite of the usual worry: the *browser*
targets already matched upstream, and the *JVM parity reference* was the side that
did not. The parity harness's ULP tolerance absorbed the difference, so the one
gate that could have seen it was blind by design. Fixed to `sqrt`, which is
correctly rounded under IEEE-754 and therefore identical on every target.

Both sites are latent today: `filletRadius` never reaches the engine
(`ComponentFactory` has no fillet field), so `FinSet`'s fillet path short-circuits
on every flight, and the `FreeformFinSet` site compares against `1.0e-12` where a
1-ULP shift cannot flip the result. The `FinSet` one arms itself the day fillets
are wired through.

**A regression lock was added**, since neither gate could see either defect.
`ParityMain.preferencesScenarios()` prints the shim's default wind, launch,
atmosphere and simulation preferences, so all four are now pinned in `golden.txt`
and a shim default that stops matching the desktop fails the gate. `golden.txt`
grew from 255 to 259 lines; the diff is **four additions and zero changes**, which
is the evidence that the two fixes moved no existing number.

`golden.txt` did not otherwise move, `extract --check` is still OK (neither file
is under `src/java`), parity is clean on both targets, and `web/` is green at
1394 tests. Both vendored artifacts were rebuilt and are byte-stable across
repeated builds.

This does not close the structural hole. Nothing still compares a shim to the
upstream class it shadows; `preferencesScenarios()` pins one shim's values, not
the comparison. See `docs/AUDIT_ENGINE.md` G10.


---

## The extraction gate now interrogates the patches - 2026-09-19

`docs/AUDIT_ENGINE.md` G1 and G2. Both were demonstrated by running the bad edit
through the gate, not argued.

**The hole.** `--check` verifies one invariant, `src/java == upstream + patches`.
The patches are an **input** to that equation, so it can never question them: add
a `patches/` file carrying any content and make `src/java` match it, and the
check is green by construction. Nothing about that is subtle once stated, and it
is exactly the trap this ledger warns about for a different gate, one section up.
The `behind` report was the only thing that could have shown it, and it was a
`console.warn` excluded from the exit code.

**The second hole was worse, because it hid the first.** The `behind` delta was
not a diff, it was a line-multiset containment count, and `if (delta)` dropped
anything scoring 0. A change composed only of deletions, or of reorderings, of
lines whose exact text occurs elsewhere in the file scored 0 and the patch
disappeared from the report entirely. Deleting the `count++;` accumulator from
`MathUtil.average()` scores 0, because the identical line also appears in
`stddev()`. The old gate printed nothing at all about it while `average()`
returned `avg / 0`.

**What changed.**

- The delta is a real LCS diff (common prefix/suffix trimmed, then a rolling-row
  DP), so deletions and reorderings count.
- Every patch is reported unconditionally, including delta 0. A zero means the
  patch is byte-identical to upstream, which is the *leftover* the table above
  says to delete; it is labelled as such in the output.
- `extract/DIVERGENCE.txt` is a new committed baseline of those numbers.
  `--check` recomputes and **fails** on any mismatch, on an unlisted patch, on a
  blessed patch that has vanished, and on the baseline file being absent, so
  deleting it is not a way to switch the check off.
- `npm run extract:bless -- --src <openrocket>` re-records it. Blessing is a
  review action: say why a number moved.

Verified against the four shapes of the attack, each on a scratch copy:

| edit | before | now |
| --- | --- | --- |
| new `patches/MassCalculation.java` + matching `src/java` edit | `OK`, exit 0 | `not blessed -> now 1`, exit 1 |
| delete `count++;` from `MathUtil.average()` (delta-0 case) | `OK`, exit 0, named nowhere | `(1 line(s))` and `not blessed -> now 1`, exit 1 |
| append a hunk to an existing patch (`Unit.java`) | `OK`, exit 0 | `blessed 9 -> now 10`, exit 1 |
| leftover patch byte-identical to upstream | absent from the report | `LEFTOVER: identical to upstream, delete it`, exit 1 |

The real tree passes: `extract --check: OK`, 16 patches blessed, `src/java`
untouched.

*One thing this exposed.* `--bless` initially ran the extraction too, which
rewrote all 272 files from CRLF to LF on this Windows checkout - the extractor
writes upstream's bytes verbatim and `norm()` only normalizes for *comparison*.
No content changed (`git diff --ignore-cr-at-eol` was empty) and it was reverted,
but `--bless` and `--check` are now both explicitly read-only. Only a bare
`extract --src …` writes to `src/java`. The `.gitattributes` `eol=lf` pin is what
keeps this from mattering in the repo; it still matters in a working copy.

*Not closed by this.* The numbers say how far each patch is from upstream, not
whether the difference is justified. That remains a human reading the diff on an
upgrade. What changed is that the number can no longer move without someone
signing for it.


---

## The physics gate is now hard to switch off, and it can see roll - 2026-09-19

`docs/AUDIT_ENGINE.md` G3, G5, G7, G9 and G4. The first four are about the gate
being switchable-off or forgeable; G4 is the one real coverage hole they were
protecting.

**Why this matters more than it sounds.** `parity` proves the *compile*: three
targets agreeing on a wrong coefficient is still three targets agreeing.
`golden.txt` is the only thing in this module that checks the *source*. It was
also the easiest thing here to disable.

- **G3.** A missing `golden.txt` was a `console.warn` and exit 0. `git rm`ing it
  turned the physics gate off with CI still green, and `gates.yml` mentions
  golden nowhere. Now a hard failure.
- **G7.** `--golden` wrote bare values: no header, no hash, no date, no commit,
  and it skipped the comparison, so it never said what it had changed. The file
  now carries `# golden v1 sha256=... lines=... generated=... commit=...`,
  re-verified on **every** run, so hand-editing one value to make a regression
  pass now fails with both digests printed. `--golden` also compares *before* it
  overwrites and prints how many values it is about to move. Comment lines are
  excluded from the data and the digest.
- **G9.** `Math.max(0, 0)` is 0, so an empty reference compared equal to an empty
  target and printed `parity ok: 0 lines`. An empty JVM reference and a zero-line
  comparison are both hard failures now. Only `golden.txt` used to catch this,
  which is the coupling G3 made dangerous.
- **G5.** `score.mjs --strict` passed on an empty anchor set, because
  `gatePass < gateTotal` is `0 < 0`: a truncated `anchors.json` scored
  `0/0 (NaN%)` and exited 0. Zero gated points is now a failure whether or not
  `--strict` was passed, and `NaN%` prints as `n/a`. Added `--min <n>` and
  `--expect-gates <n>` so the harness can go into CI as a ratchet against the
  recorded floor rather than a pass/fail it would currently lose.

**G4: roll aerodynamics had zero coverage in either gate.** No parity design set
a cant angle, so `FinSetCalc` multiplied the roll forcing by `cantAngle == 0` and
every roll quantity was identically zero in all 255 golden lines. The
`aero.forces` field list did not print a roll term in any case, and
`score.mjs` only knows cd/cp/cna. Nothing anywhere could see it.

`ParityMain.rollScenarios()` sweeps cant (0, +0.5, +2, -2 degrees) against Mach
(0.3, 0.8, 1.5) and roll rate (0, 5, 20 rad/s), printing CrollForce, CrollDamp,
Croll, Cside and Cyaw. The roll-rate axis matters: damping is zero without one,
so a forcing-only sweep would still miss half the physics. The recorded values
behave: zero cant gives zero forcing but non-zero damping against an imposed
rate, and negative cant mirrors the forcing sign.

**Demonstrated, not asserted.** Halving the roll forcing at `FinSetCalc.java:325`
is the exact regression that previously produced `parity ok [js]`,
`parity ok [wasm]`, `golden ok` and exit 0. It now fails with
`GOLDEN FAILURE: 27 value(s) of 335 moved`. Note that parity still reports ok for
both targets, correctly: both compiled the halved value faithfully. Golden is
what catches it, which is the whole architecture in one line. The source was
restored and the tree verified clean.

Each of the other four was re-run against its own exploit: deleting `golden.txt`
now exits 1; hand-editing one `roll.forces` value fails the sha256 with both
digests printed; a truncated `anchors.json` exits 1 with and without `--strict`;
`--min 10` against the real 9/135 fails and `--expect-gates 134` against the real
135 fails.

`golden.txt` grew 259 to 335 lines: 76 roll lines plus the 4-line provenance
header. The regeneration reported "overwriting 80 moved value(s) of 335", which
is the new lines and nothing else.

*Still open.* **G6**: nothing in CI runs `npm run validate`. The flags it needs
now exist (`node validation/score.mjs --expect-gates 135 --min 9`, and
`--supersonic --expect-gates 135 --min 61`), and it needs no JDK and runs in
under a second, but wiring it into `gates.yml` is a separate change. **G8**: the
golden tolerances are unchanged, so the measured blind band is unchanged.


---

## The API boundary defends itself now - 2026-09-19

`docs/AUDIT_ENGINE.md` A1, A2, A3, A5, A6, A7 and G6. Everything here is
reachable from an `.ork` file a stranger can send, and every fix below was
re-verified by driving the **shipped** vendored artifact under Node, not by
reading the source.

**Why bounding beats catching.** A4 is the finding that shapes the rest: the JS
target wraps a native JS error into a `java.lang.RuntimeException`, so
`catch (RuntimeException)` swallows a stack overflow there, and WASM-GC has no
equivalent - a wasm trap is not a `WebAssembly.Exception` carrying the
`teavm.javaException` tag, so no Java catch clause ever sees it. The app loads
WASM by default. The recovery the code appears to have does not exist on the
target that actually runs, so the inputs are bounded rather than the exceptions
caught.

**`JsonLite`** was a hand-rolled parser reading untrusted text with no limits:

- `MAX_DEPTH = 64`. `value()`/`object()`/`array()` recursed until the stack
  died, measured at ~3500 levels on JS and ~3000 on WASM-GC, and a Web Worker
  stack is smaller so the sim worker blew first. The only depth cap in the whole
  system was `orkImport.ts`, JS-side, for the XML walk.
- `MAX_INPUT_CHARS = 8 MiB`.
- Non-finite literals rejected. `"length":1e999` parsed to `Infinity`, built a
  rocket, and then `getStaticInfo` returned **every** field as `null` with no
  `error` key, because the writer sanitizes non-finite values and the JS side
  only checks for `error`.
- `NumberFormatException` (null message, which reached the UI as the literal
  string "null") replaced with a message naming the text and offset.
- `\u` escapes validated. `"\u-123"` was accepted by `Integer.parseInt` and
  silently injected `(char) -291` into a component name, which then persisted
  into the next saved `.ork`.
- Duplicate keys rejected instead of last-one-wins.
- `dbl`/`bool`/`str` now throw on a key that is PRESENT but wrong-typed. An
  absent key still takes the default. Silently falling back meant a quoted
  number from a lax exporter (`"length":"0.9"`) built a 0.3 m tube - the default
  - and reported success. A different rocket, no warning.

**`getAeroSweep` could hang the tab.** The point-count guard divided by
`machStep`, so `machMin == machMax` made the numerator zero and ANY step passed;
a step below `ulp(machMin)` then made `m += machStep` a no-op and the list grew
until the heap died. `machMin == machMax` is a real call pattern. The count is
computed as an integer first and the loop is indexed (`machMin + i*machStep`),
which also stops rounding error accumulating across a sweep.

**`ComponentFactory` counts are bounded** by a `count()` helper that rejects
rather than clamps, because silently building a different rocket than the file
describes is this boundary's recurring bug. `MAX_INSTANCE_COUNT = 64` mirrors
`web/src/tree/nodeProps.ts`, where the cap previously lived **only** on the JS
side and only in the property panel and renderers, while `orkImport.ts` wrote
the raw file value straight into the tree. A pod set of 100000 took 4.2 s for a
single `getStaticInfo`, which the app calls per keystroke, and `1e999` reached
`(int) Infinity` = 2147483647 and exhausted the heap.

**`simulateJson`'s handle lookup and options parse** sat ~117 lines above the
`try` whose catch comment claimed to cover them, so a stale handle or a
malformed blob escaped as an opaque throw out of a 2.9 MB bundle. Body moved
into `simulateJsonImpl`, matching what `getStaticInfo` and `getAeroSweep`
already did.

**`appendEvents`** was the one numeric emission skipping `num()`'s non-finite
guard. An `Infinity` ignition delay wrote `"time":Infinity`, which is not JSON,
so `JSON.parse` threw and discarded a whole 1200 s flight.

**G6: `validate` is wired into `gates.yml`** as a ratchet, not a pass/fail - the
honest classic score is 9/135, so a pass/fail gate would just be red. It gates
on `--min` (the score must not drop below the recorded floor) and
`--expect-gates` (the anchor SET must not silently shrink, which is the other
way it fails open). Floors recorded at 9/135 classic and 61/135 supersonic; raise
them when the model improves. No JDK, no build, a few seconds.

Verified against the shipped artifact, 13 of 13: the 1e-300 sweep now returns a
single point instead of looping; 100000 instances and 1e9 shroud lines are
refused by name; 4000-deep nesting is `nesting deeper than 64` rather than a
stack overflow; `1e999` is refused at the parser; duplicate keys, wrong-typed
values and bad `\u` escapes are refused; a stale handle and a malformed options
blob both come back as `{"error":...}` envelopes; and a flight with an Infinity
ignition delay now produces output that `JSON.parse` accepts. Parity clean on
both targets with `golden.txt` unmoved, `extract --check` OK, web green at 1394
tests, typecheck and lint clean.

*One thing worth knowing.* A zero or negative `machStep` still silently falls
back to 0.05. That is long-standing behavior the JS side relies on, so it was
left alone and documented rather than turned into an error; only a non-finite
step is refused.

*Still open on this boundary.* **A8**, handles are untyped and all 14 call sites
blind-cast, and at `optimization = NONE` the checkcast is elided so a wrong
handle reads the wrong object rather than failing cleanly. **A9**, `fairing` is a
declared type that round-trips through our own `.ork` and then cannot be built,
and the `engineTree()` lowering its comment references does not exist - that
needs a product decision, not a patch. **A14**, the four independent default
tables, of which `masscomponent.radius` and `podset.instanceCount` are wrong in
the app today.


---

## The four defaults tables now have one arbiter - 2026-09-19

`docs/AUDIT_ENGINE.md` A14. Four places independently decided what an absent
field means: `api.ComponentFactory` (`dbl(node, "key", D)`), `treeEdit.defaultNode`,
`orkImport`, and the renderers' per-call-site `num(node, 'key', fallback)`.
Nothing derived any of them from the others.

**Measured, not taken from the audit table.** The table listed fourteen
divergent rows and called two of them live. Probing the built engine directly
confirmed all fourteen kernel values but corrected which ones actually bite:
`defaultNode` and `orkImport` write every key explicitly, so the kernel default
is only reached when a key is **absent**. That makes most of the fourteen latent,
and it makes the trigger a `defaultNode` case that forgot a field.

Two were genuinely live, and the audit named only one of them:

- **`masscomponent.radius`.** `defaultNode` omitted it, so the kernel flew
  0.005 m while `schematicShapes.tsx` drew `pRadius * 0.7`, about 9 mm on a 13 mm
  tube. Every mass component the editor has ever created.
- **`railbutton.outerDiameter`.** Not in the audit's live list. `defaultNode`
  has no `railbutton` case at all, so it produced a bare `{ type, id }`: flown at
  RailButton's own 9.7 mm, drawn at 4 mm by both the schematic and the aft view,
  and written back as 9.7 mm by `orkExport`. Less than half-size in the drawing.

Fixed by making the drawings show what flies (both renderer fallbacks now read
the kernel value) and by having `defaultNode` set both fields explicitly instead
of leaving each side to guess.

**`web/src/tree/kernelDefaults.ts`** holds the kernel's values, and
**`kernelDefaults.kernel.test.ts`** locks them to the engine behaviorally: build
the component twice, once with the field absent and once with the table's value,
and require the observable to match. A declarative table that merely claims to
mirror the Java would be the same hand-maintained artifact that caused this.

*The first version of that test was decoration, and it took a deliberate
false value to notice.* It used component length/mass for all fourteen fields
and passed with `masscomponent.radius` set to 0.006, because a mass component's
mass is an override so its radius moves neither length nor mass. Every case now
asserts its own sensitivity first - it perturbs the field and requires the
observable to move - and the two fields that need it use a whole-rocket
observable, where the radius appears in roll inertia and the pod instance count
in total mass. Verified in both directions: 16 pass, and flipping a table value
fails the matching case.

Not attempted: replacing all 224 call sites (98 Java, 126 TypeScript) with reads
from one table. That is churn with real regression risk, and it is not what was
broken - the divergence was invisible, not unavoidable. The test makes it
visible, which is the part that was missing.

`web/` is green at 1410 tests across 122 files, typecheck and lint clean. No
engine source changed, so parity and `golden.txt` are untouched.


---

## Shim drift is detectable, and the Collator stub is no longer a guess - 2026-09-19

`docs/AUDIT_ENGINE.md` G10, G16 and G17.

### G10 - nothing compared a shim to the class it shadows

`extract --check` walks `src/java` against the manifest and never looked at
`src/shims` at all. Five shims provide a fully-qualified name that upstream also
defines (`startup.Application`, `preferences.ApplicationPreferences`,
`database.Databases`, `document.Simulation`, `document.OpenRocketDocument`), and
a gap between shim and real class is invisible to the compiler and wrong at
runtime. The 2026-09-18 upstream bump re-extracted six drifted manifest files and
looked at no shim. This is the structural version of the wind-model bug recorded
two sections up.

A shim cannot be diffed against what it replaces - 162 lines standing in for
2089 is the whole point. What can be checked is whether upstream **moved**.
`extract/SHIMS.txt` records a sha256 of each shadowed upstream file, `--check`
recomputes and fails on any change, and `--bless` re-records after a human has
re-read the class. Same bargain as `DIVERGENCE.txt`: the tool cannot judge the
semantics, only refuse to let them change unobserved. A missing baseline counts
as a failure too.

Demonstrated on a copy of the pinned upstream with
`loadWindModelState`'s default changed from 2.0 to 3.5 - the exact shape of
change that caused the live bug: `1 shadowed shim(s) need review`, exit 1. Before
this, that edit was invisible to every gate in the repo.

### G17 - the stub was missing members the kernel calls

`AlphanumComparator:51-52` calls `setDecomposition(CANONICAL_DECOMPOSITION)`, and
the stub had neither. It compiled only because `jdkstubs` is a separate source
set, so the main compile resolves `java.text.Collator` from the real `java.base`
and javac could never see the gap; only TeaVM linking would have, as a runtime
`NoSuchMethodError`. Added, accepted and ignored, with the reason written down.

### G16 - the stub disagreed with the JDK it stands in for

On the JVM the real `Collator` wins by parent delegation; under TeaVM the stub
runs. So the JVM reference and the browser could sort differently, and no gate
printed a sorted list, so nothing could see it.

Measured rather than assumed. Against `Collator.getInstance(Locale.US)` on
JDK 21 over a corpus of real designations and manufacturers, the old
`compareToIgnoreCase`-plus-tiebreak approximation disagreed on **22 of 1369**
ordered pairs, including genuine reversals: "AeroTech" vs "A-P" gave +1 where
the JDK gives -1. Rewritten in the layers real collation uses - primary
(letters and digits, case-folded, variable punctuation ignored), secondary (the
variable characters, absent before present), tertiary (case, and *lowercase
sorts first*, which is the opposite of a raw `compareTo` and is why the old
tiebreak reversed "K550W" and "k550w"), identical (code points). Now **0 of 1369
at all four strengths**.

Also fixed: `getInstance()` handed back one shared singleton whose `setStrength`
was a no-op. `DesignationComparator` asks for PRIMARY and `AlphanumComparator`
for TERTIARY - on the same object. Each call now returns a new instance that
honors its own strength, as the JDK does.

**The stub is now checked by the harness rather than trusted.**
`ParityMain.collatorScenarios()` prints the full comparison sign matrix at all
four strengths plus an instance-independence probe. This is the one scenario
where a parity mismatch means *the stub is wrong*, not that the compiler is:
the JVM leg runs the real JDK class. It passes, so the stub and the JDK now
agree on every pair in that corpus, on both targets.

`golden.txt` grew 335 to 340 lines.

*One line moved that is not ours.* `flight.para.summary` re-recorded as
`335.3732629410451` against the committed `335.37326183578364`, a ~3e-9 relative
difference. That is the JVM run-to-run instability already noted in
`docs/AUDIT_ENGINE.md` G18, and the new value is exactly what a fresh JVM run on
this machine produces. It is three orders of magnitude inside the 0.5% flight
tolerance so the gate is indifferent either way, but the golden now carries a
machine-specific value on that one line, which is worth knowing before anyone
tightens that tolerance.

`extract --check` OK, parity clean on both targets at 340 lines, validate
ratchet green, `web/` green at 1410 tests, typecheck and lint clean.


---

## The rest of the audit - 2026-09-19

`docs/AUDIT_ENGINE.md` A8, A9, A10, A12, G8, G12, G13, G18 and the whole D
(documentation) set. G14 deliberately left open at the owner's direction.

### Boundary

**A8 - typed handles.** `get(int)` returned `Object` and all 17 call sites
blind-cast it. The wrapper's generation counter catches a handle from a reset
engine but never a handle of the wrong KIND, and because the engine compiles at
`optimization = NONE` TeaVM elides the checkcast: passing a rocket handle to
`addTrapezoidFins` did not throw, it used the wrong object and failed later with
`$this.$checkState is not a function` on JS and a null-message error on WASM-GC.
`get(handle, Class<T>, what)` now says
`Handle 1 is not a component (it is a RocketCtx)` on both targets, at the
boundary. Verified against the shipped artifact.

**A9 - `fairing` builds.** A declared `ComponentType` that `orkImport` creates,
both renderers draw and `orkExport` writes back, and `ComponentFactory` then
rejected: a design round-tripped through our OWN file format and could not be
simulated at all. The `engineTree()` lowering that `openRocketEngine.ts`
promised does not exist anywhere in `web/src`. Now built as a `MassComponent`
carrying mass, length and a radius from the shroud cross-section: verified to
add exactly the declared 0.03 kg.

**This is half a fix and the comment in the code says so.** A fairing is an
external body with frontal area and a `MassComponent` contributes no drag, so a
design with one now flies slightly further than it should. That is strictly
better than not flying at all, but giving it real drag means choosing which
OpenRocket primitive to borrow, and guessing at that is worse than documenting
the gap.

**A10 - the exports that cannot carry an envelope.** `buildRocket`,
`setMotorById`, `setMotorIgnitionById`, the flag setters and `getWorstThetaDeg`
return `void` or a primitive, so there is nowhere to put an error object and
they threw raw out of a 2.9 MB bundle - and the two targets do not agree on the
shape. `callEngine()` in the wrapper gives them one typed `EngineCallError`
naming the operation, passing `StaleDesignError` through untouched.
`setMotorIgnitionById` also rejects a non-finite delay before it can cross.

**A12 - id entropy.** `randomUUID` masked bits 12-15 out of a counter, so the
most-significant half repeated every 2048 calls - and `MotorConfigurationId`
keys on exactly that, so two configurations on one mount could alias. Only the
low bits moved, so every `toShortKey()` was the constant `01234567`, making the
one field meant to tell configurations apart in a log useless. The counter now
goes through a SplitMix64 finalizer: still fully deterministic, which parity
requires. `ParityMain.uuidScenarios()` pins it at `uuid.spread|4096|4096` -
4096 distinct halves and 4096 distinct short keys, against 2048 and 1 before -
and pins the first id exactly, so the JVM and both TeaVM targets must agree bit
for bit.

### Gates and build

**G8 - golden tolerances split from cross-platform ones.** Golden reused 5e-3
(and 5e-2 for turbulent), which is headroom for cross-OS ULP drift that a
same-machine JVM-vs-file comparison does not need. Measured band before: apogee
could move 1.65 m and flight time 0.51 s silently. Golden now scales those by
0.6, still above the worst drift ever observed (1.9e-3). The 1e-4 absolute
escape is scaled too for ordinary flight fields, where it was a 17% free change
in descent acceleration, but NOT for series lengths, where the slack is real.

**G12 - the shipped binary is checked now.** `-Pparity` changes no numerics
setting, so the headline worry did not apply; what it changes is the program,
and `fastGlobalAnalysis` works over the REACHABLE set, so the parity variant is
the one where TeaVM under-linking is least likely to bite while the production
variant was never compared to anything. `build-engine.mjs` asserts the
production JS build exports the whole facade and contains no `ParityMain` (the
two variants share output paths). Verified by adding a bogus expected export
and watching the build refuse.

**G13 - toolchain pinned.** `vendor = JvmVendorSpec.ADOPTIUM` on the Gradle
toolchain and an exact `java-version` in CI, so a silent Temurin bump cannot
fail an unrelated PR with a 2.9 MB unreadable binary diff. The byte-diff step
now prints `java -version` and `git diff --stat` first and, on failure, names
the two causes separately: you edited Java and did not rebuild, versus the
build is not reproducible on this toolchain.

**G18.** Wrapper `retries=3` (one blip on a cold cache used to fail the parity
job outright). The `unpatched` counter matches any `PATCH(`, not just
`PATCH(astrarrocketjs` - it missed 4 of the 28 markers, which `drift` caught
anyway, so this only ever cost a worse diagnostic; README and LEDGER disagreed
about which behavior was intended and the broad one is. The `stale` walk
dropped its `.java` filter, so the invariant is now true of the directory
rather than only of its Java files.

### Documentation

D1-D5 and D15: the counts (16 patches and 256 verbatim, not 15 and 255; 42
`simulation` and 19 `aerodynamics`; a 272-entry manifest, not 280).
`extract/UPSTREAM` no longer points at `.github/workflows/engine.yml`, which
does not exist, and now states plainly that the ref is duplicated in
`gates.yml` with nothing enforcing agreement, and why `describe` reads
`release-22.02.beta.01` for a commit dated 2026-09-17. The `FinSet` ledger row
names BOTH its reasons, including that re-extracting it verbatim breaks the
`FinSetCalc` compile.

D6: `applyStubbyNoseFloor`'s javadoc claimed the gate was
`rogersKbf || supersonicAero`. It is its own third flag, and that flag appeared
in no document anywhere - so anyone auditing "flags off means bit-identical"
checked two flags and never learned of the third. Fixed in the javadoc and
added to `ATTRIBUTION.md`.

D7, the one with real consequences: `ATTRIBUTION.md` named mmrocket-sim as the
author of the extensions but stated **no license**. It now records that the
work is incorporated under GPL-3.0, and lists the two shim files that actually
carry the third-party authorship.

D8: the four patched aerodynamics files carry ~700 and ~400 changed lines and
said nothing about it - `SymmetricComponentCalc` still presented only
`@author Sampo Niskanen`. Each now opens with a GPL-3.0 section 5(a) notice
naming the modification, the year and the attribution. Comments only, so the
vendored artifacts are byte-identical across the change, verified by hashing
before and after.

D10, D12, D13, D14: `docs/rasaero` repointed off the deleted
`BarrowmanCalculator` patch; `OpenRocketDocument`'s javadoc no longer claims a
path the build cannot reach; `Application.getTranslator` now says its bare
`DebugTranslator` is the deliberate kernel-to-app protocol that
`warningText.ts` parses, so nobody "fixes" it into upstream's chain and
silently breaks every warning string; `Geo2D` carries the SHIM marker every
other shim has.

### Note on the process

Adding the D8 notices moved four patch divergence numbers, and
`extract --check` caught it and named all four with exact deltas
(`FinSetCalc blessed 719 -> now 727`) before anything was re-blessed. That is
the G1 gate from earlier today doing its job on a real edit rather than a
constructed one.

`golden.txt` is 342 lines. One line moved that is not ours:
`flight.para.summary` again, the same ~3e-9 JVM run-to-run instability recorded
under G18.

`extract --check` OK, parity clean on both targets, both validate ratchets
green, `web/` green at 1410 tests, typecheck and lint clean, and the 13-case
API exploit suite still passes.

### Also closed in this pass

**G11.** `gates.yml` no longer carries a second copy of the pinned ref: the
`reproducible` job reads `repo` and `ref` out of `extract/UPSTREAM`. The
extraction logic was run locally against the real file and yields
`repo=thzero/openrocket` and the expected SHA.

**G15.** The stale hand-maintained divergence table is **deleted**, not
annotated: the reproducibility section now points at the generated
`extract/DIVERGENCE.txt` and says to read the numbers there. One thing the
deletion surfaced and is recorded alongside it: every divergence figure written
in this file before today came from the OLD counter, which was a line-multiset
count rather than a diff, so it undercounted everything and scored some changes
at zero. `SimulationOptions` reads "~108 lines" in the 2026-09-18 entry against
155 in the baseline - that is the counting method changing, not the file
drifting, and without the note someone would eventually try to reconcile them.

**A11.** The `Simulation` shim still creates its options lazily, because there
is no stepper option to wire through yet - but it now documents the upstream
invariant it breaks (`conditions.setSimulation(this)`), why that is currently
harmless, and that adding a `{"stepper":...}` option without wiring the real
options here would silently keep running RK4.

**A13.** A present-but-not-a-list `"components"` is rejected instead of coerced
to empty; `buildRocket('{"components":"nope"}')` used to return a handle and
report a healthy all-zero rocket. The parser items in that row (`\u` escapes,
duplicate keys, wrong-typed values) were closed with the A5/A6 work.

### `fairing` is RASAero scope, not a core component - 2026-09-19

Recorded because the audit reported it as a user-visible break and that framing
was wrong.

`fairing` is a camera shroud: an external faired pod, added as part of the
RASAero supersonic work with its own `<fairing>` `.ork` extension element
(`2026-08-05b #18`), and never finished. The audit found that a design carrying
one round-trips through our own file format and then cannot be built, which is
true - but it is not a break anyone can hit, because **nothing in the app can
create a fairing**: `ALLOWED_CHILDREN` has no entry so the add menu never
offers it, `defaultNode` has no case, and `componentFields` gives it no
property panel. The renderers draw it and import/export round-trip it, which is
what made it look like a live feature.

The kernel change stands - `ComponentFactory` accepts it as a mass-carrying
component rather than throwing, so an old file loads - and the drag gap stays
open deliberately, since finishing it means first deciding whether camera
shrouds are a feature at all.

Provenance is now marked at every surface that touches it: `ComponentFactory`,
`openRocketEngine.ts` (whose comment also promised an `engineTree()` lowering
that does not exist), `schema.ts`, `orkImport`, `orkExport`, and
`ATTRIBUTION.md`. The finding moved from A9 to **Appendix R5** in
`docs/AUDIT_ENGINE.md`, with the rest of the RASAero work.

### The shipped target is tested now - 2026-09-19

`docs/AUDIT_ENGINE.md` A4, which is the finding that cannot be fixed, only
contained.

**The problem, restated plainly.** The engine compiles twice. TeaVM's JS
backend turns a native JavaScript error caught inside a Java `try` into a
`java.lang.RuntimeException`, so the facade's
`catch (RuntimeException e) { return errorJson(e); }` genuinely catches a stack
overflow and returns an `{"error": ...}` envelope. WASM-GC has no equivalent: a
wasm trap is not a `WebAssembly.Exception` carrying the `teavm.javaException`
tag, so no Java catch clause sees it and it unwinds out of the module. The app
loads WASM-GC by default. **The backend without the net is the one users run.**

There is no Java fix - you cannot catch a trap - so the containment is bounding
the inputs, which the A2/A3/A5/A6 work did.

**What was still wrong: nothing tested it.** Every engine test in `web/` loaded
`vendor/openrocket-engine.mjs`, the JS build - `engineBoundary.test.ts:77`,
`api.test.ts`, and the defaults test added earlier today. Parity covers WASM for
numbers (342 lines, both targets, bit-identical), but no test covered WASM for
BEHAVIOR. The suite was vouching for a build nobody ships.

`web/src/engine/engineBoundary.wasm.test.ts` loads the real
`web/public/engine/openrocket-engine.wasm` through the runtime IIFE exactly as
`tryLoadWasm()` does, and runs the bad inputs against it: depth-capped JSON, a
non-finite literal, an uncapped instance count, an over-large sweep, and the
sub-ulp sweep step that used to loop forever. It also asserts that where the
facade CAN report an envelope, both targets produce the identical message.

**It guards against its own vacuity**, because the defaults test earlier today
shipped in exactly that state and only a deliberately wrong value exposed it.
Two checks assert `wasm` is not the JS module: distinct object identity and
module tag, and independent handle tables (resetting one must not invalidate the
other's handles). Without them, a silent fallback would have compared JS against
itself and passed everything.

The constraint is also written at the top of the facade in `OpenRocketEngine`,
where someone adding an entry point will meet it: the envelope is for reporting
ordinary bad input, not for surviving exhaustion, and anything that can recurse,
loop or allocate on caller-supplied input must be bounded at the boundary.

11 new tests. `web/` is green at 1421 across 123 files; parity, `extract --check`,
typecheck and lint all clean.

### `extract:check` provisions its own upstream - 2026-09-19

Not an audit finding; it came out of trying to hand someone the command.

The check that compares `src/java` to OpenRocket required a hand-made clone
(`--src <path>`), which meant the one gate whose entire job is catching a local
edit before it lands could only realistically be run in CI. That is backwards.

With no `--src` and no `OPENROCKET_SRC`, `extract.mjs` now clones the exact repo
and ref from `extract/UPSTREAM` into `engine-java/.openrocket-src` - gitignored,
sparse to `core/src/main/java`, blobless. Measured cold: 2.4 s and 7.3 MB for
788 files. Warm: 0.44 s, silent.

The cache is keyed to the ref, which is the part that matters. Bumping the pin
re-fetches rather than reusing the old commit, and if the new ref cannot be
fetched the run FAILS with a message naming the repo, the ref and the offline
fallback - verified by pointing `UPSTREAM` at a bogus SHA and watching it refuse
rather than quietly validate against the stale tree.

`--src` and `OPENROCKET_SRC` still take precedence, so CI (which checks out the
ref itself, now read from `UPSTREAM` per G11) is unchanged, and `--refresh`
forces a re-fetch.

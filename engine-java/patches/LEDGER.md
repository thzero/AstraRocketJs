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

## The 17 patches

| File (under `info/openrocket/core/`) | Why |
| --- | --- |
| `aerodynamics/barrowman/FinSetCalc.java` | RASAero #4 (fin airfoil), #3 (Rogers Kbf), #1 Phase 1. |
| `aerodynamics/barrowman/SymmetricComponentCalc.java` | RASAero #1 Phase 1 — opt-in supersonic nose/body aero. |
| `rocketcomponent/FinSet.java` | `java.awt.geom.Point2D` → `core.util.Geo2D` (no AWT under TeaVM). |
| `rocketcomponent/FreeformFinSet.java` | `java.awt.geom` (`Line2D`/`Point2D`) → `core.util.Geo2D`. |
| `rocketcomponent/ComponentAssembly.java` | `Collections.emptyList()` → `new ArrayList<>()`. |
| `rocketcomponent/FlightConfiguration.java` | `ConcurrentLinkedQueue` → `LinkedList` (TeaVM classlib gap). |
| `rocketcomponent/FlightConfigurationId.java` | (no `PATCH` marker in the file — reason must be read from the diff) |
| `rocketcomponent/InstanceMap.java` | `ConcurrentHashMap` → `LinkedHashMap`; also makes iteration order stable. |
| `motor/MotorConfigurationId.java` | (no `PATCH` marker in the file) |
| `simulation/BasicEventSimulationEngine.java` | `"%g"` → `"%s"` — TeaVM's `Formatter` lacks `%g`. |
| `util/BoundingBox.java` | Dropped `java.awt.geom.Rectangle2D`. |
| `aerodynamics/BarrowmanDragCalculator.java` | `Reflection.construct` → an `instanceof` chain (no reflection under TeaVM); `buildCalcMap` widened to `protected`; `effectiveBaseCD`/`turbulentCompressibility` seams for the RASAero shims. |
| `aerodynamics/BarrowmanStabilityCalculator.java` | Same reflection replacement and `protected` widening, for the stability half. |
| `simulation/SimulationOptions.java` | Dropped the `java.nio.file` lookup-table subsystem — absent from TeaVM's classlib. |
| `unit/Unit.java` | Dropped `Locale.Category` — absent from TeaVM's classlib. |
| `util/ArrayList.java` | `clone()` rewritten for WASM-GC (the `ClassCastException` documented at `build.gradle:81-82`). |
| `rocketcomponent/MassComponent.java` | `isCompatible` returns `false`/no children where upstream returns `true`/`InternalComponent`. **No `PATCH` marker and no recorded reason — needs a decision.** |

Three files carry no `PATCH(...)` comment. Worth annotating next time one is
touched, so the reason does not have to be reverse-engineered from a diff.

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
  could, which is how this went unnoticed:

  | patch | ~lines differing from upstream |
  | --- | --- |
  | `barrowman/FinSetCalc.java` | ~586 |
  | `barrowman/SymmetricComponentCalc.java` | ~310 |
  | `simulation/SimulationOptions.java` | ~108 |
  | `BarrowmanDragCalculator.java` | ~61 |
  | `rocketcomponent/FinSet.java` | ~46 |

  Some of that is the override doing its job; some is upstream moving on.

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
`core/src/main/java` files, none of which is in the 280-entry manifest, and the
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

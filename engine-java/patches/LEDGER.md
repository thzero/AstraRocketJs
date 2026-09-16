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
it there (`.github/workflows/engine.yml`, job `reproducible`) against the pinned
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

**`FinSetCalc` is far behind upstream, and that is a physics difference.**
Upstream implements the full NACA Report 1307 fin-body interference model
(`bodyFinInterference`, `rectangularPlanform`, `calculateWingIncidenceFactor`,
blended `finCna`/`bodyCna`/`bodyCp`); ours still uses the older scalar
`calculateBodyFinInterferenceFactor`, and `NACA1307FinBodyInterference.java` is
not extracted at all. **Our CP, CNα, stability margin and roll damping differ
from current OpenRocket for every finned rocket.** Treat that as the known cause
before chasing an aero divergence anywhere else.

**`MassComponent.isCompatible` needs a decision.** Ours diverges from upstream
with no `PATCH` comment and no recorded reason. It now has a patch file, so it
survives a regeneration — but somebody has to say whether the divergence is
deliberate.

**Nothing ties the committed binaries to `src/java`.** `parity.mjs` builds fresh
TeaVM output into `build/generated/teavm/` and compares the two targets; it never
reads `web/src/engine/vendor/openrocket-engine.mjs` or
`web/public/engine/openrocket-engine.wasm`. Edit `src/java`, skip
`build-engine.mjs`, and CI is green while the app runs the old physics.

**Parity is a fidelity gate, not a physics gate.** It compares TeaVM to a JVM run
of the *same source*, with no golden file, so any physics change moves both
sides together and stays green. `ParityMain.java:873` also catches
`SimulationException` and prints it, so a flight that fails identically on both
platforms still reports `parity ok`.

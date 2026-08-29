# Patch ledger

Every file in `patches/` REPLACES the same-relative-path upstream file during extraction
(`extract/extract.mjs`). Patches must be minimal, documented here, and re-audited when upgrading the
upstream OpenRocket version. Diff a patch against upstream with:

```
git diff --no-index <openrocket-src>/<path> patches/<path>
```

**Upstream pin:** OpenRocket `unstable`, build.version `26.xx-SNAPSHOT`, commit `6921e3c74`
(2026-08-27). Migrated from `24.12`. That migration is why several 24.12-era patches were **dropped**
and others **relocated** — see "Migration notes (24.12 → unstable)" at the bottom.

Current patch set: **15 files**. Two RASAero strategy classes
(`src/shims/…/aerodynamics/RASAero{Stability,Drag}Calculator.java`) are new original code, not patches
— documented in the RASAero section below.

---

## TeaVM classlib-gap patches (no behavior change)

### rocketcomponent/FlightConfigurationId.java + motor/MotorConfigurationId.java
- **Why:** TeaVM's `java.util.UUID` is string-backed; it lacks `UUID(long, long)`,
  `getMostSignificantBits()`, and `compareTo` — all used by these two key classes.
- **Change:** `java.util.UUID` → `info.openrocket.core.util.LongUUID` (shim), a faithful
  reimplementation of the UUID surface used (identical toString/hashCode/equals/compareTo).
- **Note:** `LongUUID.randomUUID()` is deterministic (counter-based) — intentional, for reproducible
  differential runs; identical on JVM and TeaVM by construction. Unchanged upstream 24.12→unstable.

### rocketcomponent/FlightConfiguration.java
- **Why:** TeaVM has no `java.util.concurrent.ConcurrentLinkedQueue`.
- **Change:** `ConcurrentLinkedQueue` → `java.util.LinkedList` (import + instantiation). Same FIFO
  order; the engine is single-threaded in the browser and harness.

### rocketcomponent/ComponentAssembly.java
- **Why:** `getComponentBounds()` returned `Collections.emptyList()`, and
  `Transformation.transform(Collection)` calls `clear()`/`addAll()` on it. On the JDK `clear()` on an
  empty immutable list is a silent no-op; TeaVM's immutable-list template throws
  `UnsupportedOperationException` unconditionally.
- **Change:** return `new java.util.ArrayList<>()` (empty, mutable). Behavior-identical.
- **Upstreamable:** arguably an upstream latent bug.

### util/ArrayList.java
- **Why:** OpenRocket's `util.ArrayList extends java.util.ArrayList` overrides `clone()` as
  `(ArrayList<E>) super.clone()`. TeaVM's `java.util.ArrayList.clone()` does not preserve the runtime
  subclass, so the cast throws `ClassCastException` under the **WASM-GC** backend's strict typing (and
  under the JS backend with `strict = true`). It is the one cast that blocked the whole engine from
  running as WASM-GC.
- **Change:** `clone()` → `new ArrayList<>(this)` — a shallow element copy into the correct subclass,
  behavior-equivalent and cast-free.
- **Result:** the full parity battery runs under `generateWasmGC` with 0 failures. Behavior-preserving
  on the JS/JVM build too — JS parity is unchanged-to-better (more lines land bit-identical, none
  regress). **Upstreamable:** yes (an arguably cleaner clone regardless of backend).

### simulation/BasicEventSimulationEngine.java
- **Why:** TeaVM's `java.util.Formatter` does not implement the `%g` conversion; the STAGE_SEPARATION
  handler logged `String.format("==>> @ %g; …")` and threw on every staged flight under JS.
- **Change:** that one log line: `%g` → `%s` with `Double.toString(...)`. Log-only; zero physics.

### unit/Unit.java
- **Why:** upstream added `Locale.getDefault(Locale.Category.FORMAT)`; TeaVM's classlib has no
  `Locale.Category`.
- **Change:** `Locale.getDefault(Locale.Category.FORMAT)` → `Locale.getDefault()` (2 sites). The
  engine runs under a single default locale in the browser, so the two are equivalent. NEW in the
  unstable migration.

### simulation/SimulationOptions.java
- **Why:** upstream added a CSV lookup-table aero-calculator option — fields/methods typed on
  `java.nio.file.Path` and `aerodynamics.lookup.*` (`CsvMachAoALookup`, `MachAoALookup`,
  `LookupTable{Stability,Drag}Calculator`). TeaVM has no `java.nio.file`, and the browser engine only
  ever uses the analytic Barrowman calculator.
- **Change:** removed the lookup fields, getters/setters (`get/set/clear/hasDragLookup` +
  Stability twins, `updateDragLookup`, `normalizePath`), their clone/copyFrom handling, and the
  `Path`/lookup imports; `toSimulationConditions()` now always builds `new BarrowmanCalculator()`.
  NEW in the unstable migration.

### aerodynamics/BarrowmanStabilityCalculator.java + aerodynamics/BarrowmanDragCalculator.java
- **Why:** upstream split the monolithic `BarrowmanCalculator` into these two strategy impls. Each
  builds its own per-component calc map via `Reflection.construct(BARROWMAN_PACKAGE, comp, "Calc", …)`,
  which walks the class hierarchy calling `Class.forName(<SimpleName> + "Calc")`. TeaVM carries no
  reflection metadata → "Suitable constructor … not found" at runtime.
- **Change:** replaced each `buildCalcMap`'s reflective construction with a `protected
  createCalcObject(comp)` **instanceof chain** reproducing the hierarchy-walk resolution exactly
  (FinSet→FinSetCalc, TubeFinSet→TubeFinSetCalc, LaunchLug→LaunchLugCalc, RailButton→RailButtonCalc,
  SymmetricComponent→SymmetricComponentCalc, ComponentAssembly→ComponentAssemblyCalc; TubeCalc is
  abstract). `buildCalcMap`/`createCalcObject` are `protected` so the RASAero subclasses can override
  them. `BarrowmanDragCalculator` additionally gains two `protected` seams — `effectiveBaseCD(mach)`
  and `turbulentCompressibility(mach)` — whose **base implementations are unchanged** (so stock stays
  bit-identical); the RASAero subclass overrides them.
- **Note:** MUST be revisited if upstream adds new `*Calc` classes. These two patches **replace** the
  old single `aerodynamics/BarrowmanCalculator.java` patch, which no longer exists upstream.

## Determinism fix (documented behavior change — within upstream's own envelope)

### rocketcomponent/InstanceMap.java
- **Why:** upstream `InstanceMap extends ConcurrentHashMap<RocketComponent, …>`. `RocketComponent` has
  no `hashCode()` override, so hash-map iteration order follows identity hash codes, which vary per JVM
  process. The Barrowman calculators iterate this map when summing per-component forces every
  simulation step; a run-to-run change in FP summation order produces ULP differences that
  chaos-amplify over a flight, making JVM↔JS (and JVM↔JVM) comparison intermittently impossible.
- **Change:** `extends ConcurrentHashMap` → `extends LinkedHashMap` (import + extends). Iteration
  becomes insertion order — the deterministic configuration tree-walk order — identical on JVM and
  TeaVM. LinkedHashMap is plain classlib, so it also satisfies the TeaVM constraint.
- **Verification:** the JVM parity reference is now byte-identical run-to-run.
- **Upstreamable:** arguably — upstream simulations are ULP-nondeterministic run-to-run because of this.

## java.awt.geom → Geo2D (TeaVM has no java.desktop)

### rocketcomponent/FinSet.java + rocketcomponent/FreeformFinSet.java + util/BoundingBox.java
- **Why:** these used `java.awt.geom` (`Point2D`/`Line2D`/`Rectangle2D`) for pure coordinate math, but
  `java.awt.geom` lives in the `java.desktop` GUI module, which TeaVM's classlib has none of.
- **Change:** replaced with `info.openrocket.core.util.Geo2D` (shim: `distance`/`relativeCCW`/
  `segmentsIntersect`, reproducing `Line2D.linesIntersect` semantics incl. collinear overlaps).
  `FinSet`: `Point2D.Double.distance`→`Geo2D.distance`. `FreeformFinSet`: `intersects()` rewritten on
  `Geo2D` (and its `%g` warn logs rebuilt with string concatenation); the unused public `addPoint`
  overload takes `Coordinate` instead of `Point2D.Double`. `BoundingBox`: dropped the two unused
  `Rectangle2D` methods.
- **Note:** `FinSet` also carries the RASAero feature-#4 airfoil properties (see below).

---

## RASAero supersonic-aero extensions (opt-in; original work — see ATTRIBUTION.md)

**Provenance.** The physics is the original work of the mmrocket-sim project, lifted from
**mmrocket-sim v0.074** (2026-08-27) and re-expressed onto the unstable architecture by a 3-way merge
(`git merge-file`, base = OpenRocket 24.12, ours = unstable, theirs = mmrocket) per file, resolving the
few conflicts by hand. See `../../docs/rasaero/` for the physics writeup.

**Architecture (the "strategy", not a Barrowman patch).** Two new original classes in
`src/shims/…/aerodynamics/` subclass the stock calculators:

- **`RASAeroStabilityCalculator extends BarrowmanStabilityCalculator`** — holds `supersonicAero`
  (#1) + `rogersKbf` (#3); overrides `createCalcObject` to bind those flags onto each `FinSetCalc` and
  `SymmetricComponentCalc`. CP/CNα physics lives in those patched calc classes.
- **`RASAeroDragCalculator extends BarrowmanDragCalculator`** — holds the flags; binds them onto the
  fin/body calcs for drag, and overrides `effectiveBaseCD` (feature #1 high-Mach base-CD cap
  `1.2/M²`) and `turbulentCompressibility` (feature #1 Phase 4 Van-Driest-II friction fade above M3.5).

With both flags off, both are bit-identical to their stock parents. The facade
(`api/OpenRocketEngine.rasAeroCalculator(ctx)`) builds `new BarrowmanCalculator(rasStab, rasDrag)` at
every call site, so displayed CP and the flight sim agree.

### aerodynamics/barrowman/FinSetCalc.java (patch)
Feature #1 (supersonic fin normal force with finite-span tip correction; exact NACA-1307 body-fin
interference split `K_W(B) + fa·K_B(W)`; sharp-airfoil / thickness-wave supersonic pressure drag;
×1.8 fin-body junction increment), feature #3 (Rogers Kbf body carryover `τ·cna` averaged into the fin
CP at the root quarter-chord), and feature #4 (per-shape airfoil thickness-wave drag `sectionPressureCD`
+ LE bluntness). Helpers: `ssaeroScale`, `sweepWaveFactor`, `thicknessWave`, `k1/2/3Analytic`,
`kWB1307`, `calculateAfterbodyFactor`. **Flag off ⇒ the flag-off branch uses unstable's own classic
path** (e.g. body-fin interference falls back to unstable's `calculateBodyFinInterferenceFactor`, not
24.12's `1+τ`).

### aerodynamics/barrowman/SymmetricComponentCalc.java (patch)
Feature #1 for bodies: Mach-dependent nose CNα growth above M1, and supersonic boat-tail/ogive wave
drag (with the hypersonic `Cp_max` fade). Flag off ⇒ stock.

### rocketcomponent/FinSet.java (patch — also the Geo2D patch above)
Feature #4 additive properties: `airfoilSection` (null | hexagonal | naca | doublewedge | biconvex |
hexbluntbase | singlewedge), `airfoilLeDiamond`/`airfoilTeDiamond` (m), `finLeRadius` (m); accessors
fire AERODYNAMIC_CHANGE. Absent inputs ⇒ classic behavior. Bridge: `ComponentFactory` parses the four
inputs on any FinSet.

### Not ported: `partialLaminar` (mmrocket 2026-08-25)
mmrocket replaced a bare `isPerfectFinish()` in the friction calc with
`partialLaminar = (rogersKbf || supersonicAero) && isPerfectFinish()`. That only alters the **flag-off**
path (when a flag is on it equals `isPerfectFinish`, identical to stock) — it was their correction to
make *their* classic model match desktop OpenRocket. Our flag-off must stay bit-identical to the
`unstable` base (which uses `isPerfectFinish`), and our flag-on already matches it, so porting it would
regress flag-off parity for no flag-on gain. Deliberately omitted (documented in `RASAeroDragCalculator`).

---

## Migration notes (24.12 → unstable)

**Dropped patches** (upstream changes made them obsolete; the files are now extracted verbatim):

- `aerodynamics/BarrowmanCalculator.java` — the old 1213-line monolithic patch (reflection-free calc
  map + all RASAero features). Upstream split it into `Stability`/`DragCalculator`; the physics moved
  into the patches + strategy classes above.
- `rocketcomponent/AxialStage.java`, `aerodynamics/FlightConditions.java`,
  `simulation/AbstractSimulationStepper.java` — these carried **RASAero feature #2** (power-on nozzle
  base drag) via a per-stage `nozzleExitDiameter` + a `thrustingStages` set. **Upstream adopted feature
  #2 natively and better**: per-motor `MotorConfiguration.nozzleExitDiameter`, per-wake
  `FlightConditions.thrustingNozzleExitAreas`, consumed in `BarrowmanDragCalculator.calculateBaseCD`.
  So feature #2 is now upstream's, not ours. The browser keeps a **per-stage** `nozzleExitDiameter`
  input; the facade (`OpenRocketEngine`) captures it per stage during `buildRocket` and hands it to
  that stage's motor as `MotorConfiguration.nozzleExitDiameter` in `applyMotor` (clamped to the motor
  diameter — upstream rejects a wider nozzle; the old per-stage model didn't validate). The sim reads
  it via `SimulationStatus`; `getDragSweep` reads it off the mounts (the config's derived motor map is
  not refreshed by `setMotorById`) to build the power-on curve.

**Manifest additions** required by the new upstream (transitive deps): `util/CoordinateIF`,
`util/MutableCoordinate`, the five aero strategy files
(`Barrowman{Stability,Drag}Calculator`, `{Stability,Drag}Calculator`, `StabilityForceBreakdown`),
`models/gravity/{ConstantGravityModel,GravityModelType}`, `simulation/{TumbleDetector,
RK6SimulationStepper,SimulationStepperMethod}`. Removed: `util/QuaternionMultiply` (a dev-only codegen
helper deleted upstream). Excluded: `aerodynamics/lookup/*` + `LookupTable*` (java.nio.file, unused).

**Flight parity** was widened from bit-identical to a physically-negligible tolerance during this
migration — see `../../docs/flight-parity-determinism.md`.

## Rules

1. A patch NEVER changes physics or observable behavior (except the documented determinism fix and the
   documented opt-in FEATURE extensions, which get their own sections here).
2. Prefer shims/strategy subclasses over patches; patch only when the extracted file itself must change.
3. On upstream upgrade: re-diff every patched file against its new upstream version and re-apply the
   minimal change; re-audit whether any dropped/native feature has changed.

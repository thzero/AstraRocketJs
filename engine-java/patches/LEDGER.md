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

## The 15 patches

| File (under `info/openrocket/core/`) | Why |
| --- | --- |
| `aerodynamics/BarrowmanCalculator.java` | RASAero feature #1 Phase 1 (supersonic) and #3 (Rogers Kbf) opt-in flags. **See the drift note below — this one is not in the current build.** |
| `aerodynamics/FlightConditions.java` | Records which stages' motors are thrusting (`isStageThrusting`). **Also not in the current build.** |
| `aerodynamics/barrowman/FinSetCalc.java` | RASAero #4 (fin airfoil), #3 (Rogers Kbf), #1 Phase 1. |
| `aerodynamics/barrowman/SymmetricComponentCalc.java` | RASAero #1 Phase 1 — opt-in supersonic nose/body aero. |
| `rocketcomponent/AxialStage.java` | Per-stage `nozzleExitDiameter` for power-on base drag. **Not in the current build.** |
| `rocketcomponent/FinSet.java` | `java.awt.geom.Point2D` → `core.util.Geo2D` (no AWT under TeaVM). |
| `rocketcomponent/FreeformFinSet.java` | `java.awt.geom` (`Line2D`/`Point2D`) → `core.util.Geo2D`. |
| `rocketcomponent/ComponentAssembly.java` | `Collections.emptyList()` → `new ArrayList<>()`. |
| `rocketcomponent/FlightConfiguration.java` | `ConcurrentLinkedQueue` → `LinkedList` (TeaVM classlib gap). |
| `rocketcomponent/FlightConfigurationId.java` | (no `PATCH` marker in the file — reason must be read from the diff) |
| `rocketcomponent/InstanceMap.java` | `ConcurrentHashMap` → `LinkedHashMap`; also makes iteration order stable. |
| `motor/MotorConfigurationId.java` | (no `PATCH` marker in the file) |
| `simulation/AbstractSimulationStepper.java` | Records thrusting stages for the base-drag patch. **Not in the current build.** |
| `simulation/BasicEventSimulationEngine.java` | `"%g"` → `"%s"` — TeaVM's `Formatter` lacks `%g`. |
| `util/BoundingBox.java` | Dropped `java.awt.geom.Rectangle2D`. |

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

## ⚠ Current drift — `extract --check` is failing

`extract/extract.mjs --check` exists to catch exactly this and **nothing runs
it**. Against `openrocket.unstable` it currently reports three classes of
problem:

```
node extract/extract.mjs --check --src /path/to/openrocket
```

**1 manifest file not found upstream** — `util/QuaternionMultiply.java`. The
manifest names a file this OpenRocket version no longer has.

**13 extracted files not in the manifest.** They are compiled but a
re-extraction would not produce them:
`aerodynamics/{BarrowmanDragCalculator, BarrowmanStabilityCalculator,
DragCalculator, StabilityCalculator, StabilityForceBreakdown}`,
`models/gravity/{ConstantGravityModel, GravityModelType}`,
`simulation/{AbstractRKSimulationStepper, RK6SimulationStepper,
SimulationStepperMethod, TumbleDetector}`, `util/{CoordinateIF,
MutableCoordinate}`.

**16 extracted files differ from `upstream(+patch)`** — `src/java` is not what
extraction would regenerate:
`aerodynamics/{BarrowmanCalculator, FlightConditions,
barrowman/SymmetricComponentCalc}`, `rocketcomponent/{AxialStage,
ComponentAssembly, FinSet, FlightConfiguration, FreeformFinSet, InstanceMap,
MassComponent}`, `simulation/{AbstractSimulationStepper,
BasicEventSimulationEngine, SimulationOptions}`, `unit/Unit`,
`util/{ArrayList, BoundingBox}`.

### What that means for four patches in particular

`BarrowmanCalculator`, `FlightConditions`, `AxialStage` and
`AbstractSimulationStepper` are **byte-identical to upstream in `src/java`** —
the override in `patches/` is not in the shipping engine. Concretely,
`patches/BarrowmanCalculator.java` has 13 references to
`rogersKbf`/`supersonicAero`; the compiled `src/java` copy has none. Their
behaviour reaches the build another way: the RASAero shims for the aero flags,
and upstream's own per-motor `MotorConfiguration.nozzleExitDiameter` +
`FlightConditions.setThrustingNozzleExitAreas` for the base-drag work.

**Do not delete those patch files to "fix" the mismatch.** Decide per file
whether the override is still wanted against the current upstream, then either
retire it from `patches/` **and** the manifest together, or re-apply it. Until
someone does, a re-extraction will reintroduce the superseded design.

### Recommended

1. Run `--check` and reconcile the three lists above.
2. Put `--check` in CI so this cannot drift silently again. It needs a JDK and
   an OpenRocket source tree, so it likely belongs in the same job as the
   JVM↔WASM parity harness (which is also not in CI today).

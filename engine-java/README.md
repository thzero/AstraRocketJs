# engine-java — OpenRocket physics kernel → browser JavaScript

This module turns the **OpenRocket `unstable`** simulation core (`info.openrocket.core`) into a
single JavaScript module the web app runs entirely in the browser. It does that by **extraction**
the physics subset out of OpenRocket, applying a few compatibility overrides, and compiling the
result to JS with **TeaVM**.

> Upstream pin: OpenRocket `unstable`, build.version **`26.xx-SNAPSHOT`**, commit `6921e3c74`
> (2026-08-27). Migrated from `24.12` — that upstream refactored the aero core into a pluggable
> `StabilityCalculator` + `DragCalculator` strategy, so the opt-in RASAero extensions now live in
> `RASAero{Stability,Drag}Calculator` (`src/shims/…/aerodynamics/`) rather than one Barrowman patch.

The committed output is `../web/src/engine/vendor/openrocket-engine.mjs`, so the web app builds
without a JDK. You only touch this module to change the engine itself or to upgrade OpenRocket.

> Licensing & authorship: the engine is GPL-3.0-or-later (derived from OpenRocket). The opt-in
> supersonic-aero extensions in the extracted sources are separate original work — see
> `ATTRIBUTION.md`.

## Layout

```
engine-java/
  build.gradle            TeaVM build (see "Build" below)
  extract/                  extract.mjs + manifest.txt — regenerate src/java/ from OpenRocket
  patches/                15 full-file OVERRIDES of OpenRocket sources + LEDGER.md (why each)
  src/
    java/                 ~259 OpenRocket source files (the physics), already overridden
    shims/java/           our replacements for classes we don't extract (Guice, prefs, LongUUID, Geo2D…)
    jdkstubs/             java.text.Collator stand-in — the one java.* class TeaVM's JDK lacks
    api/java/api/         the @JSExport facade the browser calls (OpenRocketEngine, …)
  test/parity/            ParityMain.java + parity.mjs — JVM↔JS bit-identical check
  validation/             wind-tunnel aero scoring (score.mjs, anchors, fixtures)
```

## How the engine is assembled

OpenRocket's full `core` is ~700 files and pulls in Guice, JAXB, GraalVM-JS, classgraph — none
of which TeaVM can compile. So the engine is built from four kinds of source, in one compile:

### 1. `src/java/` — the OpenRocket physics, extracted to a subset

**Extraction** = copying only the ~270 files the physics + simulation actually need, leaving the
reflection/IO-heavy machinery (file loaders, plugin system, scripting, Swing hooks) behind.
These files are **real OpenRocket source** — ~255 are byte-for-byte upstream; 15 carry overrides
(see `patches/`). By package:

| files | package | what it is |
|------:|---------|------------|
| 73 | `rocketcomponent` | rocket model: nose, body, fins, stages, mounts, flight configs |
| 60 | `util` | math/geometry (Coordinate/CoordinateIF, quaternions, interpolation) |
| 41 | `simulation` | flight simulator: RK4/RK6 integrator, steppers, flight data |
| 18 | `aerodynamics` | Extended Barrowman split into `StabilityCalculator` + `DragCalculator` |
| 16 | `unit` | unit system (internals are pure SI) |
| 12 | `models` | atmosphere (ISA), gravity, wind |
| 10 | `motor` | thrust-curve motor model |
| 4 | `masscalc` | CG / mass / moment-of-inertia |
| … | rest | logging, l10n, materials, presets, appearance, startup |

(The `aerodynamics.lookup` CSV-table calculators — `LookupTable{Stability,Drag}Calculator`,
`CsvMachAoALookup` — are deliberately **not** extracted: they use `java.nio.file`, which TeaVM
lacks, and the browser engine only uses the analytic Barrowman path.)

### 2. `patches/` — full-file overrides of extracted sources

**These are not diffs.** Each file under `patches/` is a *complete, hand-edited copy* of the
OpenRocket file at the same relative path; extract writes it **instead of** the pristine upstream
one. "Applying a patch" is a file-level swap, not a `git apply`. Two flavours (all documented in
`patches/LEDGER.md`):

- **TeaVM-compat** — e.g. `UUID`→`LongUUID`, `ConcurrentHashMap`/`ConcurrentLinkedQueue`→plain
  collections, `String.format("%g")`→`%s`, `Locale.getDefault(Locale.Category.FORMAT)`→`Locale.getDefault()`,
  stripping the `java.nio.file`/CSV lookup-calculator plumbing from `SimulationOptions`, replacing the
  reflective `Class.forName(...)` calc lookup in **`BarrowmanStabilityCalculator`/`BarrowmanDragCalculator`**
  with an explicit `instanceof` chain, and dropping `java.awt.geom` (`FinSet`/`FreeformFinSet`/`BoundingBox`
  use the `Geo2D` shim).
- **Opt-in RASAero supersonic-aero extensions** — default-off feature code. Since upstream split the
  aero core, these are now a **pluggable strategy**: `RASAero{Stability,Drag}Calculator`
  (`src/shims/…/aerodynamics/`) subclass the Barrowman calculators and bind the opt-in flags onto the
  patched `FinSetCalc`/`SymmetricComponentCalc` (and `FinSet` airfoil sections). With the flags off they
  are bit-identical to stock. Feature #2 (nozzle-plume base drag) is **no longer ours** — upstream
  adopted it natively (`MotorConfiguration.nozzleExitDiameter`), so that patch was dropped. See
  `patches/LEDGER.md` and `../docs/rasaero/` for the physics and reviewable diffs vs stock OpenRocket.

To change a patch, edit the whole file under `patches/…` (it *is* the patch). To view what a
patch changed vs upstream: `diff -u <openrocket-src>/…/X.java patches/…/X.java`.

#### What "matches OpenRocket" means here

This engine modifies OpenRocket's source, so "matches OpenRocket" is a claim about **output**, not
about the code being unmodified. Changes fall into two categories, held to different standards:

- **Behavior-preserving** — the TeaVM-compat swaps, the determinism fix, and any future
  performance/caching change. These alter the code but must produce **bit-identical output** to stock
  OpenRocket. That is not assumed; it is *demonstrated* by the parity test (`test/parity/`), which
  requires the modified engine's numbers to match the reference. A cache qualifies only if it is
  invalidated whenever its input can change — otherwise it would return stale values — which is
  exactly what the bit-identical check catches.
- **Behavior-changing** — the opt-in RASAero supersonic-aero extensions. These deliberately change
  the physics, so they are **off by default**: with the flags off the output is bit-identical, and
  only a design that opts in sees different numbers.

The rule (see `patches/LEDGER.md`): modifying the code is fine as long as behavior-preserving changes
are *shown* bit-identical (not merely asserted), and behavior-changing ones are opt-in and documented.
Caching a value that is constant during a flight — e.g. the dry structure mass, which contains no
motors or propellant — changes how often it is computed, not what it computes; such a change is
behavior-preserving when its invalidation is correct and the parity test confirms it.

> **Upstream note.** Some of these are inefficiencies in stock OpenRocket, not artifacts of this
> port — the flight loop recomputes values that are constant for the whole flight (per-component
> locations, dry structure mass), and `BarrowmanStabilityCalculator.checkGeometry()` decides whether
> two body sections share a diameter by formatting both numbers to a display-unit string and
> comparing the strings, every step. We are reporting this upstream: **OpenRocket GitHub issue
> _(link TBD)_**. These are behavior-preserving to fix (caching / avoiding the string round-trip),
> so any local fix here stays bit-identical and is verified by the parity test.

### 3. `src/shims/` — whole classes we provide instead of OpenRocket's

Where an extracted file is impractical, the upstream class is **not extracted at all** and a lean
replacement lives here (it is the only provider of that fully-qualified name). This directory also
holds the two **original** RASAero strategy classes (`RASAero{Stability,Drag}Calculator` — not
replacements of upstream classes but new same-package subclasses, so they can override the Barrowman
calculators' `protected` seams). Twelve files: the Guice replacement (`com.google.inject.Inject`/`Injector`
— an inert annotation + a one-method interface), a Guice-free `Application`, lean
`Simulation`/`OpenRocketDocument`, in-memory `ApplicationPreferences`, `Databases`,
`ShimRocketDescriptor`, `LongUUID`, `RASAeroStabilityCalculator`, `RASAeroDragCalculator`, and
`Geo2D` (a small awt-free 2D-geometry helper — `distance`/`segmentsIntersect`; the patched
`FinSet`/`FreeformFinSet`/`BoundingBox` use it instead of `java.awt.geom`).

### 4. `src/jdkstubs/` — JDK classes TeaVM's class library lacks

Just `java.text.Collator` now — the one `java.*` class the extracted physics needs that TeaVM's
class library lacks (motor-name sorting). Compiled in a separate source set via `--patch-module`
(JPMS forbids `java.*` in the unnamed module, and it can't mix with ordinary sources); on a real
JVM the genuine JDK `Collator` wins, so it affects only the TeaVM build. (The old
`java.awt.geom` stubs are gone — the kernel uses the `Geo2D` shim above.)

**Rule of thumb:** JDK gap → *jdkstub*; provide a class instead of OpenRocket's → *shim*; edit
OpenRocket's class in place → *patch*.

### 5. `src/api/` — the @JSExport facade (the browser's entry point)

`OpenRocketEngine.java` exposes handle-based static methods annotated `@JSExport`
(`newRocket`, `buildRocket`, `addNoseCone`, `getStaticInfo`, `simulateJson`, …). TeaVM compiles
this class as the entry point and turns those methods into the **exported functions of
`openrocket-engine.mjs`**. Params are primitives/arrays; results are JSON strings (the kernel
ships no JSON lib). The web app never calls extracted physics directly — only this facade (through
the typed `../web/src/engine/openRocketEngine.ts` wrapper). `ComponentFactory` builds rockets
from a JSON tree; `JsonLite` is a tiny hand-rolled JSON parser.

## Extraction / upgrading OpenRocket

`extract/extract.mjs` regenerates `src/java/` from an OpenRocket source tree. It is manifest-driven
and idempotent; for each path in `extract/manifest.txt` it writes the `patches/` file if one exists
there, else the verbatim upstream file:

```js
const want = readFileSync(patchSet.has(rel) ? join(patchesRoot, rel) : upstream, 'utf8');
```

```bash
# --src accepts a repo checkout, a plain source tree, or an extracted -sources.jar (auto-detected)
node extract/extract.mjs --check --src /path/to/openrocket   # report drift & missing files; no writes
node extract/extract.mjs --src /path/to/openrocket           # regenerate src/java/
# (or set OPENROCKET_SRC instead of --src)
```

Guardrails: `--check` writes nothing and flags any manifest file missing upstream (version
mismatch) or any extracted file that differs from `upstream(+patch)`; a `patches/` file whose path
isn't in the manifest is a hard error (it would silently never apply).

**At build time nothing is applied** — `src/java/` is committed already in its final state, so
Gradle just compiles it. Extraction is a deliberate step you run only on an OpenRocket upgrade
(then re-audit each `patches/` file against the new upstream per `patches/LEDGER.md`).

## Build

```bash
node build-engine.mjs        # gradlew generateJavaScript + vendor into web/  (one step)

# …or the raw steps it wraps:
./gradlew generateJavaScript
cp build/generated/teavm/js/astrarrocketjs-engine.js ../web/src/engine/vendor/openrocket-engine.mjs
```

Non-obvious, load-bearing settings in `build.gradle`:

- **TeaVM ≥ 0.15 is required** — 0.10's JS backend inverts NaN comparisons.
- **`optimization = NONE` + `fastGlobalAnalysis = true` are required.** TeaVM's default optimizer
  miscompiles this kernel (its devirtualizer inlined the wrong `getInstanceCount()` override, so
  fin instances collapsed 3→1 and masses zeroed; its precise analyzer pruned virtual methods
  reached via map-key dispatch). Do not change without a full re-verification.
- **`moduleType = ES2015`** — a real ES module with named exports (UMD got tree-shaken away).
- **slf4j** is replaced with `org.teavm:teavm-extras-slf4j` (real slf4j's provider discovery
  breaks under TeaVM).
- The parity harness compiles **only under `-Pparity`**, so the shipped engine carries no test
  code (production `mainClass` is the facade; `-Pparity` swaps in `parity.ParityMain`).

## Tests

- **Parity test** — `node test/parity/parity.mjs`. Compiles `ParityMain` to both the JVM and
  TeaVM-JS, runs the same battery of scenarios on each, and requires matching output. This proves
  the browser build matches the reference JVM. Self-contained: it builds the `-Pparity` variant and
  the JVM reference itself. **Static / instantaneous calculations must be bit-identical** (within
  1e-13, i.e. JS `Math` ULP only) — that includes all of the aero (CP, CNα, drag decomposition,
  the RASAero supersonic extensions). Time-integrated *flight* outputs use looser, physically-
  justified tolerances — see **Cross-platform flight determinism** below.
- **Aero validation** — `node validation/score.mjs [--supersonic]`. Scores the drag/CP/CNα sweep
  against published wind-tunnel anchors (ARCAS, Basic Finner, HB-2). Classic Barrowman fails
  above Mach 1 (~5% of gate points, CP frozen); the supersonic model ~45% — that gap is the
  reason the extensions exist.

### Cross-platform flight determinism (why flight parity isn't bit-identical)

> Full diagnostic record: [`../docs/flight-parity-determinism.md`](../docs/flight-parity-determinism.md).

Every *snapshot* calculation — drag at a given Mach, CP, CNα, mass, atmosphere — is **bit-identical**
between the reference JVM and the browser (TeaVM-JS) build, to ~15 significant figures. A full
*flight simulation* is not, and that is expected and acceptable:

- A flight runs thousands of tiny RK4 steps. Each step the integrator picks the next time-step as
  `min(dt[i])` over several limits (`RK4SimulationStepper.step()`). The JVM and JS compute those
  limits identically to ~15 digits, but once in a while that ~15th-digit difference tips *which*
  limit is smallest, so one side takes a very slightly different step. Over thousands of steps the
  tiny timing differences accumulate, and the deliberately under-damped apogee turn amplifies them.
- On the smooth reference flight the two builds end up disagreeing by **~0.2 mm of altitude (of
  330 m) and ~1 ms of time (of 7 s)** by apogee — worst-case ~1.9e-3 relative. Physically nothing.
- It is **not a bug**: the JVM is byte-identical run-to-run (so it isn't nondeterministic hashing),
  every static calc matches to 1e-13, and it is not caused by the RASAero extensions (it predates
  them). OpenRocket's own flight simulation is nondeterministic at this level for the same reason.
- **Turbulent (gusty-wind) flights** diverge more — the two builds follow different but equally
  valid chaotic trajectories, differing by a few percent (and by up to ~17 of ~525 recorded
  samples). Real wind is random, so this is honest.

The parity harness therefore grades in tiers (`test/parity/parity.mjs`): static/instantaneous at
`1e-13` (effectively bit-identical), smooth flight at `5e-3` relative / `1e-4` absolute, and
turbulent-wind flight at `5e-2`. Snapshot physics — the thing a design tool actually reports — stays
exact; only the chaotic tail of a full trajectory is allowed to drift within physically-negligible
bounds. (This flight tolerance was widened from `1e-9` during the OpenRocket *unstable* migration,
whose new per-step aerodynamic-damping term made the trajectory slightly more ULP-sensitive.)

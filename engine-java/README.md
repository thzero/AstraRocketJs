# engine-java — OpenRocket physics kernel → browser WebAssembly + JavaScript

This module turns the **OpenRocket** simulation core (`info.openrocket.core`, a post-24.12 development build) into engine modules the web app runs entirely in the browser. It does that by **extraction** — carving the physics subset out of OpenRocket, applying a few compatibility overrides, and compiling the result with **TeaVM** to **two targets**: a **WebAssembly (WASM-GC)** module and a **JavaScript** module.

The committed outputs let the web app build without a JDK:

- JS → `../web/src/engine/vendor/openrocket-engine.mjs`
- WASM → `../web/public/engine/openrocket-engine.wasm` (+ its `openrocket-engine.wasm-runtime.js` loader)

The app loads WASM-GC by default and falls back to JS; you only touch this module to change the engine itself or to upgrade OpenRocket.

> Licensing & authorship: the engine is GPL-3.0 (derived from OpenRocket). The opt-in supersonic-aero (RASAero) extensions in the extracted sources are separate original work — see `ATTRIBUTION.md`.

## Layout

```
engine-java/
  build.gradle            TeaVM build — JS (teavm.js) + WASM-GC (teavm.wasmGC); see "Build" below
  package.json            no deps, nothing to install — just named `npm run` entry points
  build-engine.mjs        one-step build + vendor into web/  (both targets; --js / --wasm for one)
  extract/                  extract.mjs + manifest.txt — regenerate src/java/ from OpenRocket
  patches/                15 full-file OVERRIDES of OpenRocket sources (why each, in the file header)
  src/
    java/                 ~270 OpenRocket source files (the physics), already overridden
    shims/java/           our replacements for classes we don't extract (Guice, prefs, LongUUID, Geo2D, RASAero…)
    jdkstubs/             java.text.Collator stand-in — the one java.* class TeaVM's JDK lacks
    api/java/api/         the @JSExport facade the browser calls (OpenRocketEngine, …)
  test/parity/            ParityMain.java + parity.mjs (run-target.mjs, stdout-sync.mjs) — JVM↔JS↔WASM bit-identical check
  validation/             wind-tunnel aero scoring (score.mjs, anchors, fixtures)
```

## How the engine is assembled

OpenRocket's full `core` is ~700 files and pulls in Guice, JAXB, GraalVM-JS, classgraph — none of which TeaVM can compile. So the engine is built from four kinds of source, in one compile:

### 1. `src/java/` — the OpenRocket physics, extracted to a subset

**Extraction** = copying only the ~270 files the physics + simulation actually need, leaving the reflection/IO-heavy machinery (file loaders, plugin system, scripting, Swing hooks) behind. These files are **real OpenRocket source** — ~256 are byte-for-byte upstream; 16 carry overrides (see `patches/`). By package:

| files | package | what it is |
|------:|---------|------------|
| 73 | `rocketcomponent` | rocket model: nose, body, fins, stages, mounts, flight configs |
| 60 | `util` | math/geometry (Coordinate, quaternions, interpolation) |
| 42 | `simulation` | flight simulator: RK4/RK6 integrators, steppers, tumble detection, flight data |
| 19 | `aerodynamics` | Extended Barrowman + RASAero CP / drag / stability (force breakdown) |
| 16 | `unit` | unit system (internals are pure SI) |
| 12 | `models` | atmosphere (ISA), gravity models, wind |
| 10 | `motor` | thrust-curve motor model |
| 4 | `masscalc` | CG / mass / moment-of-inertia |
| … | rest | logging, l10n, materials, presets, appearance, startup |

### 2. `patches/` — full-file overrides of extracted sources

**These are not diffs.** Each file under `patches/` is a *complete, hand-edited copy* of the OpenRocket file at the same relative path; extract writes it **instead of** the pristine upstream one. "Applying a patch" is a file-level swap, not a `git apply`. Two flavours:

- **TeaVM-compat** — e.g. `UUID`→`LongUUID`, `ConcurrentHashMap`/`ConcurrentLinkedQueue`→plain collections, `String.format("%g")`→`%s`, replacing `BarrowmanCalculator`'s reflective `Class.forName(...)` calc lookup with an explicit `instanceof` chain, dropping `java.awt.geom` (`FinSet`/`FreeformFinSet`/`BoundingBox` now use the `Geo2D` shim), and a copy-constructor `ArrayList.clone()` (WASM-GC's strict casts reject the JVM's `(ArrayList) super.clone()`).
- **Opt-in RASAero supersonic-aero extensions** — default-off feature code (see `../docs/rasaero/` for the physics and reviewable diffs vs stock OpenRocket).

To change a patch, edit the whole file under `patches/…` (it *is* the patch). To view what a patch changed vs upstream: `diff -u <openrocket-src>/…/X.java patches/…/X.java`.

### 3. `src/shims/` — whole classes we provide instead of OpenRocket's

Where an extracted file is impractical, the upstream class is **not extracted at all** and a lean replacement lives here (it is the only provider of that fully-qualified name). Twelve files: the Guice replacement (`com.google.inject.Inject`/`Injector` — an inert annotation + a one-method interface), a Guice-free `Application`, lean `Simulation`/`OpenRocketDocument`, in-memory `ApplicationPreferences`, `Databases`, `ShimRocketDescriptor`, `LongUUID`, `Geo2D` (a small awt-free 2D-geometry helper — `distance`/`segmentsIntersect`; the patched `FinSet`/`FreeformFinSet`/`BoundingBox` use it instead of `java.awt.geom`), and the two RASAero calculators (`RASAeroDragCalculator`/`RASAeroStabilityCalculator`, subclasses of the Barrowman drag/stability calculators that add the opt-in supersonic model).

### 4. `src/jdkstubs/` — JDK classes TeaVM's class library lacks

Just `java.text.Collator` now — the one `java.*` class the extracted physics needs that TeaVM's class library lacks (motor-name sorting). Compiled in a separate source set via `--patch-module` (JPMS forbids `java.*` in the unnamed module, and it can't mix with ordinary sources); on a real JVM the genuine JDK `Collator` wins, so it affects only the TeaVM build. (The old `java.awt.geom` stubs are gone — the kernel uses the `Geo2D` shim above.)

**Rule of thumb:** JDK gap → *jdkstub*; provide a class instead of OpenRocket's → *shim*; edit OpenRocket's class in place → *patch*.

### 5. `src/api/` — the @JSExport facade (the browser's entry point)

`OpenRocketEngine.java` exposes handle-based static methods annotated `@JSExport` (`newRocket`, `buildRocket`, `addNoseCone`, `getStaticInfo`, `simulateJson`, …). TeaVM compiles this class as the entry point and turns those methods into the **exported functions of the engine modules** (JS and WASM). Params are primitives/arrays; results are JSON strings (the kernel ships no JSON lib). The web app never calls extracted physics directly — only this facade (through the typed `../web/src/engine/openRocketEngine.ts` wrapper). `ComponentFactory` builds rockets from a JSON tree; `JsonLite` is a tiny hand-rolled JSON parser.

#### What the void and primitive exports do on failure

The facade has two failure contracts, decided by the return type:

- **JSON-returning methods** (`getStaticInfo`, `getComponentInfo`, `getComponentMasses`, `getAeroSweep`, `simulate`, `simulateJson`) never throw for a bad input or a failed computation. They return an `{"error": "<message>"}` envelope and the wrapper reads it.
- **Void and primitive-returning methods** cannot carry an envelope (there is nowhere in an `int`, a `double` or a `void` to put a message), so they **throw** instead: `buildRocket`, `newRocket`, `setMotor`, `setMotorById`, `setMotorIgnitionById`, `getWorstThetaDeg`, the flag setters (`setRogersModifiedBarrowman`, `setStubbyNoseDrag`, `setSupersonicAero`) and the `addX` builders (`addNoseCone`, `addBodyTube`, `addTrapezoidFins`, `addInnerTube`, `addParachute`). A rejected input is an `IllegalArgumentException` with a message that names the field (an unknown handle, a non-mount component id, a non-finite ignition delay, a malformed thrust curve); anything else is whatever `RuntimeException` the kernel raised. On both targets the exception crosses into JavaScript as a throw carrying the Java message. Callers must not inspect the return value of these methods for an `error` key; there is none.

The TypeScript wrapper (`../web/src/engine/openRocketEngine.ts`) runs every one of these through `callEngine`, which rethrows the failure as an `EngineCallError` whose `operation` names the facade method and whose message keeps the kernel text. A design used after `resetEngine()` throws `StaleDesignError` ahead of the call, and `callEngine` lets that one through untouched. The wrapper also validates the motor curve and the ignition delay itself before calling in, so the kernel guards are the second line of defense, not the only one.

## Extraction / upgrading OpenRocket

`extract/extract.mjs` regenerates `src/java/` from an OpenRocket source tree. It is manifest-driven and idempotent; for each path in `extract/manifest.txt` it writes the `patches/` file if one exists there, else the verbatim upstream file:

```js
const want = readFileSync(patchSet.has(rel) ? join(patchesRoot, rel) : upstream, 'utf8');
```

```bash
# --src accepts a repo checkout, a plain source tree, or an extracted -sources.jar (auto-detected)
node extract/extract.mjs --check --src /path/to/openrocket   # report drift & missing files; no writes
node extract/extract.mjs --src /path/to/openrocket           # regenerate src/java/
# (or set OPENROCKET_SRC instead of --src)
```

Guardrails — `--check` writes nothing and **exits non-zero** on any of:

- a manifest file missing upstream (version mismatch);
- an extracted file that differs from `upstream(+patch)`;
- an extracted file not in the manifest (it compiles, but a regeneration would not produce it);
- an extracted file carrying a `PATCH(astrarrocketjs)` marker with **no** `patches/` counterpart — a regeneration would silently revert it;
- a patch whose divergence from upstream does not match the blessed baseline in `extract/DIVERGENCE.txt`, or that baseline being absent.

A `patches/` file whose path isn't in the manifest is a hard error (it would silently never apply).

**`extract/DIVERGENCE.txt` is the load-bearing guardrail**, and it is worth being precise about why. The first four bullets all rest on one invariant, `src/java == upstream + patches`. The patches are an **input** to that equation, so the invariant can never question them: edit a `patches/` file and `src/java` together and the check is green by construction, whatever you put there. `DIVERGENCE.txt` records, per patch, how many lines it differs from upstream by (a real LCS diff), and `--check` recomputes those numbers and fails on any difference. Changing a patch therefore means running `--bless` and explaining the new number in review.

Two notes on reading it. A delta of **0** means the patch is byte-identical to upstream: that is the *leftover* `patches/LEDGER.md` describes, and the answer is to delete the patch, not to bless the zero. And every patch is listed unconditionally, including zeros — the old report used a line-multiset count that silently dropped any change made purely of deletions or reorderings, which is how deleting a single `count++;` from `MathUtil.average()` could score 0 and vanish from the report while `average()` divided by zero.

Comparing `src/java` to the patch also can never see upstream moving underneath, which is how `FinSetCalc` came to sit hundreds of lines behind while the check called it clean; the same per-patch numbers are what surface that on an upgrade.

`--check` is only meaningful against the exact upstream the extraction was made from — pinned in `extract/UPSTREAM` and enforced by the `reproducible` job in `.github/workflows/gates.yml`.

**At build time nothing is applied** — `src/java/` is committed already in its final state, so Gradle just compiles it. Extraction is a deliberate step you run only on an OpenRocket upgrade (then re-audit each `patches/` file against the new upstream).

## Build

There is a `package.json` here with no dependencies and nothing to install. It exists only to give
the Node helper scripts named entry points, so `npm run parity` works the way it does in `web/`:

```bash
npm run build          # both targets, vendored into ../web/   (= node build-engine.mjs)
npm run build:js       # JS only
npm run build:wasm     # WASM-GC only
npm run parity         # both targets vs the JVM reference
npm run parity:js      # JS only          npm run parity:wasm   # WASM-GC only
npm run parity:golden  # rewrite golden.txt (deliberate physics changes only)
npm run validate       # aero scorecard   npm run validate:supersonic / :strict
npm run extract:check    # no arguments: fetches the pinned upstream itself
npm run extract:bless    # re-record extract/DIVERGENCE.txt + SHIMS.txt
```

**You do not need to clone OpenRocket by hand.** With no `--src` and no
`OPENROCKET_SRC`, the extractor clones the exact repo and ref from
`extract/UPSTREAM` into `engine-java/.openrocket-src` (gitignored, sparse to
`core/src/main/java`, blobless: about 2 s and 7 MB) and reuses it afterwards -
a warm `extract:check` is under half a second. The cache is keyed to the ref,
so bumping the pin re-fetches instead of silently checking against the old
commit. `--refresh` forces it; `--src <path>` still points at your own checkout,
which is what CI does and what you want offline.

Requiring a hand-made clone is why this gate used to run only in CI, which is
backwards for a check whose job is catching a local edit before it lands.

`--bless` and `--check` both write nothing to `src/java`. Only a bare
`extract --src …` regenerates the tree, and on a CRLF checkout that rewrites all
272 files to LF, so do not run it casually.

Or call them directly, which is identical:

```bash
node build-engine.mjs            # BOTH targets (default), vendored into ../web/
node build-engine.mjs --js       # JS   → ../web/src/engine/vendor/openrocket-engine.mjs
node build-engine.mjs --wasm     # WASM → ../web/public/engine/openrocket-engine.wasm (+ runtime)

# …or the raw Gradle tasks they wrap:
./gradlew generateJavaScript     # JS target (teavm.js)
./gradlew buildWasmGC            # WASM-GC target (teavm.wasmGC)
```

Both targets compile from the same sources and are verified **bit-identical**. Change a Java source → rebuild **both** and commit the Java change and both regenerated artifacts (`.mjs` + `.wasm`) together.

Non-obvious, load-bearing settings in `build.gradle`:

- **TeaVM ≥ 0.15 is required** — 0.10's JS backend inverts NaN comparisons.
- **`optimization = NONE` + `fastGlobalAnalysis = true` are required** (on both `teavm.js` and `teavm.wasmGC`). TeaVM's default optimizer miscompiles this kernel (its devirtualizer inlined the wrong `getInstanceCount()` override, so fin instances collapsed 3→1 and masses zeroed; its precise analyzer pruned virtual methods reached via map-key dispatch). Do not change without a full re-verification.
- **WASM-GC uses strict typing** — the copy-constructor `ArrayList.clone()` patch is required (its strict casts reject `(ArrayList) super.clone()`; the JS `strict=true` mode hits the same).
- **`moduleType = ES2015`** (JS) — a real ES module with named exports (UMD got tree-shaken away).
- **slf4j** is replaced with `org.teavm:teavm-extras-slf4j` (real slf4j's provider discovery breaks under TeaVM).
- The parity harness compiles **only under `-Pparity`**, so the shipped engine carries no test code (production `mainClass` is the facade; `-Pparity` swaps in `parity.ParityMain`).

Every build prints **"Deprecated Gradle features were used in this build, making it incompatible with Gradle 10"**. It is the TeaVM plugin, not this build: `--warning-mode all -Dorg.gradle.deprecation.trace=true` traces it to `TeaVMPlugin.setupSources`, which declares each dependency's `:sources` variant with the multi-string notation Gradle 10 removes. It cannot be switched off here (the sources collection is a task input, so it resolves whatever `sourceFilePolicy` is set to), 0.15.0 is the newest plugin published, and TeaVM's `master` still has the same call, so no fix is merely waiting on a release. Consequence: **do not bump the wrapper to Gradle 10** until TeaVM ships a fix, or the engine stops building.

## Tests

- **Parity test** — `node test/parity/parity.mjs`. Compiles `ParityMain` to the JVM and to BOTH TeaVM targets (JS and WASM-GC), runs the same battery of scenarios on each, and requires **bit-identical** output (sub-1e-9 ULP tolerance for JS `Math`). Both targets are checked by default because both ship, and they share the one JVM reference; `--js` / `--wasm` narrow it to one. This proves the browser build matches the reference JVM. Self-contained: it builds the `-Pparity` variant and the JVM reference itself. It also checks every value against `test/parity/golden.txt`, so a change that moves a NUMBER is caught even when both targets still agree with each other. `npm run parity:golden` rewrites it, and is for deliberate changes only. Note the last column of each `*.info` row is the WARNING COUNT, not a physical quantity: it moves whenever the set of warnings a design raises changes, which is a legitimate golden update rather than drifted physics.
- **Aero validation** — `node validation/score.mjs [--supersonic]`. Scores the drag/CP/CNα sweep against published wind-tunnel anchors (ARCAS, Basic Finner, HB-2). Classic Barrowman degrades above Mach 1 (CP frozen); the opt-in supersonic model closes much of that gap — which is the reason the extensions exist.

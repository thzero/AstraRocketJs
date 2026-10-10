# AUDIT_PROMPT_ENGINE - `engine-java/` audit (AstraRocketJs)

Companion to `docs/AUDIT_PROMPT.md`, which audits `web/` and explicitly puts the kernel out of scope. This one covers the other side of that boundary.

It is a different kind of audit, and the difference is the whole point. Most of `engine-java/` is byte-for-byte OpenRocket that must not be "improved": changing it breaks the extraction's reproducibility gate and forks us from upstream. The auditable surface is where a human hand touched the physics (the patches, the bridge in `src/api`, the shims and the JDK stub), plus the build and the gates. A prompt that does not say this precisely will get back a report full of findings against OpenRocket.

Paste the block below to a capable agent. Run from the repo root (`AstraRocketJs/`); all paths are repo-root-relative.

---

Do a full engineering audit of the **`engine-java/`** module in this repo. It turns the OpenRocket simulation core (`info.openrocket.core`) into two browser engine modules (TeaVM to WASM-GC and to JavaScript) that the `web/` app loads. 
Read `engine-java/README.md` and `engine-java/patches/LEDGER.md` first: they explain the extract/patch/shim/jdkstub mechanism, and the audit is largely a test of whether what they claim is true.

## Scope: what is and is not auditable here

| Path                                                                                             | Size                  | Audit it?                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/java/`                                                                                      | 273 files, ~55k lines | **No, with one exception.** The other 255 files are verbatim upstream. Do not report style, complexity, or design findings against them. The exception: if you find a genuine defect that materially affects THIS app, report it as `UPSTREAM` severity-tagged, with the note that the fix belongs in a patch or upstream, never as an in-place edit to `src/java`. |
| `patches/`                                                                                       | 18 files, 10.4k lines | **Yes. This is the main event.**                                                                                                                                                                                                                                                                                                                           |
| `src/api/`                                                                                       | 5 files, ~3.9k lines  | **Yes.** The `@JSExport` facade the browser calls.                                                                                                                                                                                                                                                                                                         |
| `src/shims/java/`                                                                                | 11 files, ~850 lines  | **Yes.**                                                                                                                                                                                                                                                                                                                                                   |
| `src/jdkstubs/`                                                                                  | 1 file, 187 lines     | **Yes**, briefly.                                                                                                                                                                                                                                                                                                                                          |
| `extract/`, `test/parity/`, `validation/`, `build.gradle`, `build-engine.mjs`, `gradle-exec.mjs` | ~3,400 lines          | **Yes.**                                                                                                                                                                                                                                                                                                                                                   |
| `web/src/engine/vendor/`, `web/public/engine/`                                                   | generated             | **No.** Compiler output.                                                                                                                                                                                                                                                                                                                                   |
| `.gradle/`, `build/`                                                                             | generated             | **No.**                                                                                                                                                                                                                                                                                                                                                    |

## Method

Fan out; do not read it all in one context. Launch parallel review agents, one
per slice. Each agent reads its files fully and reports concrete findings as
`SEV | CATEGORY | file:line | issue | why it matters | fix` (SEV =
HIGH/MED/LOW/UPSTREAM), ranked by severity, findings-only, no preamble. Then
synthesize into one prioritized `docs/AUDIT_ENGINE.md` with a recommended order
of attack at the end.

## The governing principle: compare against upstream, never against ourselves

This is the engine-side version of the lesson that cost `web/` three failed
audits. The elliptical fin planform was wrong in three of four TypeScript
modules for twelve days, and each audit compared the four copies to each other
and took the oldest as ground truth. Nothing compared any of them to the Java.

The same trap is laid differently here, and it is laid by a **green gate**:

- **`parity` proves the compile, not the source.** It requires bit-identical
  output from JVM, TeaVM-JS and TeaVM-WASM-GC. Three targets agreeing means
  TeaVM compiled our source faithfully. It says nothing whatever about whether
  our source matches OpenRocket. A patch that quietly changes a coefficient
  produces three identically-wrong targets and a green parity job.
- **`extract --check` proves the file contents, not the edits.** It verifies
  that `src/java` is exactly `upstream + patches`. The patches are an input to
  that equation, so it can never question them.

Between them these two gates read as "the engine is verified." What is actually
unverified is the 10,400 lines under `patches/`, which is precisely where
someone hand-edited physics.

**So: get the pinned upstream and diff against it.** Read
`engine-java/extract/UPSTREAM` for the repo and the exact ref, and clone or
sparse-check-out `core/src/main/java` at it. Take the ref from that file rather
than from anywhere else, including this prompt: a revision copied into a second
place is a second place to drift, which is the problem slice 4 asks you to
check between `UPSTREAM` and `gates.yml`. A different ref reports ordinary
version difference as if it were tampering.

## Slices

### 1. `patches/` - the 18 hand-edited OpenRocket files

The highest-value slice in the module. For **every** file under `patches/`,
diff it against the pristine upstream file at the same relative path and
classify **each hunk** into one of:

- **TeaVM compatibility** (the stated reason for most of them): `UUID` to
  `LongUUID`, `ConcurrentHashMap`/`ConcurrentLinkedQueue` to plain collections,
  `String.format("%g")` to `"%s"`, `Reflection.construct` to an `instanceof`
  chain, `java.awt.geom` to the `Geo2D` shim, `Locale.Category` dropped,
  `java.nio.file` dropped, `ArrayList.clone()` rewritten for WASM-GC.
- **Opt-in RASAero supersonic extensions**, which are deliberate original work
  and default-off. Reviewable diffs live in `docs/rasaero/diffs/`.
- **Unexplained.** An unexplained hunk in a physics file is the single
  highest-severity finding this module can produce. Report every one.

Then interrogate the two legitimate categories, because "compatibility" is
where a behavior change hides best:

- A collection swap that **changes iteration order** where order is
  semantically load-bearing. `InstanceMap` (`ConcurrentHashMap` to
  `LinkedHashMap`) is called out in the ledger as also making order stable -
  stable is not the same as _upstream's_ order, and mass/CG accumulation over
  instances is order-sensitive in floating point.
- A concurrency primitive swapped for a non-thread-safe one
  (`ConcurrentLinkedQueue` to `LinkedList` in `FlightConfiguration`). Single
  threaded in the browser is a fine reason; confirm nothing in the extracted
  set actually spawns a thread.
- `"%g"` to `"%s"` in `BasicEventSimulationEngine`: these differ in precision
  and format. If the string reaches anything but a log, that is a finding.
- The `instanceof` chain replacing `Reflection.construct` in
  `BarrowmanDragCalculator` / `BarrowmanStabilityCalculator`: is the chain
  **exhaustive** over the component types the app can build, and does it order
  subclasses before superclasses? A missing or misordered branch silently
  selects the wrong aerodynamic calculator for a component type.
- `Geo2D` replacing `java.awt.geom` in `FinSet` and `FreeformFinSet`: compare `distance` and `segmentsIntersect` against
  `Line2D`/`Point2D` semantics, including the endpoint-touching and collinear
  cases, which `Line2D.linesIntersect` defines specifically.
- `LongUUID` replacing `java.util.UUID` in two id classes: `equals`/`hashCode`/
  `compareTo` contract, and collision behavior.
- `PATCH(drogue-low-speed)` in `BasicEventSimulationEngine`, which the ledger
  describes as uncommenting upstream's own check. Confirm that is what it is.

Cross-checks: every `PATCH(...)` marker in `src/java` (there are 34) should
resolve to an entry in `patches/LEDGER.md`, and every one of the 18 patch files
should be **load-bearing** by the ledger's own test (`src/java/X.java` differs
from upstream `X.java`). A patch identical to upstream is a leftover that does
nothing until someone runs `extract`, at which point it silently swaps itself
in. The ledger says four such leftovers were found this way in September 2026;
check for more.

### 2. `src/api/` - the `@JSExport` facade

`OpenRocketEngine.java` (2,064 lines), `ComponentFactory.java` (1,064),
`JsonLite.java` (352), `AtmosphereProfile.java` (130) and
`GuideClearanceListener.java` (284). This is the entire trust boundary between
the browser and the kernel, and the only code here that the app calls directly.

- **`JsonLite` is a hand-rolled JSON parser** that consumes strings originating
  in the browser, which in turn originate in `.ork` files a stranger can send.
  Hunt: recursion depth on nested arrays/objects (stack overflow), input size,
  malformed-input behavior, numeric parsing of `NaN`/`Infinity`/exponent
  overflow/leading zeros, unterminated strings, escape and surrogate handling,
  duplicate keys, and what it returns versus throws. Compare its behavior to
  the caps `web/src/services/files/ork/importLimits.ts` already applies on its own side, and
  say which side is actually enforcing what.
- **Results are JSON strings built by hand** (the kernel ships no JSON lib).
  Hunt the serialization side: a `NaN` or `Infinity` emitted into JSON is not
  valid JSON and will throw in `JSON.parse` on the browser side, turning a
  physics edge case into an opaque app-level failure. Also unescaped user
  strings (component names, motor designations, file-sourced text) injected
  into the output.
- **Handle lifecycle.** The facade is handle-based static methods. Hunt: handles
  never freed (an unbounded map is a memory leak in a long-lived tab), reuse
  after free, integer handle collision or wraparound, and what happens when the
  app passes a stale or never-issued handle. Cross-reference against
  `web/src/engine/openRocketEngine.ts` to see whether the wrapper guarantees
  anything the facade assumes.
- **`ComponentFactory` builds rockets from a JSON tree.** Hunt: missing or
  out-of-range fields silently defaulted into physics, unknown component types,
  nesting depth, instance/cluster counts with no cap, and any place a value
  from the file reaches a constructor without validation. Compare its defaults
  against `web/src/tree/schema.ts`, `nodeProps.ts` and `kernelDefaults.ts` and flag divergence: two
  sides of one boundary with different opinions about a default is a real bug
  class.
- **Automatic radii in `ComponentFactory`.** A nose cone's `aftRadiusAuto` is
  its base wherever the base sits: on a flipped nose cone (a tail cone) the
  base is the fore end, and the factory sets it with `setBaseRadiusAutomatic`,
  so it follows the part ahead. A transition end with no radius in the JSON is
  automatic, not zero. Check both against `NoseCone` / `Transition`, and against
  `web/src/services/design/autoRadius.ts`, which resolves the same rules on the
  app side.
- **`getComponentGeometry(handle, id)`** returns what the kernel resolved for
  one part: its fore and aft radii, outer and inner radius, an outer and inner
  profile sampled at fixed stations, a fin set's `maxTabHeight` and a mass
  object's radius. `web/tests/testing/kernelGeometry.ts` reads it, and
  `geometryParity.kernel.test.ts` holds the app's own geometry to it. Confirm
  each field is the kernel getter it claims to be, read after the build, and
  that a component type it skips is one the app does not resolve itself.
- Exception behavior across the JS boundary: what does a thrown Java exception
  look like to the caller in each of the two targets, and is it the same?

### 3. `src/shims/java/` and `src/jdkstubs/`

Eleven shims and one JDK stub. Each shim is the **only** provider of a
fully-qualified name that upstream also defines, so a semantic gap between the
shim and the real class is invisible at compile time and wrong at runtime.

- **`RASAeroDragCalculator` and `RASAeroStabilityCalculator` are out of
  scope.** They are original work, not OpenRocket, subclassing the patched
  Barrowman calculators through the `effectiveBaseCD` / `turbulentCompressibility`
  seams those patches widened. The kernel RASAero aero model is not maintained
  work (the app keeps only the RASAero `.CDX1` export, on the `web/` side), and
  `docs/AUDIT_ENGINE.md` closed its physics findings (P2, P3, P7, P8, G13) as out
  of scope. Do not report findings against them.
- `Geo2D`: as in slice 1, its two methods stand in for `java.awt.geom` and are
  consumed by fin geometry.
- `LongUUID`: contract as above, plus whether ids are stable across a
  save/load round trip.
- `ApplicationPreferences` (in-memory) and `Application`: do defaults match
  what the desktop would supply? A preference that silently differs changes
  simulation results with nothing in the UI to show for it.
- `Simulation` and `OpenRocketDocument` are described as "lean". Lean in what
  respect, and does anything in the extracted physics depend on what was left
  out?
- `com.google.inject.Injector` is a one-method interface. Confirm nothing
  extracted actually depends on injection semantics.
- `java.text.Collator` stub: it affects motor-name sort order under TeaVM only,
  so the real JVM and the browser can sort differently. Does anything downstream
  depend on that order, and does `parity` see it?

### 4. Build, extraction and vendoring

`build.gradle`, `build-engine.mjs`, `gradle-exec.mjs`, `extract/extract.mjs`,
`extract/manifest.txt`, `extract/UPSTREAM`, `gradle.properties`.

- **`extract --check` failure conditions.** It counts missing, drifted, stale
  and unpatched files as problems, and also unblessed patches, leftover patches
  (identical to upstream), a missing `DIVERGENCE.txt` baseline, shims whose
  upstream class moved since review (`SHIMS.txt`) or a missing shim baseline,
  and drift in the app's upstream material rows. `extract/DIVERGENCE.txt` pins
  each patch's line delta plus a sha256 of the patch and of the upstream file it
  replaces, so any byte change to a patch fails the check until it is
  re-recorded with `npm run extract:bless` (which refuses to bless a leftover).
  Verify that every counter fails the check, that a bless cannot hide a change
  the LEDGER does not explain, and that no single bad manifest entry can turn
  the check green.
- `manifest.txt` has 273 entries against 273 files in `src/java`. Verify the
  correspondence is exact in both directions.
- Determinism of the two builds: does the same source produce byte-identical
  vendored output on a second run and on a different machine? The `parity` job
  has a rebuild-and-diff step that assumes so.
- JS and WASM-GC build settings in `build.gradle`: optimization level, strict
  mode, and any flag that could make the two targets differ in floating-point
  behavior. `-Pparity` builds a variant - confirm the variant that gets
  compared is the variant that ships.
- Confirm `gates.yml` still reads the ref from `extract/UPSTREAM`.

### 5. The gates themselves: `test/parity/` and `validation/`

Audit these as _claims_, the way the `web/` audit was told to ask whether a
gate's scope covers what it says it covers.

- **`parity --golden` rewrites `golden.txt` from the current run.** That is the
  documented way to record a deliberate physics change, and it is also a
  one-flag way to make a genuine regression disappear. Is there anything that
  makes a golden rewrite visible in review? Should there be?
- The golden comparison runs against the JVM output only, with tolerance. What
  tolerance, and is it loose enough to hide a real change? 359 golden lines
  covering which physics - is the coverage representative, or does it stop at
  the atmosphere model?
- `parity.mjs`, `run-target.mjs`, `stdout-sync.mjs`: what happens on a target
  that crashes, hangs, or produces no output at all? Does the comparison fail,
  or can an empty result compare equal? `TARGET_COMPLETE` and the stdout
  synchronization are load-bearing here.
- **`validation/` is a ratchet in CI.** The `validate` job in `gates.yml` runs
  `score.mjs --check-floors` on both models, which reads
  `validation/floors.json`: the gated set must be exactly 135 points with the
  recorded `gateHash`, and the score must not drop below 9/135 (classic) or
  61/135 (supersonic). Check that the floors and the gated-set hash still hold
  and that the job still runs both models.
- `validation/anchors.json` and the fixtures: does `score.mjs` validate their
  shape, or trust them?

## Verification discipline

Do not relay agent claims unchecked.

- Every finding against a `patches/` file must cite the **upstream line** it
  diverges from, not just our line. If you did not obtain the pinned upstream,
  say so plainly at the top of the report and downgrade every patch finding to
  unverified rather than presenting inference as fact.
- Every claimed gate hole must be **demonstrated**: describe the specific input
  or edit that passes the gate while being wrong. "This might not be covered"
  is not a finding.
- Only report with a specific `file:line` and a plausible failure scenario. No
  style nitpicks against extracted OpenRocket, ever.
- Where a finding is a deliberate trade-off the README or LEDGER already
  states, say so and assess the trade-off rather than reporting it as an
  oversight.

## Known state - verify, do not blindly carry forward

- The engine is **GPL-3.0**, derived from OpenRocket. The RASAero extensions
  are separate original work; see `engine-java/ATTRIBUTION.md`. Flag any
  license-header or attribution problem you find in the extracted or
  original files.
- `engine-java/package.json` declares **no dependencies by design**; there is
  nothing to `npm ci` and no lockfile to audit. Do not report that as a gap.
- The app loads WASM-GC by default and falls back to JS, so **both targets
  ship**. A finding that affects only one target still matters.
- `patches/` files are complete file copies, not diffs. "Applying a patch" is a
  file-level swap. Do not look for a `.patch` format.
- Four leftover patches were removed on 2026-09-16 (`BarrowmanCalculator`,
  `FlightConditions`, `AxialStage`, `AbstractSimulationStepper`); their diffs
  remain under `docs/rasaero/diffs/`. Do not report those as missing.
- Kernel behavior that is upstream's, not ours, and not a finding: two
  automatic ends that follow each other resolve to -1 (desktop does the same);
  an automatic end following a flipped nose cone's tip, and a ring placed where
  its parent has no bore, resolve to 0; fin sets mount only on body tubes.
  `geometryParity.kernel.test.ts` counts the first three as unresolved parts.

**Output:** write `docs/AUDIT_ENGINE.md`. Severity emojis (🔴 correctness in
shipped physics / 🟠 gates and build integrity / 🟡 API boundary and untrusted
input / 🟢 documentation drift and dead weight), plus a distinct marker for
`UPSTREAM` findings so they are never confused with ours. End with a stepwise
recommended order of attack that front-loads the patch diffs, because every
other slice's severity depends on what they turn up. Date-stamp it.

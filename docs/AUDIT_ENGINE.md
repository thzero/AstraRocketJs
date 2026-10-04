# AUDIT_ENGINE - `engine-java/` audit

<!-- cspell:ignore astrarrocketjs offaxis AEDC -->

Date: 2026-10-01. Branch `test` at b610c12. Run per `docs/AUDIT_PROMPT_ENGINE.md`,
six parallel review agents over the auditable surface, with the pinned upstream
obtained and every patch file diffed against it.

Companion to `docs/AUDIT.md`, which covers `web/`.

## Method, and why the diff numbers matter

The pinned upstream was cloned: `thzero/openrocket` at
`98f05af97bfbcd570bf2098307c23e0075beef4b`, the exact ref in
`engine-java/extract/UPSTREAM`, sparse checkout of `core/src/main/java`, 788
files. **No patch finding in this report is unverified inference.**

One mechanical point that governs every number below. Upstream files are CRLF and
ours are LF, so a naive `diff` reports **about 18,000 changed lines** across the 18
patch files. Normalized with `--strip-trailing-cr` the real figure is **1,670**.
Anyone auditing this module without that flag will drown. The repo itself is
consistent here: `extract.mjs` applies its `norm()` at every comparison, and
`.gitattributes` (`* text=auto eol=lf`) absorbs the rest. Not a finding, but the
first thing to get right.

## What is actually verified, stated plainly

`parity` verifies that the same Java compiles to a JVM run, a TeaVM-JS module and
a TeaVM-WASM-GC module that agree to within ULP noise. That is a compiler-fidelity
proof, and a good one. `golden.txt` verifies that 348 recorded output values have
not moved, to 6e-14 on everything static and 0.3 to 3 percent on the integrated
flight. That is change detection, against a file the same harness regenerates on
request. `extract --check` verifies that `src/java` is byte-reproducible from the
pinned upstream plus the 18 files in `patches/`. The patches are an input to that
equation, so it can never question what is in them. `validate` verifies that the
committed JS engine still scores at least 9 of 135 published wind-tunnel anchors
on the classic path, or 61 with the opt-in supersonic model.

Nothing here verifies that the physics is right. The golden proves only that a
number has not moved since someone chose to record it, not that it was ever
correct. The only check that compares the engine against reality outside this repo
is `validate`, which currently agrees with measurement on **6.7 percent** of its
anchors with the classic model and **45.2 percent** with the opt-in one, and gates
only on not getting worse.

"The engine is verified" is accurate in the sense that it is reproducible,
self-consistent across three backends, traceable to a pinned commit and held to a
recorded floor against published data, and in no sense beyond that.

## The good news, established before the findings

Three things the prompt was most worried about came back clean, and the report
should not bury them.

**Zero unexplained hunks.** All 18 patch files were diffed hunk by hunk and every
one classified. 77 hunks total: TeaVM compatibility 38, opt-in RASAero 23,
documented behavior divergence 5, cosmetic 2, and **0 unexplained**. The two
cosmetic ones are a deleted blank line and a duplicated javadoc block, both
reported below as documentation drift. Every `PATCH(...)` marker of the five
conforming kinds resolves to a `patches/LEDGER.md` entry, and no ledger entry
lacks a marker.

**The opt-in gating is airtight.** All 22 RASAero conditionals in the two large
aero files were traced, and each sits behind `supersonicAero`, `rogersKbf`,
`stubbyNoseFloor`, or `airfoilSection != null && (rogersKbf || supersonicAero)`.
Flag-off arithmetic is bit-identical to upstream, not merely equivalent. The seam
overrides delegate to `super` verbatim, and `createCalcObject` sets the flags
against fields already `false`. Nothing runs with the flags off.

**The `instanceof` chain is exhaustive.** Upstream defines nine classes in
`aerodynamics/barrowman`; two are abstract, one is not a calculator, and `TubeCalc`
is unreachable under upstream's own `Reflection.construct` rule because
`rocketcomponent/Tube` is abstract. That leaves exactly six constructible calc
classes and the chain has exactly those six branches. All twelve aerodynamic
component types `ComponentFactory` can build resolve to the same class the
hierarchy walk would have found. Subclass-before-superclass holds, though
vacuously: the six tested types are pairwise disjoint and `TubeFinSet` does not
extend `FinSet` despite the name. The forward hazard is real and the patch comment
already names it.

**`Geo2D` is bit-exact.** Exhaustive over all 65,536 segment pairs on a 4x4
integer lattice: 0 mismatches against `java.awt.geom.Line2D.linesIntersect`,
including every endpoint-touching, collinear-overlapping, collinear-disjoint and
zero-length configuration. `relativeCCW` 0 mismatches over all 4,096 triples.
`distance` 0 raw-bit mismatches over 2,000,000 fin-scale inputs. Freeform fin
self-intersection validation accepts and rejects exactly the outlines the desktop
does.

**Nothing threads.** `new Thread`, `ExecutorService`, `.submit(`, `parallelStream`,
`CompletableFuture`, `Executors`, `ForkJoin`: 0 matches across `src/java`,
`src/api`, `src/shims`, `src/jdkstubs` and `test/`. The
`ConcurrentLinkedQueue` to `LinkedList` and `ConcurrentHashMap` to `LinkedHashMap`
swaps are justified on the thread-safety axis.

So the problems in this module are **gate integrity, the API boundary, and
documentation**, not wrong physics on the default path.

## Verification tags

- **VERIFIED** means the synthesizer confirmed it independently, by reading the
  cited lines or by running something.
- **DEMONSTRATED** means an agent produced the failure, with the command and
  output, on a sandbox copy.
- **REPORTED** means raised with a file:line and a failure scenario, plausible on
  inspection, not independently re-run.
- **UPSTREAM** findings carry the `△` marker and are defects in OpenRocket, not
  ours. They must never be fixed by editing `src/java` in place.

---

## 🔴 Correctness in shipped physics

### P1. The Collator stub diverges from the JDK, and can make two motors compare equal (HIGH, VERIFIED) - FIXED 2026-10-04

`engine-java/src/jdkstubs/java/text/Collator.java:125` treats `_`, `/`, `'` and `.`
as primary-ignorable alongside `-` and space. The JDK treats only `-` and space
that way; the other four carry primary weights that sort before digits and letters.

Verified by running the real JDK 21.0.12 (the exact version `gates.yml` pins)
against the shim's own key-building logic. All five claimed divergences reproduce:

| pair | JDK | shim |
| --- | --- | --- |
| `A.T.` vs `A10-3T` | -1 | +1 |
| `H128W` vs `H128.W` | +1 | **0** |
| `H128W` vs `H128'W` | +1 | **0** |
| `H128W` vs `H128_W` | +1 | **0** |
| `H128W` vs `H128/W` | +1 | **0** |

The four zeros are the dangerous shape. `ThrustCurveMotor.COLLATOR` is
PRIMARY-strength `Locale.US` and is step 1 of `compareTo` (manufacturer display
name); `DesignationComparator` is also PRIMARY and is step 2 (designation). Both
run through this stub under TeaVM. A primary tie through both steps makes
`compareTo` return 0 for two distinct motors, so any sorted-unique container
silently drops one.

This is reachable with shipped data: `LOC/Precision` is a real manufacturer
display name in `src/java/.../motor/Manufacturer.java`, and the `1/2A` and `1/4A`
designation families carry `/`.

The gate cannot see it. `patches/LEDGER.md` claims "0 of 1369 at all four
strengths", which is true of its 37-name corpus only, and the 19-name matrix
pinned in `golden.txt` contains none of the four characters in a discriminating
position. On a 76-name corpus the agent measured 56 of 5,776 mismatches with 26
outright sign reversals at PRIMARY.

Fix: restrict `isVariable` to `-` and space, give the rest a primary weight
ordered before `0`, and add `.`, `'`, `_`, `/` to the parity corpus.

**FIXED 2026-10-04**, beyond the proposed fix. Measured against the real JDK 21
first: only space and `-` are primary-ignorable, and `_ / . '` sort in that order
ahead of digits. Fixing primary alone still left secondary and tertiary wrong on
about 2,500 pairs, because the stub compared the variable characters as a bag
rather than per position. The stub now gives every character a secondary and a
tertiary weight, compared in order, and returns -1, 0 or 1 as the JDK does (it
returned the raw key difference, which `collator.independent` caught). Measured
over every string of up to three characters from `space - . _ ' / 0 1 a A` plus
real designations and manufacturers, 5,198,400 ordered pairs at all four
strengths: **0 mismatched**, where the old stub mismatched 324,000 to 375,000 per
strength. The parity corpus gained `H128.W`, `H128'W`, `H128_W`, `H128/W`, `A.T.`,
`1/4A3`, `LOC/Precision` and two names differing only in where a space and a
hyphen fall; run against the old stub, parity fails on exactly those rows.

### P2. Roll damping is not scaled while roll forcing is (MED, REPORTED) - CLOSED, out of scope

With `supersonicAero` on, roll forcing is scaled by `ssaeroScale` (built from
`cna1`, returned scaled by `calculateFinCNa1`), but `calculateDampingMoment` in
`patches/.../barrowman/FinSetCalc.java` still reads the raw `K1`/`K2`/`K3` table
and keeps the Mach 4.9 flat clamp the flag's own javadoc claims to remove.

The damping derivative comes from the same single-surface Busemann coefficients the
flag exists to correct, so scaling one side only over-predicts steady-state roll
rate by roughly the scale factor: about 1.33x at M1.5 and 1.74x at M3 for aspect
ratio 1.33, and worse above M4.9 where forcing goes analytic and damping stays
frozen. `ParityMain.rollScenarios()` sweeps cant but not the flags, so no gate sees
it.

Upstream reference: `barrowman/FinSetCalc.java:656`.

Fix: apply `ssaeroScale(mach)` to the supersonic branch of
`calculateDampingMoment` and its transonic endpoints, or state in the javadoc that
roll damping is deliberately left at the classic level.

### P3. The transonic bridge omits a product-rule term (MED, VERIFIED) - CLOSED, out of scope

In `patches/.../barrowman/FinSetCalc.java`, the flag-on supersonic branch is
`finArea * ssaeroScale(mach) * (k1Analytic + k2Analytic*alpha + k3Analytic*alpha^2)`,
a product of two Mach-varying factors: `ssaeroScale(M) = 2 * max(1 - 1/(2*ar*beta), 0.25)`
with `beta = sqrt(M^2 - 1)`.

The transonic bridge supplies the supersonic endpoint derivative as
`superD = sscale * f'(1.5)`, omitting the `ssaeroScale'(1.5) * f(1.5)` term. Read
and confirmed: `sscale` is a constant evaluated at M1.5, and only `f'` is scaled.

`ssaeroScale'(M) = M/(ar*beta^3)` is 0.805 at M1.5 for aspect ratio 1.33, making
the true slope about -1.41 against the -2.85 supplied. The quartic gets an endpoint
slope roughly twice too steep, so fin CNa, CP and static margin are wrong through
the whole M0.9 to M1.5 band under the flag, with a visible kink at M1.5. The value
at M1.5 is continuous, so nothing looks wrong at the join.

Upstream reference: `barrowman/FinSetCalc.java:617`.

Fix: compute `superD = sscale*f' + ssaeroScaleDeriv(CNA_SUPERSONIC)*f`, or
finite-difference the flag-on branch at M1.5.

### P4. `hypot` makes single-motor roll inertia backend-dependent (MED, REPORTED) - FIXED 2026-10-04

`patches/.../masscalc/MassCalculation.java:278` removes upstream's
`if (1 < instanceCount)` guard, so `Math.hypot(y,z)` plus `Math.pow(d,2)` now runs
for every mount rather than only multi-motor clusters.

The repo's own `Geo2D` javadoc records JVM `hypot` (FDLIBM) and TeaVM 0.15 `hypot`
(naive) disagreeing by 1 ULP on about 12 percent of fin-scale inputs, and parity's
ULP tolerance absorbs it by design. So the JVM reference and the shipped WASM and
JS targets can report different roll inertia for a single off-axis motor, which is
the blind spot the 2026-09-19 `Geo2D` fix was taken to close.

The sibling half of this same patch already does it the safe way:
`RingComponent.instanceSpreadUnitInertia` uses `dy*dy + dz*dz`.

Upstream reference: `masscalc/MassCalculation.java:268-272`.

Fix: `clusterIr += eachMass * (coord.getY()*coord.getY() + coord.getZ()*coord.getZ())`,
identical on all three targets and strictly more accurate.

**FIXED 2026-10-04.** The motor loop sums `y*y + z*z`. No golden value moved.
`MassCalculation.java` 19 to 23 lines, re-blessed.

### P5. Off-axis roll inertia reaches only one ring type (MED, REPORTED) - FIXED 2026-10-04

`patches/.../rocketcomponent/RingComponent.java` derives its parallel-axis term
from `getInstanceOffsets()`, which only `InnerTube` populates with
`radialPosition`. `RadiusRingComponent` emits x-only offsets and
`ThicknessRingComponent` inherits `{ZERO}`. But `api/ComponentFactory.java` sets
`setRadialPosition` and `setRadialDirection` on every `RingComponent`.

So the patch's stated invariant, that the same mass at the same radius has the same
roll inertia however it was drawn, is still violated, now between component types.
A 60 g tube coupler bonded 15 mm off axis, a `<radialposition>` key the bridge
reads, reports roll inertia short by about 1.35e-5 kg m^2 while the identical mass
drawn as an inner tube reports it. The LEDGER lists couplers, engine blocks and
sleeves as on-axis, which the bridge does not guarantee.

Upstream reference: `rocketcomponent/RingComponent.java:245`.

Fix: add `shiftY`/`shiftZ` to the spread when `getInstanceOffsets()` does not carry
them, or address the lateral CG asymmetry in P6.

**FIXED 2026-10-04.** `instanceSpreadUnitInertia` adds the ring's radial shift to
offsets that do not already carry it (every ring type but `InnerTube`), with the
reference point unchanged. Guard: `mass.offaxis.tubecoupler` and
`mass.offaxis.innertube`, the same 15 mm off-axis tube drawn both ways, now agree
to the last digit; with the previous code the coupler's Ixx is 2.0607e-4 against
2.0646e-4. `RingComponent.java` 61 to 72 lines, re-blessed; golden 354 to 356.

### P6. Roll inertia and lateral CG disagree about where the mass is (LOW, REPORTED, stated trade-off) - DECIDED 2026-10-04

Roll inertia of an off-axis tube or motor is now correct while its lateral CG is
still reported on the axis, so pitch and yaw inertia still miss the offset.
Upstream's own `MassObject.getComponentCG()` returns `(length/2, shiftY, shiftZ, mass)`
and gets all three terms free through `rebase()`.

The LEDGER states the trade-off: using that point would move a CG and introduce
pitch and yaw terms. Assessed: it buys an unmoved `golden.txt` at the cost of a
kernel that disagrees with itself about where the same mass is, and it is the
direct cause of P5. If kept, record in the LEDGER that `MassObject` does it the
other way, so the next reader does not read the asymmetry as an oversight.

**Decided 2026-10-04: kept, and recorded.** The lateral CG stays on the axis.
Moving it would shift the CG of every off-axis ring and add pitch and yaw terms, a
much larger physics change that moves nearly every flight line, for a lateral
offset no flight here acts on. `patches/LEDGER.md` now says that upstream's
`MassObject.getComponentCG()` does it the other way and why these patches do not,
so the asymmetry reads as a decision. P5 removed the part of it that made one ring
type disagree with another.

### P7. The Van Driest fade misses the polished-finish branch (MED, REPORTED) - CLOSED, out of scope

`src/shims/.../RASAeroDragCalculator.java:112`'s `turbulentCompressibility` seam is
reached from only one of `BarrowmanDragCalculator.calculateFrictionCoefficient`'s
two branches, the fully-turbulent `else`. The `isPerfectFinish()` branch computes
`1/(1+0.045*M^2)^0.25` inline and never calls the seam.

With `supersonicAero` on, a fully polished rocket gets no Van Driest II fade: at M5
that branch yields 0.828 against the turbulent 0.478, about a 73 percent
difference, and the opt-in model silently does not apply.

Latent today, and the reason is itself a finding: `Rocket.setPerfectFinish` is
called nowhere in `src/java`, `src/api` or `test`, so `isPerfectFinish()` is
permanently false. That is a desktop divergence in its own right, a real `.ork` and
desktop setting that never takes effect here.

Fix: seam the partial-laminar branch too, or document that the fade is
turbulent-only; separately, wire `perfectFinish` through the facade.

### P8. A documented sweep-relief expression is identically 1.0 (LOW, REPORTED) - CLOSED, out of scope

`patches/.../barrowman/FinSetCalc.java`'s `sweepWaveFactor` supersonic-LE branch is
`Math.min(1.0, Math.max(c2, beta*cosGammaLead/betaN))`. Since
`(beta*cos G)^2 - betaN^2 = 1 - cos^2 G >= 0`, the ratio is always at least 1 and
the `min` always wins. The documented sheared-wing strip result never takes effect
and the function reduces to a smooth-step blend.

The javadoc asserts the factor "tends to 1 as M grows", implying intermediate
values, and credits a measured RM A53D02 result to a formula that is not running.

Fix: drop the dead expression and document that sweep relief switches off at the
sonic leading edge, or replace it with a factor that is actually below 1.

### P9. `BoundingBox.toString()` keeps six `%g` conversions (LOW, REPORTED) - FIXED 2026-10-04

`patches/.../util/BoundingBox.java:172` exists solely to make the file TeaVM-safe
and leaves six `%g` conversions, the exact conversion its sibling patch in
`BasicEventSimulationEngine` documents as absent from TeaVM's `Formatter`.

Unreachable today, nothing calls it. But the first log line or exception message
that concatenates a bounding box throws inside the kernel, and per LEDGER A4 a
throw on the WASM-GC target the app loads by default is a trap that cannot be caught, not an
`{"error":...}` envelope.

Fix: rebuild it with string concatenation, as `FreeformFinSet` already does.

**Checked and clean, do not re-report.** No NaN, divide-by-zero, negative `sqrt` or
out-of-domain `acos`/`asin`/`atan2` anywhere in the two RASAero shims: both degrade
to the stock value at M0, at the M0.9/1.1 joins, at M1, and for NaN and infinite
inputs. Both seams are C0 at their regime joins (slope kinks only, and the stock
model already kinks at M0.9/1.1). `thicknessWave` is C0 at both band edges;
`pmExpansionCp` degrades onto the vacuum limit where it loses its bracket;
`kWB1307` guards both endpoints; `ssaeroScale` cannot produce NaN at `ar == 0`
because a span guard makes it unreachable; `airfoilSection` cannot reach the
`default: throw` because `ComponentFactory` validates against exactly the switch's
six names. The `"%g"` to `"%s"` change reaches only `log.info` and is not stored or
returned. `PATCH(drogue-low-speed)` is exactly upstream's own commented-out block
uncommented, with the four code lines byte-identical. `ArrayList.clone()` is a
faithful shallow copy. `SimulationOptions`' 137 changed lines are entirely deletion
of the `java.nio.file` CSV subsystem, with no new flag, field or default added.

**FIXED 2026-10-04.** `toString()` is built by concatenation, the same shape as
upstream's with `Double.toString` for each number, under `PATCH(teavm-format-g)`.
The ledger now names that marker for both `%g` patches, and its `BoundingBox` row
and the README no longer claim the file uses `Geo2D`. Re-blessed, 19 to 28 lines.

---

## 🟠 Gates and build integrity

### G1. Parity validates a binary that is not the one that ships (HIGH, VERIFIED) - FIXED 2026-10-04

`engine-java/build.gradle:104` and `:125` both read

```
mainClass = project.hasProperty('parity') ? 'parity.ParityMain' : 'api.OpenRocketEngine'
```

and `:59` adds `test/` to `sourceSets.main.java` under `-Pparity`. So the binary
`npm run parity` validates has a different entry point and a larger compiled source
set than the binary `npm run build` vendors.

This matters because `fastGlobalAnalysis` is class-hierarchy analysis over the
reachable set, and it is the documented workaround for TeaVM under-linking
map-key and recursive-walk dispatch. Production's reachable set is strictly
smaller and is compared against neither the JVM reference nor `golden.txt`.

To be fair to the design: every numerics-relevant setting is unconditional.
`optimization = NONE`, `fastGlobalAnalysis = true`, `obfuscated = false`,
`moduleType = ES2015`, toolchain 21/ADOPTIUM, and `strict` on neither target. No
floating-point flag differs between variants or targets, and `build-engine.mjs`
states the trade-off honestly ("the parity harness validates a SIBLING of the
shipped binary"). The residual risk is link-set shape only. Compensating controls
are real but partial: a 13-name export regex plus a `/ParityMain/` check (JS only),
`validate` exercising the shipped `.mjs` numerically, and the e2e shards loading the
shipped `.wasm`.

What nothing covers is the shipped binary of either target against the JVM
reference or `golden.txt`.

Fix: reach the harness through an `@JSExport` on `api.OpenRocketEngine` so
`mainClass` is the facade in both variants.

**FIXED 2026-10-04, by shipping the harness.** `ParityMain` compiles into every
build and the facade exports `runParity()`; the facade is the `mainClass` of both
targets, and `-Pparity` is gone. `parity.mjs` builds and vendors through
`build-engine.mjs`, then runs the VENDORED `.mjs` and `.wasm`, the files the app
loads, against the JVM running the same scenarios. So the shipped binary of each
target is now what is compared, and what `golden.txt` pins. Both pass all 356
lines, with the same bit-identical counts the sibling build had. The cost, chosen
deliberately: about 95 KB on the JS engine and 62 KB on the WASM (3.3% and 2.5%),
never executed by the app; its output goes to the kernel log sink, which drops it.

### G2. `DIVERGENCE.txt` pins a line count, not content (HIGH, DEMONSTRATED) - FIXED 2026-10-04

The blessed baseline records an LCS changed-line count per patch, so any
coordinated `patches/` plus `src/java` edit that preserves the count passes
`extract --check`.

Demonstrated: changing `afterbodyFactor = Math.min(1.0, 0.5 + afterLen / rootChord)`
to `0.6` in **both** copies of `FinSetCalc.java:183` leaves the file at 713 changed
lines and yields `extract --check: OK`, exit 0. A fin-carryover coefficient moved
with every extraction gate green. The same mechanism hides an upstream move that
does not shift the count.

This is exactly the attack `DIVERGENCE.txt`'s own header claims to stop.

Fix: record a sha256 of each patch beside the delta and fail on a hash change,
exactly as `extract/SHIMS.txt` already does for shadowed shims.

**FIXED 2026-10-04.** Each entry now carries a sha256 of the patch and of the
upstream file it replaces, beside the count, and `extract --check` fails on any of
the three moving, naming which (`patch content changed`, `upstream content
changed`, `count a -> b`). An entry with no hashes parses and is reported as
unblessed, so the old count-only file could not pass silently. Replayed the
demonstration above: `0.5` to `0.6` in both copies of `FinSetCalc.java:183` keeps
713 lines and now fails with `patch content changed`. Re-blessed with no count
moving.

### G3. Nothing pins the golden line count (HIGH, VERIFIED and DEMONSTRATED) - FIXED 2026-10-04

`parity.mjs` has no `--expect-lines` counterpart to validation's `--expect-gates`.
Verified: `--expect-lines` appears 0 times in `parity.mjs`, while `--expect-gates`
appears 3 times in `score.mjs`. `lines=348` is written into the golden header and
never read back; only the `sha256=` line is re-verified.

Demonstrated: delete every `aero.*`, `roll.*` and `fins.*` emission from
`ParityMain`, run `parity:golden`, and the ordinary gate run prints
`parity ok: 182 lines` / `golden ok: 182 reference value(s) unchanged` and exits 0.
166 lines of CP, CN, CD and roll physics silently stopped being checked.

The one gate that looks at physics rather than at the compile can be shrunk to
nothing while reporting "ok".

Fix: add `--expect-lines <n>` and pass it in `gates.yml`, so a deliberate shrink has
to be argued in the workflow diff.

**FIXED 2026-10-04.** `parity.mjs` takes `--expect-lines <n>` and fails with a named
error when the golden holds a different number of values; `gates.yml` passes it.
Checked both ways: the right count passes, a count one short fails. It is 354 now,
not 348, because P1 and G6 below re-recorded the golden.

### G4. Validation fixtures are trusted on everything that matters (HIGH, DEMONSTRATED) - FIXED 2026-10-04

`validation/score.mjs` validates exactly two scalars per fixture, `length` and
`refDiameter`, which are the two values that fin geometry, fin section and surface
finish cannot change.

Demonstrated, all with `--expect-gates 135 --min 61`:

| corruption | score | exit |
| --- | --- | --- |
| baseline | 61/135 | 0 |
| `crossSection` renamed `crossSectionX` | **73/135** | 0 |
| `airfoilSection` renamed `airfoilSectionX` | 63/135 | 0 |
| fin thickness 0.0024 to 0.0060 m | 63/135 | 0 |

A fixture that no longer models the published Army-Navy Basic Finner scores 12 more
gate points than the real one, and CI goes green, because the only enforcement is a
lower bound.

Fix: extend `_expect` to the aero quantities the fixture exists to produce.

**FIXED 2026-10-04.** Each fixture's `_expect` now carries an `aero` block: drag,
CNa and CP at Mach 0.5 and 2.0 under BOTH models, whichever one is being scored
(`airfoilSection` is read only on the supersonic path), checked to 0.1%. The
corruptions above move drag by 7% to 97%. Replayed: `crossSectionX`,
`airfoilSectionX` and the thicker fin each now fail before scoring, naming the
fixture and the figure. A deliberate model change re-records with
`score.mjs --record-expect`.

### G5. Tolerances and the gated set are both unpinned (HIGH, DEMONSTRATED) - FIXED 2026-10-04

Two separate holes in the same file.

`tol` and `relTol` are trusted with no sanity bound. Widening
the `hb2` CNa tunnel tolerance from 0.005 to 0.05 scores 70/135, exit 0; setting
the `basic-finner` CNa relative tolerance from 0.1 to 1.0 scores 68/135, exit 0.
`validation/README.md` says "never widen a tolerance to make a phase pass", and
that rule exists only in prose.

`--expect-gates` pins the cardinality of the gated set, not its identity. Setting
the `hb2` CNa tunnel series `gate = false` (9 hard gates, all failing) and
`arcas-short.cd-rasaero-parity.gate = true, gateMinMach = 1.15` (9 easier points)
keeps `gateTotal` at exactly 135, raises the score to 64/135, and passes both
`--expect-gates 135` and `--min 61`, exit 0.

Fix: pin a sorted hash of the `(series.id, mach, tol)` triples.

**FIXED 2026-10-04.** The scorecard prints a sha256 over every gated point's
series, quantity, Mach, anchor and tolerance, and CI passes it to both steps as
`--expect-gate-hash`. Replayed: widening the `hb2` CNa tolerance tenfold now fails
with the hash named; swapping gate flags changes the same hash. The README's "never
widen a tolerance" rule is now enforced.

### G6. Two shipped component types have no gate coverage at all (HIGH, REPORTED) - FIXED 2026-10-04

`ComponentFactory` exposes `tubefinset` and `railbutton` to the app and both
calculators compile into the shipped engine. `grep -ci tubefin` over
`ParityMain.java`, `golden.txt`, `anchors.json` and all four fixtures returns 0 for
every file; `railbutton` likewise appears in none of them.

So a wrong tube-fin CNa or rail-button drag term passes `parity` (all three targets
agree on it), passes `golden` (no line pins it) and passes `validate` (no fixture
builds one). That is precisely the shape of the fin bug this audit series exists to
catch.

Fix: add a tube-fin and a rail-button design to `ParityMain` and re-record golden.
No new fixture needed; the static aero lines are enough.

**FIXED 2026-10-04.** `ParityMain` builds a six-tube-fin design and a design with two
rail buttons, and pins each one's static info and its drag breakdown, CNa and CP
at Mach 0.3 and 0.8: six golden lines. The re-record also moved `uuid.first` (the
new rockets use up harness UUIDs before it runs) and `flight.para.summary` by 3e-9
relative (component ids feed the order the drag terms are summed in, the
`InstanceMap` behavior under UPSTREAM findings). Checked by content rather than
by position: nothing else changed.

### G7. The WASM artifact gets no parity-confusion guard (MED, REPORTED) - FIXED 2026-10-04

`build-engine.mjs`'s guard (expected exports present, `/ParityMain/` absent) runs
only when the target list includes `js`. The WASM copies are vendored with no
check, although both variants write the same Gradle output paths and
`org.gradle.configuration-cache=true` caches a configuration that branched on
`project.hasProperty('parity')`.

The shipped `.wasm` is the backend most browsers take. In the committed artifact
`OpenRocketEngine`, `simulateJson`, `getAeroSweep` and `FinSetCalc` are all present
as strings while `ParityMain` is absent, so both guards are implementable on the
wasm bytes and simply are not applied.

Fix: read the wasm as latin1 and run the same two checks before copying.

**FIXED 2026-10-04** with G1. `build-engine.mjs` checks the expected facade exports
in BOTH artifacts before vendoring either, reading the wasm as latin1. The old
"no ParityMain" check is gone, since the harness now ships; `runParity` is on the
export list instead, and the previous wasm, which lacks it, would be refused.

### G8. javac source encoding is left to the platform (MED, REPORTED) - FIXED 2026-10-04

No `options.encoding` on any `JavaCompile` task, while `gradle-exec.mjs` forwards
`GRADLE_OPTS` and `JAVA_OPTS` verbatim, so a `file.encoding` override reaches the
compile.

`src/api/java/api/OpenRocketEngine.java` carries raw UTF-8 characters inside string
literals that ship as constants (22 compiled files hold non-ASCII bytes, 4 lines of
them inside literals). A decode change alters the vendored bytes, and the parity
job's `git diff --exit-code` then fails with a binary diff whose printed hint points
the reader at `java -version` rather than at encoding.

Fix: `tasks.withType(JavaCompile) { options.encoding = 'UTF-8' }`.

**FIXED 2026-10-04**, as a declaration rather than a cure for an observed failure.
`build.gradle` sets `options.encoding = 'UTF-8'` on every `JavaCompile` task. The
rebuilt engine is byte-identical, since JDK 18+ already defaults to UTF-8. The
hazard could not be reproduced here: building with `file.encoding=ISO-8859-1` in
both `GRADLE_OPTS` and `JAVA_TOOL_OPTIONS` gave identical bytes with and without
the setting, so those variables do not reach the forked toolchain compiler on this
setup. The setting stays because it costs nothing and makes the build state its
encoding instead of inheriting it.

### G9. The validation floors sit exactly on the measurement (MED, VERIFIED) - FIXED 2026-10-04

Ran both commands:

| run | live | committed `.md` | CI floor | slack |
| --- | --- | --- | --- | --- |
| `score.mjs --expect-gates 135 --min 9` | **9/135 (6.7%)** | 7/135 | 9 | 0 |
| `score.mjs --supersonic --expect-gates 135 --min 61` | **61/135 (45.2%)** | 64/135 | 61 | 0 |

Zero slack in both directions. As a ratchet this is the strictest useful setting and
is defensible, but it means any single point that moves for a platform or node
reason turns CI red reading "the aero model regressed", and the next improvement is
a floor nobody raised. The floors also live in `gates.yml` while
`validation/README.md` carries a second hand-maintained copy of the same two
numbers, with nothing comparing them.

Fix: keep the floors at the measurement and have `score.mjs` read them from one
committed file the README renders from.

**FIXED 2026-10-04.** The gate count, the gated-set hash and both floors live in
`validation/floors.json` and nowhere else. CI runs `score.mjs --check-floors`, which
reads them; `gates.yml` no longer repeats the numbers, and the validation README
points at the file. Checked both ways: raising the classic floor to 10 or
changing the gate count to 134 fails the run.

### G10. The committed scorecards are wrong on almost every row (MED, VERIFIED totals) - FIXED 2026-10-04

Row by row against live output: the classic scorecard has 161 of 187 model values
changed with 3 verdict flips, and the supersonic one 116 of 187 changed with 21
verdict flips (7 PASS to FAIL across `arcas-short`/`arcas-long`
`cd-supersonic-tunnel` M1.8 to M3.95, against 4 FAIL to PASS in the transonic band).

The harness is still correct and its own guards work. But every committed `.md` is
wrong on almost every row, so the files cannot be used to attribute a future
change. `validation/README.md` admits the staleness and carries the right live
figures, which is honest and leaves six wrong files in the tree. The phase-1 to
phase-4 scorecards are 137-gate historical snapshots that cannot be regenerated
under the current 135-gate anchors, and the README labels them historical, which is
the right handling.

Fix: regenerate both current scorecards and commit.

**FIXED 2026-10-04.** Regenerated as `validation/scorecard-classic.md` (9/135) and
`validation/scorecard-supersonic.md` (61/135), under undated names so a name can no
longer claim a date its content has outgrown. The two stale "current" files
(`baseline-classic-2026-08-04.md`, `scorecard-audit-2026-08-04.md`) are removed;
the phase-1 to phase-4 snapshots stay, labeled historical. The validation README's
table, regenerate command and file list point at the new files.

### G11. Golden tolerances are loose where they need not be (MED, REPORTED) - FIXED 2026-10-04

Measured by perturbing the JVM reference and running the real comparison: static
lines 6e-14 relative (bit-exact in practice), `flight.*` 0.30 percent (0.99 m of a
330.68 m apogee, 0.31 s of a 102.16 s ground hit), `flight.conditions.*` 3.0
percent (10.9 m of 363 m), the extended-series length line plus or minus 25 of 528
samples, and near-zero `flight.sample.*` accelerations 10 percent free.

The argument in the comments is right and was applied once already (5e-3 to 3e-3
after measuring a 1.65 m blind band). The same argument applies to what is left,
and the sample-count slack and the 10 percent band on small accelerations are not
justified by transcendental ULP drift at all.

Fix: record the golden on a pinned platform and split it into a bit-exact section
and a tolerance-based one, so the loose band is visibly confined to the chaotic-wind
scenario.

**FIXED 2026-10-04, in the part that can be checked here.** A fresh JVM run
reproduces all 356 golden values bit for bit on the recording machine, turbulent
flights included. So against the golden, every line that is not time-integrated
must now match exactly (it had a 6e-14 band). The flight lines keep their band
only because CI records on another OS, which could not be measured from here: the
run now reports how many golden values matched only within tolerance (0 today),
and the golden header records the platform it was recorded on
(`win32-x64`, OpenJDK 21.0.12), so a flight line that stops matching exactly
points at a platform change. Tightening the flight band further waits on a CI
measurement.

### G12. `validate` scores only the JS artifact and discards kernel logs (MED, REPORTED) - FIXED 2026-10-04

`score.mjs` imports `web/src/engine/vendor/openrocket-engine.mjs` directly, never
the WASM-GC module the app loads by default, installs the stdout and stderr sinks as
no-ops, and asserts nothing about the provenance of the binary it imported.

WASM fidelity is covered transitively by `parity`, but `validate` does not `need`
parity, so a hand-edited vendor `.mjs` is scored happily by this job on its own, and
a fixture that drives the kernel into a logged failure path scores silently.

Fix: collect rather than discard, and fail if the kernel logged an error while a
gated point was computed.

**FIXED 2026-10-04.** `score.mjs` collects the kernel's stderr instead of
discarding it. A clean scoring run writes nothing there (measured), so any output
fails the run and prints what was logged; a planted error line was caught.

### G13. The largest body of original physics is pinned by 10 golden lines (MED, REPORTED) - CLOSED, out of scope

The opt-in RASAero model, two shim calculators plus patched upstream files, is
pinned by 10 golden lines total (4 lift, 4 drag, 2 carryover), against 76
for fin roll and 73 for classic static aero. `validate --supersonic` scores it
against real anchors but gates only on a floor it already sits exactly on.

Fix: extend the `ssaero` sweep to the Mach grid the classic `aero.cp` scenario
already uses.

### G14. A `--golden` rewrite is visible only as an ordinary diff (MED, REPORTED) - FIXED 2026-10-04

The `--golden` run does print how many values moved, but that transcript is on the
developer's machine and CI never sees it. No CI step mentions `golden.txt` at all.
The header line does change on every regeneration (`sha256=`, `generated=`,
`commit=`), which is a real tripwire for a reader of the diff, and the sha256
re-verification blocks the cheaper attack of hand-editing one value.

So a genuine regression can be laundered into a green build by one flag plus a
plausible commit message, with nothing forcing a second pair of eyes.

Fix, cheapest effective: a PR step that fails if `golden.txt` differs from the merge
base unless a commit message carries an explicit marker.

**FIXED 2026-10-04, as a report rather than a gate.** A `golden-report` job on
pull requests lists, in the job summary, every golden value the request moved,
added or removed, compared by value so a header-only re-record reports nothing.
It never fails: the point is that a re-record is seen where it is reviewed, not
that it is blocked. Tested in a scratch repository from `engine-java/`, as CI runs
it.

### G15. Smaller gate holes, each demonstrated - FIXED 2026-10-04

- **A duplicate manifest line passes.** Appending a second
  `info/openrocket/core/util/MathUtil.java` gives exit 0, and the run still reports
  "272 manifest files" against 271 real files. That 272 to 272 correspondence is the
  figure the README, LEDGER and CHANGELOG all quote. Fix: a `Set` size check.
- **A re-blessed delta-0 leftover passes.** Copying upstream's `ArrayList.java` over
  both copies and editing `DIVERGENCE.txt` to 0 gives `extract --check: OK`, exit 0,
  while the run prints "LEFTOVER: identical to upstream, delete it" and the LEDGER
  records this case as exit 1. `--bless` writes the 0 rather than refusing. Fix:
  count `delta === 0` toward problems.
- **`describe` is unverified.** It is the only `UPSTREAM` field nothing checks: `ref`
  is verified by checkout and `date` against the commit's own dates, but no step runs
  `git describe` and no code reads the field. The file teaches readers to interpret
  the pin from it, so a bump that leaves it naming an unrelated tag ships wrong
  provenance with CI green.
- **Nothing requires a LEDGER entry.** `--bless` writes `DIVERGENCE.txt` and
  `SHIMS.txt` only, so a commit can move a blessed delta with no ledger entry and
  every gate stays green. "Re-bless it and explain each number that moved" is purely
  social. Fix: have `--bless` print a paste-ready ledger stub.
- **Four jobs have no `timeout-minutes`.** `validate`, `reproducible`,
  `build-and-test` and `e2e` inherit the 360-minute default. `validate` is seconds of
  work. The `parity` comment already argues a cap is a backstop, not a budget; the
  backstop is simply absent on the cheap jobs.

**The four counters are otherwise sound.** Each was given a bogus input and each
caught it, exit 1: a manifest entry naming a nonexistent file (missing); an entry for
a file that exists upstream but not in `src/java` (drift); a comment inserted into a
non-patched file (drift); a stray `src/java/notes.txt` and an unmanaged
`Sneaky.java` (unmanaged); a `PATCH` marker with no `patches/` twin (unpatched);
and a deleted `DIVERGENCE.txt` (no baseline). The bogus-entry class the comments
describe is closed in both shapes. `manifest.txt` correspondence is exact in both
directions, 272 entries, 272 files, no duplicates, every entry present upstream.
All 18 patch deltas match `DIVERGENCE.txt` exactly. `extract --check` against the
pinned clone returns OK, exit 0. Parity's four failure modes all correctly fail:
non-zero exit, zero exit with no output, a truncated run, and a hang, each with the
deciding line identified; the two dangerous ones are closed deliberately and
documented as having been found.

**FIXED 2026-10-04.** A duplicate manifest line is refused. A patch identical to
upstream counts as a failure and `--bless` refuses to record it. The `describe`
field must end in the pinned ref's short hash (the clone is shallow, so the tag
half cannot be checked here, but a bump that forgets `describe` fails). `--bless`
prints a paste-ready ledger stub for every entry that moved. Each was replayed:
the duplicate line, a mismatched `describe` and an upstream-identical
`ArrayList.java` all fail. The job timeouts were already in place.

---

## 🟡 API boundary and untrusted input

### B1. No magnitude bound on any file-sourced dimension (HIGH, DEMONSTRATED) - FIXED 2026-10-04

`JsonLite` refuses non-finite literals but bounds no magnitude.
`{"type":"nosecone","length":1e300}` parses, builds, and `getStaticInfo` returns
every field as `null` with `"warnings":0.0` and **no `error` key**;
`getComponentMasses` returns empty.

This is verbatim the failure `JsonLite.java:203-206` says it fixed by refusing
`1e999`: "builds a rocket whose every StaticInfo field then serializes as null, and
the JS side only checks for an `error` key". The guard covers the exponent-overflow
spelling and a finite one walks straight past it.

`parseEnvelope` in `web/src/engine/openRocketEngine.ts` inspects only `error`, so
the app paints an all-null design with zero warnings and nothing to explain it.
Reachable from any `.ork`: the browser's `finiteNum` checks finiteness only.

Fix: bound dimensions at the boundary with a `dimension()` reader beside `count()`,
and make the writers return an error envelope when a required scalar comes back
non-finite instead of emitting `null` with `warnings:0`.

**FIXED 2026-10-04**, both halves. Every number `ComponentFactory` reads is refused past
`MAX_MAGNITUDE = 1e6` in SI units, naming the key. And `getStaticInfo` returns an
error envelope when the length or mass comes back non-finite, instead of nulls
beside `"warnings":0`. `{"length":1e300}` on a nose cone now fails with
`'length' is out of range`.

### B2. The most common fin type silently flies a different rocket (HIGH, VERIFIED) - FIXED 2026-10-04

`ComponentFactory.java:249` reads the trapezoid fin count as a bare
`(int) dbl(node, "finCount", 3)`. Lines 262, 273 and 319 all use
`count(node, "finCount", 3, MAX_FIN_COUNT)`.

The `count()` helper's own docblock states the rule being broken: "NOT a bare
`(int) dbl(...)`, which turns NaN into 0 and Infinity into Integer.MAX_VALUE.
Out-of-range is rejected rather than clamped: silently building a different rocket
than the file describes is the failure this boundary exists to prevent."
`FinSet.setFinCount` then clamps: `if (n > 8) n = 8`.

Measured: finCount 12 gives 8 fins, 100 gives 8, 3.9 gives 3, 0.4 gives 1, -5 gives
1, each returning OK with a full `staticInfo`. The same key on the other three fin
types throws `'finCount' must be a whole number in 1..8`.

So the most common fin type in the app is the one type that silently flies a
different rocket than the file describes, and the browser's own ceiling is 64,
eight times the kernel's, so a 20-fin `.ork` imports clean and then either flies as
8 (trapezoid) or refuses to build (elliptical).

Fix: route line 249 through `count(...)` and lower the browser's `MAX_FIN_COUNT` to
8.

**FIXED 2026-10-04.** The trapezoid fin count goes through `count(...)` like the other
three fin types, so 12, 3.9 and 0 are refused with `'finCount' must be a whole
number in 1..8` instead of flying as 8, 3 and 1. The browser follows: a new
`nodeProps.MAX_FIN_COUNT = 8` is the `.ork` import ceiling (desktop OpenRocket
clamps the same way on load) and the fin-count field's maximum, while other
instance counts keep 64. `engineBoundary.test.ts` drives the rebuilt kernel and
fails against the previous one.

### B3. Whole subtrees can be dropped silently (MED, DEMONSTRATED) - FIXED 2026-10-04

`JsonLite.objList` returns an empty list for a key that is present but not a list,
and silently skips any element that is not a Map. Measured: `"children":[1,2,3]` and
`"children":{"type":"trapezoidfinset"}` both build a childless body tube with
staticInfo byte-identical to a no-children rocket.

This contradicts the class's own rule three methods above it ("A key that is PRESENT
but of the wrong type is a caller bug or a bad file, and silently falling back meant
... Different rocket, no warning") and contradicts `buildRocket`'s explicit
present-but-not-a-list check for the top-level `components`.

A truncated or lax exporter drops fins, the motor mount or recovery, and the engine
reports a healthy rocket.

Fix: throw `wrongType` when the key is present and not a list, and when an element
is not an object.

**FIXED 2026-10-04.** `objList` treats an absent key as empty and refuses a present
non-list (`should be a list`) and any element that is not an object. Both
measured cases, `"children":[1,2,3]` and `"children":{...}`, are now errors, each
tested against the rebuilt kernel.

### B4. Seven string-to-enum mappers silently default (MED, DEMONSTRATED) - FIXED 2026-10-04

`crossSectionOf`, `shapeOf`, `axialMethodOf`, `deployEventOf`, `finishOf`,
`radiusMethodOf`/`angleMethodOf` and `massComponentTypeOf` all default an
unrecognized value, while four others throw (`airfoilSection`, `cluster`, component
type, and the facade's `separationEventOf`/`ignitionEventOf`).

Measured: `crossSection:"diamond"` becomes SQUARE, `shape:"bogus"` becomes
OGIVE, `position:{method:"nonsense"}` becomes TOP/0, `deployEvent:"whenever"`
becomes EJECTION, all with no error. A typo or a newer-OpenRocket enum spelling from
a stranger's file silently changes the airfoil, the nose profile, where a part sits
or when the chute comes out. `shapeOf`'s silent OGIVE changes CP.

Fix: throw on an unknown name, as the type switch already does.

**FIXED 2026-10-04.** Every reader takes every name of its upstream enum, case- and
underscore-insensitive, and refuses anything else, naming the kind and the accepted
values. That closed four silent misreadings as well as the defaults: `after` (the
app can still carry it) now means `AxialMethod.AFTER`, not TOP; a desktop file's
`lower_stage_separation` chute no longer opens at ejection; the `mirror` and
`optimum` finishes and the `mirror_xy` angle method are no longer read as NORMAL
and RELATIVE. The facade's own nose-cone builder uses the same reader instead of a
lenient copy. Tested against the rebuilt kernel, including that `mirror` carries
less drag than `normal` (they were equal before); the full e2e suite passes, so
nothing the app sends is refused.

### B5. The two backends disagree on one error path (MED, DEMONSTRATED) - FIXED 2026-10-04

The `machAlt` block is the only place in the facade with unchecked casts, and the
only path where the backends differ on a reportable error:

| input | TeaVM-JS | TeaVM-WASM-GC |
| --- | --- | --- |
| `{"machAlt":["a"]}` | `TypeError: $row.$get0 is not a function` | `ClassCastException` |
| `{"machAlt":[["x","y"]]}` | `TypeError: ...$doubleValue is not a function` | `ClassCastException` |

A minified TeaVM internal symbol is shown to the user on one backend and a bare
exception name on the other, neither naming the field or the row. The existing
cross-target test asserts message equality only for the three envelope cases that
involve no casts, so this divergence is untested.

Fix: validate each row the way `freeformfinset` validates its points, and name the
row index.

**FIXED 2026-10-04.** `machAlt` is checked, not cast: a present non-list is refused,
and each row must be two numbers, with the row index in the message. Both backends
now return the same envelope, `'machAlt' row 1 should be [mach, altitude] numbers`,
asserted on JS and WASM in `engineBoundary.wasm.test.ts`.

### B6. The `addX` builders validate nothing (MED, DEMONSTRATED) - FIXED 2026-10-04

`engine-java/README.md` states these methods throw "an `IllegalArgumentException`
with a message that names the field". For the five `addX` builders and
`getWorstThetaDeg` they do not. Measured: a null `shape` gives
`Cannot read properties of null (reading '$nativeString')`; `NaN` length gives
`Error: null`; a negative radius builds with `mass:0.0` and no error; `1e9` fins
gives 8 silently; `getWorstThetaDeg(h,NaN,0)` returns 0.

`applyMotor` two screens away checks array lengths, finiteness, sign and
monotonicity, so the discipline exists in the file.

Not reachable from the app today (the TS wrapper exposes none of the builders), so
the exposure is the worker, the tests and any future direct caller, which is the
stated threat model.

Fix: a shared `finite(name,v)`/`positive(name,v)` guard at the head of each, plus a
null check on `shape`.

**FIXED 2026-10-04.** Each builder checks its arguments first: a shape is required,
sizes must be finite and within the file-input magnitude bound, lengths and radii
positive, thicknesses non-negative, and a fin count 1 to 8; `getWorstThetaDeg`
refuses a non-finite Mach or angle. Each message names the argument. The README's
claim that these throw naming the field is now true.

### B7. No way to free one handle (MED, REPORTED) - FIXED 2026-10-04

`reset()` is all-or-nothing and nothing else ever removes a map entry. Every `addX`
call registers a component permanently, and two `buildRocket` calls without a reset
leave both `RocketCtx` objects, each holding a whole `Rocket`, alive for the life of
the module. `HANDLES` is static in a module that lives as long as the tab.

The Java side is safe only because every caller resets first, on the main thread and
in the worker. The facade guarantees nothing.

The good parts are deliberate and worth keeping: `reset()` does not rewind
`nextHandle`, with a comment explaining the id-reuse bug that caused, and
`get(handle, kind, what)` catches a wrong-type handle that the TS generation counter
cannot. Stale, never-issued, negative and zero handles all report `Unknown handle`
correctly on both targets.

Fix: export `free(int handle)`, and stop registering from the `addX` builders.

**FIXED 2026-10-04.** The facade exports `free(handle)`, which releases one handle
and refuses an unknown one; a freed id stays unknown, as after `reset()`. The
builders still register their components, because callers pass those handles
back as parents, and `free` releases them the same way. Tested on the rebuilt
kernel: freeing one rocket leaves another intact.

### B8. The two sides of the boundary disagree about limits (MED, VERIFIED by table) - FIXED 2026-10-04

Every numeric default agrees. The limits do not:

| limit | kernel | browser | verdict |
| --- | --- | --- | --- |
| trapezoid finCount | 8, silently clamped | 64, clamped | divergent and silent, see B2 |
| other fin types finCount | 8, throws | 64, clamped | import succeeds, build refuses |
| assembly instanceCount | 64, throws | 1000, clamped | divergent |
| component nesting | 31 levels (64 JSON levels) | 100 | divergent |
| freeform point count | no cap | 10000 | kernel unbounded |
| shroud lines | 1024 | 100 | browser stricter, benign |

A crafted file nested 32 to 100 deep, or carrying a 200-instance pod set, imports,
draws and persists, and then every engine call fails with a message naming a
character offset in a JSON string the user never saw.

The Java side is right about nesting: `attachChildren` recurses with no limit of its
own and is safe because `JsonLite` already refused, which is the correct place for
it.

Fix: derive the browser caps from the kernel's so refusal happens where it can name
the component.

**FIXED 2026-10-04.** The browser's import ceilings now come from the kernel's. Fin
count was already 8 (B2). Assembly, ring and lug instances are 64, the kernel's
`MAX_INSTANCE_COUNT`, down from 1000. Nesting is 30 component levels
(`MAX_NESTING_DEPTH` 29), down from 100: measured against the kernel, whose JSON
reader refuses 31 levels when the deepest part is a freeform fin, and the test
pins that the importer's deepest file passes the kernel's nesting check while one
level more does not. The kernel gained the browser's 10,000-point freeform
ceiling. Shroud lines stay as they were (browser stricter, harmless).

### B9. Boundary details, low - FIXED 2026-10-04

`JsonLite.number()` scans a character class and hands the span to
`Double.parseDouble`, so `01`, `+0.3` and `.3` are accepted where `JSON.parse`
refuses them. A lone surrogate escape is accepted and re-emitted raw, so the payload
is not well-formed UTF-8 for any consumer that encodes it. Negative dimensions are
clamped by the kernel rather than refused, so `outerRadius:-1` builds and reports
`mass:0.0` with zero warnings. `appendSeries` does not escape the key it is handed
and is safe only because every caller passes a literal. `byCompName.getOrDefault`
guards an absent key but not a null value, and `escape(null)` would NPE.
`nextHandle++` has no overflow guard. `freeformfinset` `points` has no kernel-side
count cap.

**Verified good, do not re-litigate.** Every double emission goes through a
non-finite guard, and no unguarded double-to-JSON concatenation exists: the two
hand-built numeric paths are both pre-checked. `escape()` exists and every one of
the 13 file-sourced string fields goes through it, including component names,
warning texts and motor designations; the only unescaped emissions are closed enum
sets. There is no missing escape on a component name. `JsonLite` defends itself as
documented: duplicate key throws, unterminated string throws, trailing comma throws,
`1e999` throws, nesting throws at 64, input capped at 8 MiB, `\u` validates all four
hex digits, and `dbl`/`bool`/`str` throw on a present-but-wrong-typed key. Every
validated failure is byte-identical across both targets except B5.
`GuideClearanceListener` is clean, and the listener-instead-of-patch rationale
holds.

**FIXED 2026-10-04.** `JsonLite` accepts only JSON's number grammar (`01`, `+0.3`,
`.3`, `1.` and `1e` are refused) and refuses a lone surrogate escape while still
decoding a pair. Sizes, densities and masses are refused below 0 instead of
building a massless part; positions, angles, sweep and overhang stay signed.
`appendSeries` escapes its key, `escape(null)` and the component-name lookup are
null-safe, and the handle counter refuses to wrap. The freeform point cap landed
with B8. Each is tested against the rebuilt kernel and fails on the previous one.

---

## 🟢 Documentation drift and dead weight

The largest category by count, and given this repo's history the one most likely to
cause the next real bug.

- **The only committed prose spec is stale** (MED). `docs/rasaero/README.md`
  describes the superseded Phase-2 design for about 1,100 lines of original physics:
  the boat tail as a linearized strip blend that Phase 5 replaced with exact
  expansion-fan model, the fin airfoil blend that Phase 6 replaced, and the 1.8 factor as
  "calibrated to the ARCAS fins-on/off tunnel increment", which the code rebuts at
  length and ends with "Do not describe it as a junction term". It also names
  `BarrowmanCalculator.setSupersonicAero`/`setRogersKbf`, methods that exist nowhere,
  and says "Three independent opt-ins" over a four-row table that omits
  `stubbyNoseFloor`. The audit prompt names this file as the spec for deciding
  whether a hunk is deliberate.
- **The "reviewable diffs" are not reviewable** (MED).
  `docs/rasaero/diffs/aerodynamics_barrowman_FinSetCalc.java.diff` is a 2026-08-22
  snapshot of `engine-java/src/carved/java/...`, a path that no longer exists, at 423
  lines against the blessed 713. It contains none of `thicknessWave`,
  `sweepWaveFactor`, `betaEffThickness`, `nacaActive`, `applyStubbyNoseFloor`,
  `pmExpansionCp` or `calculateFleemanNoseInterpolator`. This is the only artifact
  that makes the hand-written physics reviewable without a manual diff. Fix:
  regenerate as part of `extract --bless`, or delete them and point at the
  `diff -u --strip-trailing-cr` command the README already documents.
- **The spec of record was never committed** (MED, VERIFIED). `docs/research/` does
  not exist. `docs/AUDIT_PROMPT_ENGINE.md` cites
  `docs/research/rasaero-supersonic-spec-2026-08-03.md`, and three validation
  fixtures (`arcas-short.json`, `basic-finner.json`, `hb2.json`) cite
  `docs/research/validation-anchors-2026-08-03.md` as the provenance for their
  geometry. That is the wind-tunnel anchor data the entire scorecard is measured
  against, and nobody can check it. This is the dangling-citation failure mode the
  comment audit already recorded.
  **FIXED 2026-10-04 for the citations that matter.** The three fixtures now name the
  published reports their geometry and anchors come from (NASA TN D-4013 and
  D-4014, DREV-TM-9703, AEDC-TDR-64-137, as recorded in `anchors.json`). A scripted
  existence check over every doc path the repo cites also found
  `docs/AUDIT_CODE_QUALITY.md` (dropped from `dev.yml`, whose comment already states
  why the workflow exists) and `docs/AUDIT_COMPONENT_COVERAGE.md` (dropped from two
  `CHANGELOG.md` entries). The RASAero spec citation is gone from
  `docs/AUDIT_PROMPT_ENGINE.md`; the one left in `docs/rasaero/diffs/` is part of
  that out-of-scope snapshot.
- **The LEDGER phase table is incomplete** (LOW). The 18-patch table, the stated
  authority for what each patch is for, lists FinSetCalc as "RASAero #4, #3, #1 Phase
  1" and SymmetricComponentCalc as "#1 Phase 1" only, while the files carry Phases 2,
  4, 5 and 6 plus the independent `stubbyNoseFloor` flag. Three of four physics
  phases and one of three flags are invisible in the table an upgrade reviewer uses.
- **Two marker spellings escape every grep** (LOW, VERIFIED). Counted directly: 32
  conforming `PATCH(kind)` markers, 33 total `PATCH(` occurrences, because
  `util/ArrayList.java:26` is `PATCH(astrarrocketjs, WASM-GC)`, the only one that does
  not fit `PATCH(<kind>)`. Separately there are **52** space-form `PATCH (` comments
  across `FinSet.java`, `FinSetCalc.java` and `SymmetricComponentCalc.java`, which
  are not markers under either convention. The 62-line RASAero airfoil API in
  `FinSet.java` survives re-extraction only because the file happens to carry a
  conforming marker elsewhere; a future override whose only hunk is spelled that way
  is reverted silently.
- **`teavm-format-g` is named nowhere in the LEDGER** (LOW), although the file
  promises "Every `PATCH(...)` comment in `src/java/` points here". The change is
  described; the marker string is absent, so a reader who greps for it concludes the
  hunk is undocumented.
- **`BoundingBox` is documented as using `Geo2D` and does not** (LOW). Three places
  say so; it imports nothing and simply deletes `update(Rectangle2D)` and
  `toRectangle()`. An auditor asking whether it still agrees with `java.awt.geom`
  reviews `Geo2D` and never learns two public methods were removed, which is also how
  the `%g` in P9 stayed unnoticed.
- **`LongUUID`'s javadoc describes defects the code does not have** (LOW). It states
  in the present tense that the most-significant half repeats every 2048 calls and
  that every id begins `01234567`. Both are true of a raw counter; the code runs the
  counter through SplitMix64 first. Measured on the actual source: 100,000 calls give
  100,000 distinct high halves and 99,998 distinct 8-hex prefixes. A reader is told
  the live code aliases `MotorConfigurationId`s, directly above the one method whose
  determinism parity depends on.
- **`build.gradle`'s WASM-GC block still reads as a spike** (LOW): "SPIKE: WASM-GC
  target ... Additive, the JS build and the shipped engine are untouched", while it is
  the default production backend. That is the one comment a developer reads before
  touching the wasm guardrails.
- **`UPSTREAM` cites a document that never existed** (LOW): "the hazard
  docs/AUDIT_ENGINE.md G11 named". The LEDGER admits of the same audit that "That
  audit's report was never committed". This file is that report; the citation should
  point at the LEDGER's own section. Verified separately: `engine.yml` does not exist,
  and the stale claim about it lives in `docs/AUDIT_PROMPT_ENGINE.md` and a dated
  LEDGER record, not in `UPSTREAM`, which already names `gates.yml` correctly. There
  is no second hardcoded copy of the ref: the SHA appears in `UPSTREAM`, two dated
  records, a generated file asserted equal to `UPSTREAM` by a test, and one
  illustrative doc comment in `website/src/components/UpstreamPin.tsx`, which reads
  `siteConfig.customFields`. That last one will nonetheless read as the old commit
  after a bump, in a file whose docblock says the ref should live in one place.
- **`web/src/tree/kernelDefaults.ts` misstates two rows and every citation** (LOW).
  `parallelstage: {}` plus "`stage`, `podset` and `parallelstage` read no dimensions
  there" is wrong: `applyAssembly` applies `count(node,"instanceCount",2,...)` to
  ParallelStage too, so the kernel default is 2. `finset.thickness: 0.003` is
  commented "Not a kernel default" when `ComponentFactory` defaults it to exactly
  that. Every line citation is stale by about 45 lines, which defeats the file's
  stated premise. Neither row is covered by `kernelDefaults.kernel.test.ts`.
- **`extract.mjs`'s own marker comment is wrong** (LOW): it says "Four of the 28
  markers in src/java use other tags" and enumerates three kinds, omitting
  the off-axis roll inertia kind. That comment is the stated rationale for the broad
  `/PATCH\(/` match, so a reader checking it could narrow the regex back.
- **`com.google.inject.Inject` is referenced by nothing** (LOW). A grep over
  `src/java`, `src/api` and `test` finds one injection-adjacent hit, a
  `getInjector().getInstance(...)` call, not `@Inject`. No extracted class depends on
  injection semantics. 13 lines of dead weight that the README counts in its "twelve
  files".
- **`validate:strict` can never pass** (LOW). Verified exit 1 in both modes on a
  pristine tree. `gates.yml` explains why `--strict` cannot be the gate, but the
  script stays advertised in `package.json` and the README with no note that running
  it always fails.
- **Shim default divergences that do not move a number yet** (LOW).
  `ApplicationPreferences` matches a fresh desktop install on all 20 preferences
  checked, with one deliberately inert setter. The three default materials match on
  density but carry a null `MaterialGroup` and, for Cardboard, a zero
  `inPlaneShearModulus` against upstream's 0.4e9. Those reach presets and legacy
  `.ork` reclassification only, so no mass or aero result moves, but
  `ComponentPreset` has an unguarded `material.getGroup()` deref that would NPE on
  the null, currently unreachable inside Java serialization. `Databases.findMaterial`
  returns `userDefined=false`/`documentMaterial=false` where upstream returns true for
  both, and `densityFor` switches on name only, ignoring `type`, and throws where
  upstream returns null. All of it matters at `.ork` export.
- **Two latent shim hazards** (LOW). `Simulation.getOptions()` returns an unrelated
  fresh `SimulationOptions`, which the simulation engine reads a stepper choice from;
  inert because the facade exposes no stepper knob, and the javadoc is honest.
  `Application` builds `new DebugTranslator(null)` and `checkIfKeyExists` would
  dereference the null delegate; no caller exists. `LongUUID.fromString` does not mask
  each group to its width where `java.util.UUID` does, so a non-canonical over-long
  group yields a different id than the desktop; canonical 8-4-4-4-12 strings, which is
  everything `.ork` writes, are bit-identical.

**Status, 2026-10-04.** Fixed: the dangling citations and the stale scorecards
(see G10 and the spec-of-record bullet above); `teavm-format-g` is named in the
LEDGER; `BoundingBox` is no longer described as using `Geo2D` (LEDGER row and
README); `UPSTREAM` no longer cites a misnumbered finding; the `build.gradle` WASM
block reads as the production backend it is; `LongUUID`'s javadoc describes the
mixed counter it uses, with the raw-counter defects stated as why the mixing is
required; `web/src/tree/kernelDefaults.ts` gives `parallelstage` its instance
count of 2 and every planar fin its kernel thickness of 0.003 (with
`componentDefaults.ts` reading it from there instead of calling it "not a kernel
default"), cites the `ComponentFactory` case for each row instead of line numbers,
and `kernelDefaults.kernel.test.ts` pins the four new values against the engine;
`extract.mjs`'s marker comment names every tag instead of a count; the unused
`com.google.inject.Inject` stub is deleted (the README now counts eleven shims);
`validate:strict` is documented as the goal that fails today, not a gate. Left
alone: the RASAero items (the prose spec, the reviewable diffs, the LEDGER phase
table, the space-form `PATCH (` comments in its code) are out of scope, and the
shim default differences and latent hazards are recorded behavior notes, not
defects to fix.

---

## △ UPSTREAM findings

Defects in OpenRocket, not ours. The fix belongs in a patch or upstream, never as an
in-place edit to `src/java`.

- **△ `InstanceMap` iteration order is not reproducible upstream at all.** Our
  `LinkedHashMap` gives insertion order, which is stable but is not upstream's order:
  upstream's `ConcurrentHashMap` buckets on `RocketComponent.hashCode()` which is
  `id.hashCode()` with `id = UUID.randomUUID()` minted per component per run. Four
  `total +=` sites in `BarrowmanDragCalculator` and two in
  `BarrowmanStabilityCalculator` iterate `entrySet()`, so drag and CP totals are
  order-sensitive and differ from any given desktop run at ULP level, unavoidably.
  Our patch is strictly better than what it replaced and the in-file comment is
  accurate. **The suspected mass and CG order dependence does not exist**:
  `MassCalculation` does a single key lookup, never a map iteration, and `emplace()`
  never stores a null, so the null-rejection difference is unreachable.
- **△ `FlightConfigurationId.isDefaultId()` and `hasError()` use reference `==`**,
  identically in upstream.
- **△ All string-named configurations on one mount alias to one motor id.**
  `FlightConfigurationId(String)`'s non-UUID fallback sets the most-significant bits
  to 0, and `MotorConfigurationId` keys on `(mountHash, msb)`. Identical upstream with
  `java.util.UUID`. Relevant when `.ork` configuration ids start being carried
  through rather than minted.

---

## Recommended order of attack

The prompt asks to front-load the patch diffs, because every other slice's severity
depends on what they turn up. They turned up **zero unexplained hunks**, airtight
gating and an exhaustive dispatch chain, so the order below reflects that result:
the patches are in better shape than the gates that are supposed to protect them.

**Steps 6, 7 and 9 are DONE too (2026-10-04):** G4, G5, G1 with G7, and P4 to P6.
**Step 8 is CLOSED, out of scope:** P2, P3, P7, P8 and G13 are defects in the opt-in
supersonic aero model, which nothing in the app enables. RASAero matters to this
project only as an export format (`.CDX1`), so its kernel aero model is not
maintained work. Step 10 (documentation) remains.

**Steps 1 to 5 are DONE (2026-10-04):** G2, G3, B2, P1, B1, B3 and G6, each marked
FIXED above with what was measured. The engine was rebuilt and the rebuild is
byte-reproducible.

**1. Close the two gate holes that let physics move invisibly.** G2
(`DIVERGENCE.txt` hashes, not counts) and G3 (`--expect-lines`). Both are small, both
are demonstrated, and until they land every other fix in this list can be silently
undone. G2 is the engine's exact counterpart to the vacuous fin guard in
`docs/AUDIT.md`, and the pair should be fixed together so the lesson lands once.

**2. B2, the trapezoid fin count.** One call site, routed through a helper that
already exists, closing a path where the most common fin type flies a rocket the
file did not describe. Then lower the browser ceiling to 8 in the same change.

**3. P1, the Collator stub.** Restrict `isVariable` to `-` and space, add the four
characters to the parity corpus, and re-record golden. This is a verified wrong sort
and a possible dropped motor on shipped data, and the corpus change is what stops it
recurring.

**4. B1 and B3, the two silent-success paths at the boundary.** A magnitude bound and
an `objList` that refuses a present-but-wrong-typed key. Both turn "all-null design,
zero warnings" into a named error.

**5. G6, the two uncovered component types.** Add a tube-fin and a rail-button design
to `ParityMain` and re-record. Cheap, and it closes the one coverage gap shaped
exactly like the bug this audit series exists to catch.

**6. G4 and G5, fixture and tolerance integrity.** Extend `_expect` past the bounding
box and pin the gated set by hash. Do these before touching any aero number, so a
score that moves afterward means something.

**7. G1, the parity variant.** Reach the harness through an `@JSExport` so the
compared binary is the shipped binary. Larger than the above and worth doing
properly; G7's wasm guard is the cheap partial mitigation to land first.

**8. The RASAero physics defects.** P3 (product-rule term) then P2 (roll damping),
both inside the opt-in path, both invisible to every current gate. G13's extended
golden sweep should land first so the fixes are measured rather than asserted.

**9. P4, P5, P6, the off-axis inertia cluster.** P4 is a one-line swap that also
removes a cross-backend divergence. P5 and P6 are a single coherent change: decide
whether lateral CG moves, and record the decision in the LEDGER either way.

**10. The documentation set.** Regenerate the reviewable diffs and the two current
scorecards, rewrite `docs/rasaero/README.md` to the shipped model, commit or
re-point the missing `docs/research/` citations, and fix the marker spellings. This is
last by urgency and first by likelihood of causing the next bug: four of the five
findings in this audit that were hardest to see were hidden by a document that said
something untrue. The validation fixtures citing an uncommitted anchors document is
the one to do first, because it is the provenance of every number the scorecard
reports.

**Deferred items, since done (2026-10-04):** G9, G11 (the checkable part), G12,
G14, G15, B7, B9 and P9 are fixed, each marked above.

**Deferred, with reasons (original plan).** G9's zero-slack floors are the right ratchet and should
stay until the one-copy refactor is worth doing. G11's golden tolerances want a
pinned recording platform first. G12, G14, G15 and the LOW boundary items are real
but none is urgent. The △ UPSTREAM findings need no action here beyond not
"fixing" them in `src/java`.

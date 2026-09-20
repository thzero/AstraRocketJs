# AUDIT_ENGINE - `engine-java/` engineering audit

**Date: 2026-09-19.** Companion to `docs/AUDIT.md`, which covers `web/` and puts
the kernel out of scope. Run per `docs/AUDIT_PROMPT_ENGINE.md`.

Severity markers: 🔴 correctness in shipped physics · 🟠 gates and build
integrity · 🟡 API boundary and untrusted input · 🟢 documentation drift and
dead weight.

**The standard this module is held to is "does it match OpenRocket".** Upstream's
behavior is the specification, not a candidate for improvement. Where OpenRocket
is arguably wrong and we reproduce it faithfully, that is the module working, and
it is not reported here. The only physics defects in this report are places where
**we deviate from upstream without meaning to**.

---

## Verification basis

**The pinned upstream was obtained.** `engine-java/extract/UPSTREAM` names
`thzero/openrocket` at `6deae50796af9356c6541c9d5e6306ebebe0186f`
(`release-22.02.beta.01-5683-g6deae5079`, committed 2026-09-17). That tree was
sparse-checked-out at that exact ref, and every patch finding below cites the
upstream line it diverges from. The same SHA also fetches from canonical
`openrocket/openrocket`, so the fork pin is content-identical and not a
provenance risk.

**Every gate hole below was demonstrated, not inferred.** Where a finding says
EXECUTED, the specific bad edit was made on a scratch copy and the gate was run
over it. The repository working tree is unchanged.

### What is verified genuinely clean

Stated up front, because these are the claims the module makes about itself and
they hold:

| Claim | Verdict |
| --- | --- |
| `manifest.txt` and `src/java` correspond exactly | **True.** 272 to 272, exact in both directions, every entry present upstream. |
| No unmanaged edit hides in `src/java` | **True.** Not one unpatched file differs from upstream. |
| All 16 patches are load-bearing, none is a leftover | **True.** Each one's `src/java` counterpart differs from upstream, and each patch is byte-identical to it. |
| `PATCH(` markers resolve to the ledger | **True.** 28 in `src/java`, 28 in `patches/`, all accounted for. |
| `gates.yml` pins the same ref as `UPSTREAM` | **True today.** Nothing enforces it (G11). |
| **No unexplained hunk in any patch** | **True.** 66 hunks classified across all 16 files; zero category (d). |
| Flags-off is bit-identical to stock Barrowman | **True through the seams.** `effectiveBaseCD` and `turbulentCompressibility` return upstream's expressions verbatim; all three flags default false in shim, facade and calc. The one flag-off divergence found is P1, a merge artifact rather than a seam leak. |
| `Geo2D.segmentsIntersect` reproduces `Line2D` | **True, exactly.** 1,679,616 exhaustive grid cases plus 500,000 random cases against JDK 21: zero differences, including endpoint-touching and collinear overlap. Freeform-fin self-intersection validation is unchanged. |
| The `instanceof` chains are exhaustive and correctly ordered | **True.** Every concrete aerodynamic class and every `ComponentAssembly` is matched; no sibling pair overlaps; `SymmetricComponent` and `ComponentAssembly` come last. `TubeFinSet` and `LaunchLug` are `Tube`, not `FinSet`, and both are handled. |
| `InstanceMap` order change does not move mass or CG | **True.** `masscalc` never iterates the map; it walks the component tree and reads per-component instance lists. The order does feed the Barrowman force sums, where it replaces an order that was *random per run* (upstream keys on `UUID.randomUUID().hashCode()`). Correct trade. |
| `ConcurrentLinkedQueue` to `LinkedList` is safe | **True.** No `new Thread`, no executor, no `parallelStream` anywhere in `src/java`, `src/shims` or `src/api`; both TeaVM targets are single-threaded. Neither iteration site mutates. |
| `"%g"` to `"%s"` reaches only a log | **True.** `BasicEventSimulationEngine.java:609`, a `log.info` argument, not parsed, not a key. |
| `PATCH(drogue-low-speed)` is upstream's own code uncommented | **True.** The five code lines are *context* lines in the diff, not additions. Only the comment markers were removed. |
| `SimulationOptions`' dropped `java.nio.file` subsystem is unreachable | **True.** The lookup classes are not extracted at all and are absent from the manifest; the live path builds `SimulationConditions` by hand. The opt-in supersonic model is not overridden. |
| `com.google.inject` is inert | **True.** Zero `@Inject` sites; no field upstream expects Guice to populate is now null. |
| `LongUUID` honors the `UUID` contract | **True** for `equals` / `hashCode` / `compareTo` / `toString` (200,000 random pairs, zero mismatches). Its *generator* is a separate matter, see A12. |
| Result-string escaping is correct | **True.** A quote, a backslash, a raw control character, U+2028 and a lone surrogate in a component name all survive `JSON.parse`. No unescaped user string reaches the output. |
| "Golden coverage stops at the atmosphere model" | **Refuted.** The 255 lines reach the full flight: mass/CG/MOI, 64 static aero rows at 1e-13, the complete event sequence, 29 trajectory samples through descent, dual deployment, two-stage. The real gaps are elsewhere (G4). |

**The headline result: the extraction mechanism is sound and the patch set is
clean.** Every hand edit is explained and every one is accounted for. The
findings below are not about undocumented tampering, because there is none.
They are about four other things: one merge artifact in the physics, one shim
default that silently disagrees with the desktop, a set of gates that are
narrower than they read, and an API boundary with no input discipline.

---

## 🔴 Correctness in shipped physics

**Scope note.** This section covers the **default path only**: the physics that
runs with every opt-in flag off, which is what the app ships and what every user
flies. Findings that require `supersonicAero`, `rogersKbf` or `stubbyNoseFloor`
to be switched on are quarantined in [Appendix R](#appendix-r--opt-in-supersonic-path-default-off)
at the end and are **not** in the order of attack.

Worth stating plainly, because it is the load-bearing result of the patch diffs:
**no flag-off path was found that diverges from upstream.** The `effectiveBaseCD`
and `turbulentCompressibility` seams return upstream's expressions verbatim, the
restructures that look like they could move a number cannot (the boat-tail
re-association is exact power-of-two scaling, and the nose guard rewrite is the
exact boolean negation of upstream's three early returns), and all three flags
default false in the shim, the facade and the calc. The two defects below are a
shim that never matched upstream and a helper that swapped one math function for
a different one. Neither has anything to do with the supersonic work.

### P1 · HIGH · ✅ FIXED 2026-09-19 · The shim's default wind model is dead calm where the desktop's is 2 m/s

`engine-java/src/shims/java/info/openrocket/core/preferences/ApplicationPreferences.java:137-142`
(upstream `.../preferences/ApplicationPreferences.java:588-596` and `:572-577`)

`getAverageWindModel()` returns a bare `new PinkNoiseWindModel()`: average 0 m/s,
standard deviation 0. Upstream's identical method calls `loadWindModelState()`,
which sets average 2.0 m/s, turbulence intensity 0.1 and direction pi/2.

The consumer is `MultiLevelPinkNoiseWindModel.addInitialLevel()`
(`src/java/.../models/wind/MultiLevelPinkNoiseWindModel.java:69-72`), which seeds
level 0 from these preferences. The **only** thing preventing wrong physics today
is one line, `ml.clearLevels()` at
`engine-java/src/api/java/api/OpenRocketEngine.java:1206`. Remove it, add a wind
profile whose lowest level sits above ground, or call `resetLevels()`, and the
browser flies 0 m/s on the rod where desktop OpenRocket flies 2 m/s at 10 percent
turbulence: different weathercocking, different drift, nothing in the UI to show
for it.

*Fix.* **Done 2026-09-19.** `loadWindModelState` reproduced in the shim, and
`ParityMain.preferencesScenarios()` now pins the result in `golden.txt` as
`prefs.wind|2.0|0.1|1.5707963267948966|0.2`. Upstream's `addChangeListener(this)`
is deliberately not reproduced: the shim has no change-event plumbing. See
`patches/LEDGER.md`, "Two shims stopped matching upstream".

### P2 · MED · ✅ FIXED 2026-09-19 · `Geo2D.distance` uses `Math.hypot` where `Point2D.distance` uses `sqrt`

`engine-java/src/shims/java/info/openrocket/core/util/Geo2D.java:22`
(upstream `.../rocketcomponent/FinSet.java:636`, `Point2D.Double.distance`)

`Point2D.distance` is literally `Math.sqrt(dx*dx + dy*dy)`. `Math.hypot` is not
the same function: on the JVM it is the FDLIBM scaled algorithm, while TeaVM
0.15.0's is `return sqrt(x*x + y*y)`. So the JVM parity reference and both
browser targets compute this call differently. Measured over 200,000 fin-scale
coordinate pairs on JDK 21: about 12 percent differ, worst relative 2.2e-16.

Note the polarity. **The browser build accidentally matches upstream exactly; the
JVM reference is the one that diverges from OpenRocket**, and `golden.txt`
therefore encodes hypot values while the shipped engine computes sqrt values. The
parity harness's ULP tolerance absorbs it by design, so the one gate that would
catch it is blind.

Latent today: the call site at `FinSet.java:710` feeds fillet segment length to
fillet volume to fin mass to CG to the whole trajectory, but `filletRadius` never
reaches the engine (`ComponentFactory` has no fillet field), so `FinSet.java:679`
short-circuits on every flight. It arms itself the day fillets are wired through.
The `FreeformFinSet.java:602` site is live but benign (compared against 1e-12).

*Fix.* **Done 2026-09-19.** Now `sqrt(dx*dx + dy*dy)`, with a javadoc note
saying why it must not go back to `hypot`. No existing golden value moved, which
confirms the latency analysis above: the fillet path short-circuits and the
freeform comparison against 1e-12 cannot flip on 1 ULP.

Note for whoever wires fillets through: a golden line would **not** protect this.
Static lines are held to 1e-13 relative and a 1-ULP change is ~2e-16, so a revert
to `hypot` would pass the gate. The javadoc is the guard.

---

## 🟠 Gates and build integrity

The governing insight holds and is worth restating, because five findings below
are consequences of it: **`parity` proves the compile, not the source**, and
**`extract --check` proves the file contents, not the edits**. Between them they
read as "the engine is verified." What they actually verify is narrower.

### G1 · HIGH · ✅ FIXED 2026-09-19 · A coordinated `patches/` plus `src/java` edit passes `--check` green

`engine-java/extract/extract.mjs:158`

`problems = missing + drift + stale + unpatched` deliberately omits `behind`, and
`behind` is the only signal for the one wrong-tree class the checker accepts by
construction: **any content is legal in `src/java` as long as a byte-identical
`patches/` file exists.**

EXECUTED on a scratch copy: adding
`patches/info/openrocket/core/masscalc/MassCalculation.java` (a copy of the
current file plus an arbitrary line) together with the matching `src/java` edit
gives `extract --check: OK`, exit 0. Same for a hunk appended to an existing
patch. The only trace is one extra line in a `console.warn` list that already has
16 entries and no exit code.

The `reproducible` job at `gates.yml:153` then certifies "src/java is exactly
upstream(+patches)" for a kernel that silently diverges from OpenRocket.

*Fix.* Commit the per-patch divergence numbers as a machine-readable baseline
(`extract/DIVERGENCE.txt`, one `path delta` per line, regenerated by an explicit
`--bless`) and add `behind` **mismatches** to `problems`. It cannot gate on
"nonzero" (every patch differs by definition) but it can gate on "moved without
being blessed", which is exactly the review step `UPSTREAM:5-7` asks a human to
perform.

### G2 · HIGH · ✅ FIXED 2026-09-19 · A deletion-only patch scores delta 0 and vanishes from the report entirely

`engine-java/extract/extract.mjs:136-139`

The `behind` delta is not a diff. It is a line-multiset containment count, and
`if (delta) behind.push(...)` drops any patch scoring 0. A change composed only
of deletions, or reorderings of lines whose exact text occurs elsewhere in the
file, scores 0 and the patch disappears.

EXECUTED: added `patches/info/openrocket/core/util/MathUtil.java` equal to the
current file minus the single `count++;` at `src/java/.../util/MathUtil.java:278`
(the identical line also exists at `:293`), plus the matching `src/java` edit.
Result: exit 0, `MathUtil` appears nowhere in the output, and the header still
reads "16 patch(es) differ from current upstream". The 17th patch is invisible,
and `MathUtil.average()` now returns `avg / 0` = Infinity.

This also silently understates every real divergence number, including the ones a
human is told to review on an upgrade.

*Fix.* Use a real LCS diff (or `a.length + b.length - 2*commonPrefixSuffix`), and
report every patch unconditionally including delta 0. A patch byte-identical to
upstream is exactly the leftover `LEDGER.md:32` says to delete, so 0 is
information, not noise.

### G3 · HIGH · ✅ FIXED 2026-09-19 · Deleting `golden.txt` turns the physics gate off, silently

`engine-java/test/parity/parity.mjs:252-253`

A missing `golden.txt` is a `console.warn` and exit 0. The only thing in this
module that checks the SOURCE rather than the compile can be removed with one
`git rm` and CI stays green. `gates.yml` contains no reference to golden at all.

EXECUTED on a stubbed-IO copy whose comparison and golden code is byte-identical
to source: golden absent, real output, exit 0, `parity ok: 255 lines` plus a
stderr warning nobody reads. Combined with G9: JVM empty plus target empty plus
golden absent gives exit 0 and `parity ok [js]: 0 lines`.

*Fix.* One line. `console.error(...); process.exit(1)` unless `--golden` was
passed.

### G4 · HIGH · ✅ FIXED 2026-09-19 · Roll aerodynamics has zero coverage in either gate

`engine-java/test/parity/ParityMain.java:904` and `:939`

`CrollForce` / `CrollDamp` / `Croll` is shipped, user-facing physics with no
coverage anywhere. The `aero.forces` line prints CN, Cm, CD, CDaxial, pressureCD,
baseCD, frictionCD and no roll term; **no parity design sets a cant angle at all**
(verified: zero occurrences of `cant` or `Croll` in `test/parity/*.java`), so
`FinSetCalc:325` multiplies by `cantAngle = 0` and every roll quantity is
identically zero in all 255 golden lines. `validation/score.mjs:82-99` knows only
cd, cp and cna, and `anchors.json` has no roll quantity.

EXECUTED: halving the roll forcing in `FinSetCalc.java:325` gives exit 0,
`parity ok [js]: 255 lines`, `parity ok [wasm]: 255 lines`,
`golden ok: 255 reference value(s) unchanged`. Source restored, tree verified
clean.

This is not obscure physics. `ComponentFactory.java:169,180,189` reads a `cant`
key for all three fin-set types, the web app round-trips it, and
`OpenRocketEngine.java:970-974` ships `CrollForce` and `CrollDamp` to the aero
view specifically so a user can check that a cant is doing what they meant. And
the file that computes it, `FinSetCalc`, is the most heavily patched and most
upstream-divergent file in the tree. **The highest-risk code in the kernel sits
in the one place neither gate looks.**

*Fix.* About 15 lines: a canted-fin scenario in `ParityMain` printing roll across
Mach and roll rate, plus roll added to the `aero.forces` field list.

### G5 · HIGH · ✅ FIXED 2026-09-19 · `score.mjs --strict` passes on an empty anchor set

`engine-java/validation/score.mjs:130,134`

`if (strict && gatePass < gateTotal)` is `0 < 0`, false. EXECUTED in a sandbox:
`anchors.json` reduced to `{"_readme":[...]}` (still valid JSON, the shape a
truncated or half-written file takes) reports `Gate points: 0/0 within tolerance
(NaN%)` and `--strict` exits 0. Same with every `gate` flipped to false.

*Fix.* `if (gateTotal === 0) { console.error(...); process.exit(1); }` before line
130, and print `NaN%` as `n/a`.

### G6 · HIGH · ✅ FIXED 2026-09-19 · ✅ FIXED 2026-09-19 · Validation has never gated anything

`.github/workflows/gates.yml` (no validation step anywhere)

Nothing in CI runs `npm run validate`. The parity job proves JS equals WASM
equals JVM and that the committed binaries match `src/java`; **none of that
compares the engine to a measured number.** `score.mjs` needs no JDK and no build
(it imports the committed vendored `.mjs` directly) and runs in 0.46 s. The gate
has been failed open for free.

The harness itself is still correct: running it reproduces the README's live rows
exactly (classic 9/135, supersonic 61/135). `--strict` is **not** usable as-is
(exit 1, 9/135). What it takes: add `--min <n>` and `--expect-gates <n>` to
`score.mjs` (about 4 lines), then two steps beside the existing jobs:
`node validation/score.mjs --expect-gates 135 --min 9` and the same with
`--supersonic --min 61`. A ratchet, not a pass/fail, and `--expect-gates` also
closes G14 for free.

### G7 · MED · ✅ FIXED 2026-09-19 · A golden rewrite reaches review as 255 unexplained lines

`engine-java/test/parity/parity.mjs:249-251`

`--golden` writes the data with no header, no date, no git SHA and no hash, and
it **skips the comparison entirely**, so it never prints what moved. A
hand-edited `golden.txt` (one number changed so a regression passes) is
indistinguishable from a real regeneration, and nothing catches it.

This is the documented recording mechanism, so the trade-off is deliberate. But
the LEDGER's own instruction ("say in the commit why the numbers moved") is an
honor-system convention with no enforcement, on the single flag that can make a
genuine regression disappear.

*Fix, three parts, all in `parity.mjs`.* (1) `--golden` writes a first line
`# golden v1 sha256=<hex> generated=<ISO> commit=<sha>`; `norm()` strips `#`
lines. (2) Every non-`--golden` run recomputes the hash and fails on mismatch,
which catches a hand-edited golden. (3) `--golden` runs the comparison **first**
and prints the N values it is about to overwrite, so the regeneration transcript
names the change.

### G8 · MED · ✅ FIXED 2026-09-19 · The golden tolerances leave a measured blind band

`engine-java/test/parity/parity.mjs:177-180,191-192,201`

The golden comparison reuses the cross-platform tolerances: 0.5 percent relative
on every `flight.*` line, 5 percent on every `flight.conditions.*` line. MEASURED
by perturbing golden copies and running the real comparison code: `flight.*`
+0.49 percent passes, +0.6 percent fails; `flight.conditions.*` +4.9 percent
passes, +5.5 percent fails. Static lines are genuinely tight (`aero.cp` +1e-12
gives 32 failures).

So apogee 330.68 m can move plus or minus 1.65 m, max velocity 0.57 m/s, flight
time 0.51 s, every event time 0.5 percent, and the 5 percent band
`flight.conditions` apogee (363.4 m) 18 m, all silently. Terminal velocity goes
as Cd^-0.5, so a 1 percent error in recovery-device drag moves every descent line
by under 0.5 percent and passes.

Justified for cross-OS ULP drift (worst observed 1.9e-3), but it is 2.5x that and
it is applied to a same-machine JVM-versus-committed-file comparison that does not
need the headroom.

*Fix.* Split the constants: keep 5e-3 and 5e-2 for the cross-platform check, use
about 3e-3 and 2e-2 for golden.

Separately, `ABS_TOL_FLIGHT = 1e-4` at `:178` is an OR-escape: line 201 fails only
if **both** the absolute and relative tests fail, so any flight quantity may move
1e-4 absolute regardless of scale. EXECUTED: +9e-5 on every field of every
`flight.sample.*` line gives `golden ok`. The descent samples carry accelerations
around 5.9e-4, so that is a 17 percent free change in descent-phase net
acceleration, and `flight.sample.0` is all zeros so every field there is
unconstrained.

### G9 · MED · ✅ FIXED 2026-09-19 · Empty output compares equal to empty output

`engine-java/test/parity/parity.mjs:216,233`

`Math.max(jvm.length, out.length)` with both empty gives n = 0, zero iterations,
zero failures, `parity ok: 0 lines`. EXECUTED on a stubbed-IO copy. Today
`golden.txt` is the only thing that catches it, which is why G3 is HIGH.

The rest of this path is solid and resisted attack: no sentinel gives exit 1 with
a per-cause message; ETIMEDOUT, signal death and non-zero exit each report
distinctly; a partially-flushed stdout cannot happen because `run-target.mjs`
buffers everything through one `fs.writeSync` before the sentinel; a target that
prints an error and exits 0 still has to match the JVM line for line; the
`EXCEPTION:` hard failure works.

*Fix.* Two lines: `if (n === 0) { console.error(...); process.exit(1); }`.

### G10 · MED · ✅ FIXED 2026-09-19 · Shims are outside `extract --check` entirely

`engine-java/extract/extract.mjs` (no reference to `src/shims`)

Five shims shadow classes upstream also defines (`startup.Application`,
`preferences.ApplicationPreferences`, `database.Databases`, `document.Simulation`,
`document.OpenRocketDocument`) and **nothing compares them to upstream**.
`--check` walks `src/java` against the manifest; `gates.yml` never mentions
shims. The 2026-09-18 bump re-extracted six drifted manifest files and did not
look at a single shim.

This is exactly the failure mode the LEDGER documents for patches, still wide
open for shims, and it has already produced a live divergence: **P1**.

*Fix.* A shim-drift report in `extract.mjs`: for each shadowed FQN, compare
upstream's public signatures and default-returning expressions, and at minimum
print "upstream `<FQN>` changed since `<UPSTREAM ref>`".

### G11 · MED · ✅ FIXED 2026-09-19 · The pinned ref is written twice with nothing comparing them

`engine-java/extract/UPSTREAM:9` and `.github/workflows/gates.yml:142`

`extract.mjs` never reads `UPSTREAM`; it takes whatever `--src` hands it. The two
agree today only because someone repinned both by hand. Bump `UPSTREAM` and
forget `gates.yml` and CI checks out the old ref, reports about 200 drifted files
and blames the tree rather than the pin. Bump `gates.yml` only, the silent case,
and CI is green while `UPSTREAM` lies and every local `--check` run against the
documented ref reports phantom drift. The same file's stale
`.github/workflows/engine.yml` claim (D4) is the symptom of this duplication
already going unreviewed.

*Fix.* Two lines. Have the `reproducible` job read the ref out of `UPSTREAM` into
`$GITHUB_OUTPUT` and pass it to the checkout. Optionally have `extract.mjs`
`rev-parse HEAD` on the source and fail on mismatch.

### G12 · MED · ✅ FIXED 2026-09-19 · `-Pparity` compiles a different program than the one that ships

`engine-java/build.gradle:59-61,93,114`

The headline risk does **not** apply: `-Pparity` changes no numerics-relevant
setting. `optimization = NONE` and `fastGlobalAnalysis = true` are unconditional
and `obfuscated = false` on both targets. What it changes is the program:
`mainClass` becomes `parity.ParityMain` and the whole `test/` tree joins
`sourceSets.main`.

That matters because `fastGlobalAnalysis` is class-hierarchy analysis over the
**reachable** set, and `README.md:103-105` records the concrete bug it works
around: TeaVM under-linking virtual methods reached only via map-key dispatch.
The parity variant's reachable set is strictly larger, so it is the variant where
under-linking is *least* likely to bite, while the shipped variant's set is never
bit-compared against anything. A method linked in the parity build and pruned in
production passes every gate and then mis-dispatches in the browser.

Mitigating, and worth stating: `ParityMain` drives the real facade
(`buildRocket`, `getStaticInfo`, `simulateJson`, `getAeroSweep`,
`JsonLite.parseObject`), so the shipped API surface and its double-to-string
formatting are covered.

*Fix.* Run the production JS and WASM modules through one identical scenario
after the production build and compare, or have `build-engine.mjs` assert the
production build's exported-function list against a committed expectation. Either
way, correct `README.md:140`, which reads as if the parity harness validates the
shipped binary.

### G13 · MED · ✅ FIXED 2026-09-19 · The toolchain is not pinned under a byte-diff gate

`.github/workflows/gates.yml:56` and `engine-java/build.gradle:87`

`java-version: '21'` resolves to the newest Temurin 21.x at run time and the
Gradle toolchain pins only `JavaLanguageVersion.of(21)`: no vendor, no exact
version, and no `distributionSha256Sum`. The gate at `gates.yml:121` rebuilds and
runs `git diff --exit-code` over three committed binaries, assuming the whole
toolchain reproduces bytes.

Whenever Temurin ships a 21.0.x with a javac codegen change, the next PR touching
nothing in `engine-java` fails with a 2.9 MB unreadable binary diff and no hint
that a JDK bump caused it. That is the failure mode that teaches people to re-run
a job and then ignore it. `LEDGER.md:180` records the evidence as "verified by
building each target twice", which is same-machine, same-JDK determinism only;
the gate runs on `ubuntu-latest` while developers vendor the artifacts from
Windows and macOS.

Not executed (no build was run). What was verified: none of the three artifacts
contains an embedded absolute path, build date or `sourceMappingURL`, so the
obvious nondeterminism sources are absent.

*Fix.* Pin the exact JDK and vendor, and make the failure legible: print
`java -version`, `git diff --stat` and a one-line hint separating "you edited Java
and forgot `build-engine.mjs`" from "the rebuild was not reproducible".

### G14 · MED · `score.mjs` trusts `anchors.json` and the fixtures

`engine-java/validation/score.mjs:41,64,67,102,109`

`gateTotal` is whatever the file happens to contain; nothing asserts the
documented 135. EXECUTED: truncating every series to its first point gives
`Gate points: 4/11` with no warning; deleting two entries gives `4/40`, no
warning. Handled correctly and loudly: unparseable JSON, a missing `points`
array, an unknown `quantity`, a missing fixture. A null or Infinity anchor scores
FAIL. So the one real hole is **silent shrinkage of the gate set**, which
`--expect-gates` (G6) closes.

Fixtures are worse. EXECUTED: setting the `hb2.json` nosecone `length` to
`"abc"`, `null` or `1e999` each produced a complete scorecard, score moving
9/135 to 8/135, no diagnostic. With `"abc"` the printed model length was 0.3761 m
instead of 0.3675 m: the kernel's JSON reader fell back to a default and the
harness reported the result as an HB-2 measurement. **A corrupt fixture is
indistinguishable from a one-gate physics regression.**

*Fix.* Carry an `"_expect": {"length": ..., "refDiameter": ...}` in each fixture
and assert it after `buildTree`. About 5 lines, and it also catches a kernel
change that breaks fixture parsing.

### G15 · MED · ✅ FIXED 2026-09-19 · The divergence baseline the upgrade procedure relies on is already stale

> **Closed 2026-09-19.** The hand-maintained table is deleted (not refreshed):
> `LEDGER.md`'s reproducibility section now points at the generated, gated
> `extract/DIVERGENCE.txt`. The deletion also surfaced that every divergence
> figure written before 2026-09-19 came from the old multiset counter and is
> not comparable to the LCS baseline, which is now stated in the ledger so
> nobody tries to reconcile "~108" against 155.

`engine-java/patches/LEDGER.md:137`

The table records `FinSetCalc.java | ~586`; today's `extract --check` reports
about 548 (EXECUTED). The table lists 5 patches; the live report lists 16. The
numbers moved by 38 lines through the NACA-1307 adoption and the record was never
updated.

This is the direct evidence that "review the differ-from-upstream report"
(`UPSTREAM:6-7`) is a ritual, not a control, and every finding above that ends in
"a human is supposed to read the warning" rests on that same mechanism.

*Fix.* Folded into G1: the baseline file replaces the hand-maintained table,
`--bless` regenerates it, and a moved number becomes a red gate.

### G16 · MED · ✅ FIXED 2026-09-19 · The `Collator` stub is not PRIMARY-equivalent, and neither gate can see it

`engine-java/src/jdkstubs/java/text/Collator.java:22-28`

`compare()` approximates PRIMARY strength with `compareToIgnoreCase` plus a
case-sensitive tiebreak. Real `Collator.getInstance(Locale.US)` at PRIMARY treats
`-` and space as fully ignorable. Measured against JDK 21 over realistic
designations: 30 of 576 sign differences including genuine **order reversals**,
not just ties ("AeroTech" vs "A-P": jdk -1, stub +1; "H128W" vs "H128-W": jdk 0,
stub +1).

`DesignationComparator` and `ThrustCurveMotor.compareTo` are both linked into the
shipped artifact. Nothing calls them today (the kernel has no motor database), so
no output moves. But `ParityMain` has no motor-sorting scenario and the golden has
no sorted-motor row, so if a motor list is ever surfaced from the kernel, desktop
and browser sort differently and nothing fails.

*Fix.* Either drop `DesignationComparator` and `ThrustCurveMotor.compareTo` from
the manifest as unreachable dead weight, or add a `ParityMain` scenario that
prints a sorted designation list so the gate sees the stub.

### G17 · MED · ✅ FIXED 2026-09-19 · The `Collator` stub is missing `setDecomposition`, invisibly

`engine-java/src/jdkstubs/java/text/Collator.java:48-50`

`src/java/.../util/AlphanumComparator.java:51-52` calls `setDecomposition` and the
three decomposition constants; the stub has neither. It compiles because
`build.gradle:37-55` puts jdkstubs in a **separate source set**, so the main
compile resolves `java.text.Collator` from the real `java.base` and javac can
never see the gap. Only TeaVM linking can.

`AlphanumComparator` is currently pruned (verified: zero occurrences in the
vendored `.mjs`, against 24 for `DesignationComparator`), so the hole is dormant.
Extract one more file that sorts with it, or let CHA link it under
`fastGlobalAnalysis`, and the browser build gets a `NoSuchMethodError` on a path
the JVM parity run executes fine.

*Fix.* Add the no-op `setDecomposition(int)` and the three constants, and add a
compile check that every `Collator` member the kernel references exists in the
stub.

### G18 · LOW · ✅ FIXED 2026-09-19 · Remaining build and extractor items

| Item | Detail |
| --- | --- |
| `extract.mjs:123` | The `unpatched` counter matches the literal `'PATCH(astrarrocketjs'`, missing 4 of the 28 markers. EXECUTED: a fake `PATCH(teavm-uuid)` with no patch file gives `unpatched = 0` but `drift = 1`, exit 1. Strictly subsumed by drift and stale, so no tree passes because of it; only the diagnostic degrades. `README.md:95` and `LEDGER.md:122` describe it differently. Match `/PATCH\(/` and reconcile the docs. |
| `extract.mjs:102,122` | The `stale` and `unpatched` walks filter on `.endsWith('.java')`. EXECUTED: `src/java/.../notes.txt` gives exit 0, `OK`. Nothing compiles it, so it is cosmetic, but "exactly upstream(+patches)" is not literally true of the directory. |
| `extract.mjs:77` | `norm()` strips CRLF, so a CRLF tree passes `--check` while a real extraction would rewrite all 272 files to LF. Mitigated by `.gitattributes` `eol=lf`. **Leave it**: the normalization is the right call and the `.gitattributes` pin is the real control. |
| `gradle-wrapper.properties:3`, `build.gradle:33-35` | No `distributionSha256Sum` and no `gradle/verification-metadata.xml`. Versions are all exact and the wrapper jar is validated, so exposure is a republished artifact rather than a floating one. Worth noting the byte-diff gate would actually catch a compromised TeaVM, an unusual and genuine mitigation. One-time fix: `./gradlew --write-verification-metadata sha256 help`. |
| `gradle-wrapper.properties:5` | `retries=0` with a 10 s timeout. One transient blip fetching the distribution fails the `parity` job outright. Set `retries=3`. |
| `settings.gradle:1` | No toolchain resolver, so Gradle cannot auto-provision. A developer on 17 or 25 gets "No matching toolchains found" rather than "install a JDK 21", and `build-engine.mjs:16`'s "whatever the Gradle wrapper resolves" is misleading. |
| `build-engine.mjs:99-106` | The post-build check is `existsSync` only. The parity and production variants write to the **same** output paths, and `npm run parity` then `npm run build` is the normal local sequence and the one `gates.yml:97-121` runs in a single job. CI's byte diff catches a stale vendor, so the cost is a confusing red gate rather than a bad ship. Assert mtime, or grep the emitted JS for the expected export list. |
| `golden.txt:237` | Not byte-reproducible from a fresh JVM run on this machine: `flight.para.summary` differs by about 3e-9 (EXECUTED, the only difference in 255 lines). Well inside the band, but the LEDGER asserts run-to-run byte identity as part of the argument for the tolerance, and on this line it does not hold. Do not tighten below about 1e-8 on the strength of that claim. |
| `golden.txt:197` | `flight.conditions.summary`'s fourth field is permanently `NaN` (the scenario caps `maxTime` at 8 s, before ground hit) and `linesMatch` compares `'NaN' === 'NaN'` as strings. A gate column that structurally cannot move. |
| `ParityMain.java:54-56,253` | `nozzleBaseDragScenarios()` is defined and commented out of `main()`. `validation/README.md:136` records the matching gap on its side with a stated reason (deferred migration to upstream's native `nozzleExitDiameter`). A legitimate documented deferral; the risk is only that the dead method rots. |
| `ParityMain.java:703-710` | The twelve extended flight series (stability, CP/CG travel, in-flight drag, thrust, AoA) are checked for **length only**, with plus or minus 25 slack. Those are the numbers the app plots. About 5 lines adds sampled values. |

---

## 🟡 API boundary and untrusted input

`src/api/` is the entire trust boundary between the browser and the kernel, and
every finding here is against original code with no upstream restraint. All of
these were reproduced by running the shipped artifacts
(`web/src/engine/vendor/openrocket-engine.mjs` and
`web/public/engine/openrocket-engine.wasm`) under Node; quoted outputs are
actual.

### A1 · HIGH · ✅ FIXED 2026-09-19 · ✅ FIXED 2026-09-19 · `simulateJson`'s handle lookup and JSON parse sit outside its own try

`OpenRocketEngine.java:1135-1136`, try at `:1252`, catch comment at `:1259-1264`

The handle lookup and `JsonLite.parseObject` are about 117 lines **above** the
try, so the `catch (RuntimeException)` never sees them, while its comment
explicitly claims it does. Verified: `simulateJson(99999,"{}")` throws
`JavaError: Unknown handle: 99999`; `simulateJson(h,"{oops")` throws
`JSON: expected '"' at 2`. `openRocketEngine.ts:1043` only handles
`parsed.error`, so a stale handle or a malformed options blob is an opaque throw
from a 2.9 MB bundle, which is the exact failure mode the comment says was fixed.

*Fix.* Move the body into `simulateJsonImpl` and wrap the public method the way
`getStaticInfo` and `getAeroSweep` already are.

### A2 · HIGH · ✅ FIXED 2026-09-19 · ✅ FIXED 2026-09-19 · `getAeroSweep`'s point-count guard divides, so a tiny step hangs the tab

`OpenRocketEngine.java:798-806`

The guard is `(machMax - machMin) / machStep > MAX_SWEEP_POINTS`. With
`machMax == machMin` the numerator is 0, so any step passes, and `m += machStep`
makes no progress when `machStep < ulp(machMin)`. Verified:
`getAeroSweep(h,'{"machMin":0.05,"machMax":0.05,"machStep":1e-300}')` grows
`machList` until V8 reports "Reached heap limit" in under a second at a 400 MB
cap. `machMin == machMax` is a real call pattern
(`web/src/services/buildRocket.ts:84`). This is the same tab-killing class the
guard at `:791-793` was added for.

*Fix.* Compute the count as an integer first,
`long pts = (long) Math.floor((machMax - machMin) / machStep) + 1`, reject
`machStep <= 0 || !isFinite(machStep) || pts > MAX_SWEEP_POINTS`, and iterate
`machMin + i*machStep` by index rather than accumulating.

### A3 · HIGH · ✅ FIXED 2026-09-19 · ✅ FIXED 2026-09-19 · `instanceCount` is uncapped at the factory

`ComponentFactory.java:657`

`ring.setInstanceCount((int) dbl(node, "instanceCount", 2))` with no bound, and
`PodSet.setInstanceCount` only floors at 1 while `PodSet.getInstanceOffsets`
allocates an array plus one `Coordinate` per instance **on every mass, aero and
step call**. Verified: a podset with `instanceCount` 100000 takes 4.2 s for one
`getStaticInfo` (the app calls it per keystroke) and reports 406 kg; `1e999`
parses to Infinity and `(int) Infinity` is 2147483647, an immediate OOM.

`MAX_INSTANCE_COUNT = 64` exists **only** on the JS side
(`web/src/tree/nodeProps.ts:33`) and is applied only in `PropertyPanel` and the
three renderers. `orkImport.ts:536` writes the raw file value into the tree and
nothing clamps it before `buildRocket`.

*Fix.* Clamp or reject in `ComponentFactory`, and give `FinSet`'s implicit 1 to 8
clamp a matching explicit check so the boundary owns it rather than the kernel.

### A4 · HIGH · ✅ CONTAINED + TESTED 2026-09-19 · WASM-GC has no JS-error envelope; the JS target does

`web/src/engine/vendor/openrocket-engine.mjs:515` vs
`web/public/engine/openrocket-engine.wasm-runtime.js:444`

The JS target converts any native JS error caught inside a Java try into a
`java.lang.RuntimeException`, so `catch (RuntimeException e)` swallows stack
overflow and allocation failure. WASM-GC has no equivalent: a wasm trap is not a
`WebAssembly.Exception` carrying the `teavm.javaException` tag, so no Java catch
sees it.

Verified with the identical call: a 6000-deep options JSON gives
`{"error":"(JavaScript) RangeError: Maximum call stack size exceeded"}` on JS
(recoverable) and a raw `RangeError` out of the module on WASM-GC (not). Same for
cast failures: JS returns an `{"error": ...}` envelope, WASM-GC returns
`{"error":"ClassCastException"}`. **The app ships WASM by default, so the target
actually running is the one with no recovery.**

*Fix.* Do not rely on `catch (RuntimeException)` for resource exhaustion. Bound
depth, sweep points and instance counts before they can exhaust anything, and add
a WASM-GC leg to the boundary tests; `engineBoundary.test.ts` exercises only the
JS build.

### A5 · MED · ✅ FIXED 2026-09-19 · ✅ FIXED 2026-09-19 · `JsonLite` has no recursion depth cap

`JsonLite.java:42-53,55-75,77-93`

`value()` / `object()` / `array()` recurse with no counter. The only depth cap in
the system is `web/src/services/orkImport.ts:22` (`MAX_NESTING_DEPTH = 100`), on
the JS side, for the XML walk only. Verified:
`buildRocket('{"components":' + '['.repeat(N) + ']'.repeat(N) + '}')` survives
N=3500 and dies at 4000 on JS, survives 3000 and dies at 6000 on WASM-GC. A Web
Worker stack is smaller, so the sim worker blows first. Not reachable from a
hostile `.ork` today only because `orkImport` caps XML nesting; any other caller
of the facade has no cap at all.

*Fix.* A depth field incremented in `object()` and `array()`, throwing past about
64. That makes the facade self-defending rather than dependent on one JS-side
caller.

### A6 · MED · ✅ FIXED 2026-09-19 · ✅ FIXED 2026-09-19 · `1e999` becomes Infinity silently and StaticInfo comes back all null with no error

`JsonLite.java:124-131`

`number()` slurps the numeric characters and hands the slice to `Double.valueOf`,
which maps exponent overflow to Infinity with no error. (It does correctly reject
bare `NaN` and `Infinity` literals; leading zeros are silently accepted.)
Verified: a body tube with `"length":1e999` builds, then `getStaticInfo` returns
`{"length":null,"mass":null,"cg":null,"cp":null,"cna":null,"stabilityCalibers":null,...}`
with **no `error` key**. `openRocketEngine.ts:953` checks only `parsed.error`, so
fields typed `number` arrive as null and flow into the stability strip and the 3D
view.

*Fix.* `if (!isFinite(d)) throw err("finite number")` in `number()`, and have the
StaticInfo reader assert the required fields are finite.

### A7 · MED · ✅ FIXED 2026-09-19 · ✅ FIXED 2026-09-19 · `appendEvents` emits the raw event time, and one Infinity discards the whole flight

`OpenRocketEngine.java:1451`

`.append(ev.getTime())` is the **one** numeric emission in the serializer without
the NaN and Infinity guard that `num()`, `nums()` and `appendSeries()` all apply.
Verified: `setMotorIgnitionById(h,'mount','launch',Infinity)`
(`openRocketEngine.ts:926` forwards `delayS` unvalidated, unlike
`assertFiniteCurve` which guards every motor scalar on the same class) produces
`"time":Infinity`, and `JSON.parse` fails with
`SyntaxError: Unexpected token 'I'`, discarding a 1200 s flight. A NaN delay
happens to be caught by the kernel; Infinity is not.

*Fix.* Route the event time through `num()`, and validate ignition and separation
delays for finiteness at the facade the way `applyMotor:401-418` already does for
the curve.

### A8 · MED · ✅ FIXED 2026-09-19 · Handles are untyped and all 14 call sites blind-cast

`OpenRocketEngine.java:112-118`

`get(int)` returns `Object`; nothing checks the handle's kind. The facade assumes
a discipline `openRocketEngine.ts` does not enforce: the wrapper's generation
guard catches a handle from a reset engine but never one of the **wrong type**.
Verified: `newRocket()` then `addTrapezoidFins(rocketHandle, ...)` gives
`TypeError: $this.$checkState is not a function` on JS, because the checkcast is
elided at `optimization = NONE` and a wrong object is used and fails later, and
`JavaError: (could not fetch message)` on WASM-GC.

*Fix.* Store handles as a typed record, or add
`private static <T> T get(int h, Class<T> k)` that throws a named exception. The
elided-cast behavior means a JS-target mismatch can read the wrong object rather
than fail.

### A10 · MED · ✅ FIXED 2026-09-19 · Void and primitive exports cannot use the error envelope

`OpenRocketEngine.java:754-763` and the class comment at `:90-98`

`getWorstThetaDeg` returns a primitive and has no try/catch, so it is
structurally incapable of the `{"error": ...}` envelope the class comment
documents as the contract. Same for `buildRocket:174`, `setMotor:384`,
`setMotorById:300`, `setMotorIgnitionById:466` and the five `addX` methods.
`openRocketEngine.ts:992` calls `worstThetaDeg` with no try, so a rocket the CP
sweep cannot evaluate throws out of TeaVM: the exact regression `:90-98` says was
fixed for the other four.

*Fix.* Document a "throws" contract for these in the README **and** have the
wrapper rethrow a named `Error`, so the two halves agree.

### A11 · MED · ✅ FIXED 2026-09-19 · The `Simulation` shim's `getOptions()` is detached from the conditions

`src/shims/java/info/openrocket/core/document/Simulation.java:37-42`
(upstream `.../document/Simulation.java:537-538`)

Upstream guarantees `getSimulation().getOptions()` **is** the options that
produced the conditions, via `c.setSimulation(this)`. The shim lazily creates a
brand-new unrelated `SimulationOptions`. `BasicEventSimulationEngine.java:71`
reads `getSimulation().getOptions().getSimulationStepperMethodChoice()` to pick
the integrator. Today the facade exposes no stepper knob so it always lands on
RK4; the moment anyone adds `"stepper":"rk6"` and sets it on conditions, the
engine silently keeps running RK4 with no error. Side effect: each throwaway
options object runs `new Random().nextInt()` and builds two wind models on every
simulate.

*Fix.* Give the shim a
`Simulation(Rocket, FlightConfigurationId, SimulationOptions)` constructor and
pass the options `OpenRocketEngine.java:1159` is about to mirror onto conditions.

### A12 · MED · ✅ FIXED 2026-09-19 · `LongUUID.randomUUID` discards four bits, so the msb repeats every 2048 calls

`src/shims/java/info/openrocket/core/util/LongUUID.java:35`

`(a & ~0xF000L) | 0x4000L` over a counter advancing by 2 per call discards bits
12 to 15, so the msb repeats every 2048 calls (measured). `java.util.UUID` draws
122 random bits and never does this. `MotorConfigurationId.java:39-41` keys solely
on `(mountHash << 32, fcid.key.getMostSignificantBits())`, so two
`FlightConfigurationId`s created 2048 apart in one session produce **identical**
`MotorConfigurationId`s on the same mount, silently aliasing two configurations in
the motor map. Unlikely, but it is an entropy loss `java.util.UUID` does not have.

Related and cosmetic: because the counter starts at `0x0123456789ABCDEF` and only
the low bits move, every id's first 8 hex digits are `01234567`, which is exactly
what `FlightConfigurationId.toShortKey()` returns. The one field meant to tell
configurations apart in a log tells you nothing.

*Fix.* Mix the counter into the high bits, e.g.
`(a << 4 & ~0xFFFFL) | 0x4000L | (a & 0xFFF)`, keeping determinism. That closes
both.

### A13 · LOW · ✅ FIXED 2026-09-19 · Remaining API items

| Item | Detail |
| --- | --- |
| `JsonLite.java:112-115` | The `\u` escape does `Integer.parseInt(..., 16)` with no validation. Verified: `"x\u-123y"` builds and silently injects U+FEDD into the component name; `"\u12"` throws `StringIndexOutOfBoundsException`, not the `IllegalArgumentException` every other `JsonLite` error throws. `escape()` re-emits the garbage char, which `JSON.parse` accepts, so it persists into the `.ork` on the next save. |
| `JsonLite.java:164-177`, `:69` | `dbl` / `bool` / `str` return the fallback for a **wrong-typed** value rather than complaining, and a duplicate key silently overwrites. Verified: `{"type":"bodytube","length":"0.9",...}` builds a 0.3 m tube (the factory default) with no warning. A lax exporter that quotes numbers produces a physically different rocket and reports success. Keep the fallback for an absent key; throw on a present-and-wrong-typed one. |
| `ComponentFactory.java:355,411,413` | Counts and geometry reach constructors unchecked. Verified: a parachute with `lineCount` 1e9 reports mass 300000 kg with `warnings: 0`; a body tube with `outerRadius` -0.05 builds silently at mass 0. Fin count is safe only by accident (`FinSet.setFinCount` clamps to 1 to 8). |
| `OpenRocketEngine.java:182-183` | A non-list `"components"` is coerced to an empty list. `buildRocket('{"components":"nope"}')` returns a handle and reports an all-zero rocket rather than an error. |
| `OpenRocketEngine.java:909` | Two `machAlt` rows with the same Mach divide by zero, giving Infinity altitude, NaN atmosphere and every CD written as null, while `nonFinite` (counted only over the per-component loop) still reports 0. The consumer's documented signal that the table is incomplete reads clean for a sweep in which nothing is usable. |
| `OpenRocketEngine.java:84-88,126-137` | No per-handle free; `reset()` is the only release. Bounded in practice (the three live callers reset before every build), but `OpenRocketDesign.buildTree` is public and does not, so a direct caller in a long-lived tab leaks a whole `Rocket` per build. The deliberate no-rewind of `nextHandle` is the right trade-off and the wrapper's generation counter correctly turns the aliasing it prevents into a loud `StaleDesignError`. Add a `free(int)` export. |
| `Databases.java:30-59` | Three deviations from upstream: `findMaterial(type, name)` **throws** for an unlisted name where upstream returns null; the density overload returns `userDefined = false` where upstream returns `(group, true, true)`; a DB hit upstream carries `inPlaneShearModulus` and the shim always yields 0. All eight densities are verbatim-correct, so mass is right, and the other two fields are read only by branches that cannot fire. The **throw** is the live risk: any newly extracted component defaulting to a material outside the 8-name list gets a hard exception at construction where the desktop gets null. |
| `LongUUID.java:41-55` | `fromString` accepts an over-long final group the JDK rejects (13 hex digits). Otherwise exact (200k fuzzed pairs, zero mismatches). `FlightConfigurationId.java:43-52` relies on the throw to fall back to a hash, so a malformed `configid` in an `.ork` that the desktop hashes into a distinct id silently parses to a different id in the browser: the reference breaks rather than degrading identically. |
| `ShimRocketDescriptor.java:21` | `format()` returns the name verbatim; upstream runs every `RocketSubstitutor`, and `MotorConfigurationSubstitutor` is what turns `"[{motors}]"` into `"[C6-5]"`. Neither substitutor is extracted, so substitution is structurally impossible and any unnamed configuration's name is the literal template. Confined to logs today. |

### A14 · ✅ FIXED 2026-09-19 · The default-divergence table

There is **no shared defaults table anywhere.** `web/src/tree/schema.ts` says so
itself ("default nodes ... became dead exports") and `nodeProps.ts` holds only
`MAX_INSTANCE_COUNT`. Four tables were written independently, which is why they
disagree. These are the fields where the same missing key gets a different
answer:

| type.field | ComponentFactory | `treeEdit.defaultNode` | `orkImport` | renderers | consequence when the key is absent |
| --- | --- | --- | --- | --- | --- |
| `masscomponent.radius` | 0.005 | not set at all | 0.005 | 70% of parent radius | **Live today** for every editor-added mass component: drawn at about 9 mm on a 13 mm tube, flown at 5 mm |
| `podset.instanceCount` | 2 | 1 | 1 | 2 | **Live today**: a pod node with the key stripped flies as 2, draws as 2, and the editor says 1 |
| `streamer.stripLength` | 0.5 | 0.4 | 0.5 | 0.4 | Descent drag area differs from the drawing by 25% |
| `railbutton.outerDiameter` | kernel default | (unset) | 0.0097 | 0.004 | Three different button sizes across file, drawing and engine |
| `bodytube.thickness` | 0.0003 | 0.0005 | 0.0005 | 0.0005 | CF alone is 40% thinner: lighter airframe, wrong CG |
| `transition.thickness` | 0.002 | 0.0005 | 0.002 | - | Editor-added transition is 4x thinner than the engine assumes |
| `engineblock.thickness` | 0.00095 | 0.0005 | 0.001 | - | Three-way disagreement on one field |
| `nosecone.aftRadius` | 0.012 | 0.013 | 0.012 | 0.012 / 0.009 | Four values for one field |
| `launchlug.length` | 0.05 | 0.03 | 0.05 | 0.05 | Editor-added lug is 40% shorter than the engine assumes |
| `bulkhead.length` | 0.002 | 0.003 | 0.003 | - | CF alone is 33% thinner |
| `centeringring.length` | 0.002 | 0.003 | 0.002 | - | Editor and engine disagree |
| `nosecone.thickness` | 0.002 | 0.001 | 0.002 | - | Editor and engine disagree |
| `innertube.thickness` | 0.0005 | 0.0004 | 0.0005 | - | Editor and engine disagree |
| `transition.length` | 0.05 | 0.05 | 0.04 | - | Import and engine disagree |

Mostly latent, because `defaultNode` and `orkImport` write every key explicitly.
They bite a node that has **lost** a key: a hand-edited or older persisted design,
a partial node from a future editor path, or an `.ork` tag the desktop omits. The
first two rows are live now.

*Fix.* One defaults table generated from `ComponentFactory`, or a JSON constant
both sides import. Not four hand-maintained ones.

---

## 🟢 Documentation drift and dead weight

> ✅ **All resolved 2026-09-19** except where a row says otherwise.
> The two that were not cosmetic: **D7**, third-party code with no stated
> license in a GPL-3.0 redistribution, and **D6**, an undocumented third
> physics flag whose javadoc named the wrong gate. Details in
> `patches/LEDGER.md`.

| # | Where | Drift |
| --- | --- | --- |
| D1 | `engine-java/README.md:22,38` | "15 carry overrides" and "~255 are byte-for-byte upstream". Actual: **16** and **256**. `LEDGER.md` is correct at 16; the README was not updated when `MassComponent` was deleted. The README is the first thing the upgrade procedure tells you to read, and it disagrees with the ledger about how many hand edits exist. |
| D2 | `engine-java/README.md:41-49` | Package table says 41 `simulation` and 18 `aerodynamics`. Actual: **42** and **19**. |
| D3 | `engine-java/patches/LEDGER.md:203` | "the 280-entry manifest". 280 is the **line count**; 8 are comments and there are **272** entries. An auditor counting entries to check the correspondence gets a mismatch that is not there. |
| D4 | `engine-java/extract/UPSTREAM:5` | Says CI pins the ref in `.github/workflows/engine.yml`. **That file does not exist**; the `parity` and `reproducible` jobs are in `gates.yml`. Confirmed. This is the visible symptom of G11. |
| D5 | `engine-java/patches/LEDGER.md:46` | The `FinSet` row gives the reason as only the `Geo2D` swap. The patch's **dominant** content is a 62-line RASAero airfoil API (`FinSet.java:282-348`) that `FinSetCalc.java:136-139` reads in its constructor. An auditor reading the ledger's own index classifies `FinSet` as a mechanical import swap and skips it, which is exactly how that file would be the one to hide a physics change; and a reviewer told it is "just the AWT swap" who re-extracts it verbatim breaks the `FinSetCalc` compile, the same failure shape the 2026-09-16 reconciliation documented for `setStubbyNoseFloor`. `:138` also still says "~46 lines"; the real figure is about 69. |
| D6 | `SymmetricComponentCalc.java:710-711` and everywhere else | **`stubbyNoseFloor` is a third physics flag documented nowhere.** Its javadoc says it is gated on `rogersKbf` or `supersonicAero` "exactly like FinSetCalc's extensions"; the code gates on an independent `stubbyNoseFloor` flag (`:83`, `:713-718`) wired at `RASAeroDragCalculator.java:86` and exposed on the facade at `OpenRocketEngine.java:523`. The field's own javadoc at `:76-81` says the opposite of `:710`. The flag appears in **no** markdown in the repo. Someone auditing "flags off means bit-identical" checks the two documented flags and never learns a third exists. (The code is correct: flag-off is bit-identical.) |
| D7 | `engine-java/ATTRIBUTION.md:17-20,29-40` | Names mmrocket-sim as the author of the RASAero extensions but states **no license** under which that work is redistributed here. The engine ships GPL-3.0, and incorporating another project's code with an unstated license is the one licensing defect a redistributor cannot resolve after the fact. The two files that actually carry the third-party authorship, `RASAeroDragCalculator.java` and `RASAeroStabilityCalculator.java`, are absent from the "What's here" list. `stubbyNoseFloor` is also missing from the enumeration of non-OpenRocket extensions. |
| D8 | The four patched aero files | `FinSetCalc` carries about 600 changed lines and `SymmetricComponentCalc` about 310 of original work, and neither header says so: `SymmetricComponentCalc` still presents only `@author Sampo Niskanen` and `FinSetCalc` no authorship at all, while the two shims do name mmrocket-sim. GPL-3.0 section 5(a) asks a modified file to carry a prominent notice that it was changed and the date; the `PATCH(...)` markers say a change was made but carry no date. |
| D9 | `FinSetCalc.java:597-610`, `:677` | The 2026-09-16 merge moved `calculateBodyFinInterferenceFactor` and left its javadoc behind as an orphaned block above a different method; the relocated method has none. Upstream's paragraph explaining that `getAOA()` is unsigned and that the negative-angle check is a defensive guard was deleted with no replacement, which is upstream's own explanation of a guard a future editor could "simplify" away. Pure noise in the next upstream re-audit diff. |
| D10 | `docs/rasaero/README.md:128-135` | The base-drag cap and the Van Driest II fade are attributed to `BarrowmanCalculator.calculateFrictionCD`. Both now live on the seams in `BarrowmanDragCalculator.java:511-523`, overridden in `RASAeroDragCalculator.java:97,112`; `BarrowmanCalculator`'s patch was deleted on 2026-09-16. The formulas themselves match the doc exactly, so this is a pointer problem. |
| D11 | `engine-java/validation/*.md` | The five committed scorecards are 2026-08-04 snapshots saying 7/135 and 64/135; the live figures are 9/135 and 61/135. The README is admirably honest about this (`:39` literally says "file says 7/135"), so it is a stated trade-off, but the committed scorecards are the artifact a reader reaches for and they are wrong in **both** directions. |
| D12 | `OpenRocketDocument.java:10-17` | The javadoc claims components store user materials into the document preferences. They cannot: `Rocket.setDocument` is never called anywhere, so `getDocument()` is permanently null and every call site short-circuits. Doubly dead because the shim `Databases` returns `documentMaterial = false`. Not a bug, but the shim's own documentation asserts a behavior the build cannot reach. |
| D13 | `Application.java:18,62-64` | `getTranslator()` returns a bare `DebugTranslator`, so every kernel string comes out as `[Warning.RECOVERY_HIGH_SPEED]`. This is **deliberate and load-bearing**, not an oversight: `web/src/services/warningText.ts` parses exactly that bracket format and its tests assert it. A good trade (stable machine keys instead of untranslatable English). The hazard is that nothing in the shim says so, so "fix the translator to match upstream" is a one-line change that would silently break every warning string in the UI. |
| D14 | `Geo2D.java:13` | The only shim in an `info.openrocket.core.*` package with no `SHIM:` marker in its javadoc. A reader diffing against upstream finds a class that "upstream deleted" and may try to restore `java.awt.geom`. (Upstream carries no per-file license headers either, so the absent GPL header is consistent and not itself a defect.) |
| D0 | `InstanceMap.java:15-27` | The patch comment reads as if swapping `ConcurrentHashMap` for `LinkedHashMap` eliminated order-dependent accumulation module-wide. It did not, and could not: `activeMotors` is filled from a plain `HashMap` keyed off a random-UUID hash (`FlightConfiguration.java:728-731`), and `MassCalculation.java:460` accumulates motor mass and CG in that order, so a design with two or more active motor configurations still varies at ULP level run to run. That is upstream's design and we match it correctly; only the comment overclaims. Scope the claim to the aero sums. |
| D15 | `engine-java/README.md:3`, `ATTRIBUTION.md:3`, `extract/UPSTREAM:11` | Both docs say "a post-24.12 development build" while `UPSTREAM`'s own `describe` reads `release-22.02.beta.01-5683-g6deae5079`. The commit is dated 2026-09-17 so it **is** newer, but the one human-readable provenance string contradicts the prose. Also: nothing records **why** a personal fork rather than canonical `openrocket/openrocket` is the source, and the SHA fetches fine from canonical, so the fork buys nothing and costs availability (if it is deleted or force-pushed and GC'd, the `reproducible` gate goes permanently red with no copy of the baseline in this repo). |

---

## What both gates miss

The single most valuable answer this audit produces, and it is demonstrated
rather than argued:

**A change to fin roll aerodynamics.** Halve the roll forcing at
`FinSetCalc.java:325`, or change `rollInterferenceFactor`, or
`calculateDampingMoment`. Doing exactly that and running the real harness gives
`parity ok [js]`, `parity ok [wasm]`,
`golden ok: 255 reference value(s) unchanged`, exit 0.

The three blindnesses do not overlap in the usual way, which is why nothing
catches it:

- **Parity** cannot see it by construction. It proves the compile, and three
  targets agree on the halved value.
- **Golden** cannot see it because no parity design has a canted fin set, so the
  roll terms are identically zero before and after, and because no golden line
  prints a roll quantity even if one were non-zero.
- **Validation** cannot see it because `score.mjs` knows only five quantities and
  `anchors.json` has no roll anchor. Even wired into CI tomorrow, the score would
  not move.

A close second: **any change inside a `patches/` file, provided `src/java` moves
with it** (G1 and G2). The extraction gate accepts it by definition, parity
compiles it faithfully to three targets, and golden catches it only for values
the 255 lines happen to print.

---

## Appendix R · Opt-in supersonic path (default-off)

**None of this runs unless a flag is switched on**, and nothing in the app turns
one on by default. It is recorded for completeness and is deliberately excluded
from the order of attack. R1 is the only one that would be a HIGH finding if the
flag were on; R2 to R4 are LOW either way.

### R1 · The Rogers `Kbf` carryover double-counts on the fallback interference leg

`engine-java/src/java/info/openrocket/core/aerodynamics/barrowman/FinSetCalc.java:352`
(upstream `.../barrowman/FinSetCalc.java:204` and `:540-543`)

`Kbf` is suppressed by `rogersKbf && !supersonicAero && !nacaActive && tau > 0`,
and `nacaActive` is set **only inside** `if (nacaWeight > 0.0)` (`:306`). On the
fallback leg (`:309-310`, `cna = fallbackCna`) it stays false. But after the
2026-09-16 merge that leg is no longer the pre-merge `cna *= 1 + tau`: upstream's
`calculateBodyFinInterferenceFactor` returns `pow2(1 + tau)` for
`mach <= CNA_SUBSONIC` (ours `:693-696`, upstream `:542-543`), which already
contains the body-in-fin carryover. `Kbf` then adds `tau * cna` on top, giving
`(1+tau)^2 * (1+tau)` where the slender-body total is `(1+tau)^2`.

**The fallback leg is not an edge case.** `createBodyFinInterferenceModel`
(upstream `:471-475`) returns null unless the fin set is a `TrapezoidFinSet`
whose parent is a `BodyTube`, so **every `EllipticalFinSet` and every
`FreeformFinSet` takes it**, as does any fin set on a transition or nose cone,
any geometry with `radiusSemispanRatio > 0.6` (the fat-body case where `tau` is
largest), and any trapezoid fin above 20 degrees AoA.

Concretely: elliptical fins, `tau = 0.6`, `rogersKbf` on, M0.5. Fin-set CNalpha
comes out 4.10x the isolated value instead of 2.56x, a 60 percent overstatement.
The fin set's weight in the CP average grows by 1.6x and its carryover is placed
forward at the root quarter chord, so whole-rocket CP moves well aft and the
reported static margin is too large. A marginal design reads stable. The same
double count applies partially across the transonic blend; only above
`CNA_SUPERSONIC` = 1.5, where the factor is `(1+tau)` alone, is `Kbf` still right.

`LEDGER.md`'s 2026-09-16 entry claims this is closed. **The claim is true for the
NACA leg and false for the fallback leg.**

*Fix.* Gate on the fallback factor's own body content rather than on
`nacaActive`: suppress whenever `calculateBodyFinInterferenceFactor(tau, mach) >
1 + tau`, or restate `Kbf` as the deficit
`pow2(1+tau) / calculateBodyFinInterferenceFactor(tau, mach) - 1`. Simplest
defensible option is to retire the `Kbf` CNalpha term entirely now that upstream
carries the load in both legs, keeping only its drag-side effects.

### R2 · Transonic CNalpha bridge scales the endpoint derivative by a constant

`FinSetCalc.java:747-750` (upstream `:608-609`)

The bridge scales the supersonic endpoint *derivative* by
`sscale = ssaeroScale(CNA_SUPERSONIC)`, but `ssaeroScale(M)` is itself
Mach-dependent; the true slope is `sscale' * f + sscale * f'`, and `sscale'` is
order 0.5 for aspect ratio around 2. With `supersonicAero` on, CNalpha stays
continuous at M1.5 but has a slope kink, and the `PolyInterpolator` cubic over
M0.9 to 1.5 is fitted to a wrong end slope, so it can overshoot inside the band.
Flag-off is unaffected: `sscale` is exactly 1.0 and the multiply is
bit-preserving.

*Fix.* `superD = sscale*f' + dScale*f` with `dScale = 2M / (2*ar*beta^3)` at
`CNA_SUPERSONIC`, or take a numerical slope from two nearby Mach numbers.

### R3 · The `turbulentCompressibility` seam skips the perfect-finish branch

`BarrowmanDragCalculator.java:232-240` (upstream `:223-231`)

The seam replaced only the second `c2` assignment (ours `:261`). The
perfect-finish branch's `c2` at `:238` is still hard coded, so with
`supersonicAero` on the Van Driest II fade never applies to a rocket whose
`isPerfectFinish()` is true. At M5, Re > 3e6, non-perfect finish gets 0.370 and
perfect finish keeps 0.828: the flag's supersonic friction correction silently
disappears for polished airframes.

Defensible, because upstream's perfect-finish `c2` is a partially-laminar fit
rather than the turbulent one VD-II replaces. But the `RASAeroDragCalculator`
javadoc reasons carefully about `isPerfectFinish` for the un-ported
`partialLaminar` change and does not extend that reasoning here.

*Fix.* One sentence in the `turbulentCompressibility` javadoc stating the
perfect-finish branch is deliberately out of scope, or a matching
`laminarCompressibility` seam.

### R4 · `FinSet.copyFrom` omits the four RASAero airfoil fields

`FinSet.java:1624-1638` against the fields the same patch adds at `:291-294`
(upstream `:1550`, which has no such fields)

`copyFrom` is an explicit field-by-field copy and skips `airfoilSection`,
`airfoilLeDiamond`, `airfoilTeDiamond` and `finLeRadius`, against the in-file
contract at `RocketComponent.java:192` ("All fields must be copied"). A load or
undo through `Rocket.loadFrom` would silently revert a supersonic-configured fin
set to classic pressure drag. Unreachable today (nothing calls `Rocket.loadFrom`),
and upstream already omits `filletRadius` there, so the patch follows a
pre-existing local pattern rather than inventing one.

*Fix.* Add the four assignments.

---

## Recommended order of attack

The patch diffs came first and came back clean on the default path, which is what
makes the rest of this list orderable. Nothing here involves the supersonic
extensions.

**1. Fix the two live physics defects. ✅ DONE 2026-09-19.** Both shims now match
upstream, `ParityMain.preferencesScenarios()` pins the preference defaults, and
`golden.txt` went 255 to 259 lines as four pure additions with no existing value
moved. Parity clean on both targets, `extract --check` OK, `web/` green at 1394
tests. Details in `patches/LEDGER.md`.

**The list below is therefore now led by the gates**, which is the right shape:
the reason these two defects sat unseen is that nothing compares a shim to the
class it shadows (G10), and the reason a third could is G1 and G2.

**2. Close the extraction gate's two real holes: G1 and G2.** They are the reason
a defect like step 1's could enter the tree unseen, and the reason a future one
could. Both land in one change: a real diff for the delta, a blessed
`extract/DIVERGENCE.txt` baseline, `behind` mismatches counted in `problems`, and
G15's stale ledger table deleted in favor of the generated file. Everything else
in the gates section is about gates being narrower than advertised; this is about
a gate being bypassable.

**3. Make the physics gate hard to switch off, then widen it. ✅ DONE 2026-09-19.**
G3, G7, G9, G5 and G4 are all closed. A missing `golden.txt` fails; the file
carries a sha256 re-verified on every run, so a hand-edit fails; `--golden`
compares before it overwrites and says what it moved; empty output is a failure;
a zero-size gate set fails with or without `--strict`. `ParityMain.rollScenarios()`
sweeps cant against Mach and roll rate, and the previously-invisible regression
(halving the roll forcing) now fails with 27 moved values. `golden.txt` is 335
lines. Details in `patches/LEDGER.md`.

Still open from this step: **G6**, wiring `validate` into CI. The flags it needs
now exist (`--min`, `--expect-gates`, added with the G5 fix) and it runs in under
a second with no JDK, so it is two steps in `gates.yml`. **G14**'s fixture
`_expect` assertions are also still open; `--expect-gates` covers the anchor-set
half of that finding but not the corrupt-fixture half.

**4. Give the API boundary an input discipline. ✅ DONE 2026-09-19.** A1, A2,
A3, A5, A6 and A7 are closed, plus the `\u` escape, duplicate-key and
wrong-typed-value holes from A13, and G6 rode along. All 13 exploits were
re-run against the **shipped** artifact and are dead.

A4 is not so much fixed as designed around: WASM-GC has no JS-error envelope
and WASM is what ships, so the inputs are bounded rather than the exceptions
caught. Details in `patches/LEDGER.md`.

Still open on this boundary: **A8** (untyped handles, and the checkcast is
elided at `optimization = NONE`, so a wrong handle reads the wrong object),
**A10** (void and primitive
exports structurally cannot use the envelope), **A12** (`LongUUID.randomUUID`
entropy), and **A14**, the defaults table below.

**5. Reconcile the defaults (A14). ✅ DONE 2026-09-19.** Probing the engine
corrected this finding: `podset.instanceCount` is NOT live (`defaultNode` sets it
explicitly), and `railbutton.outerDiameter` IS, which the table missed entirely.
Both live rows fixed, `web/src/tree/kernelDefaults.ts` added, and
`kernelDefaults.kernel.test.ts` locks all fourteen to the engine behaviorally
with a per-case sensitivity assertion. The 224 call sites were deliberately NOT
rewritten. Details in `patches/LEDGER.md`.

**6. Close the shim blind spot (G10) and the `Collator` items (G16, G17). ✅ DONE
2026-09-19.** `extract/SHIMS.txt` records a hash of each shadowed upstream class
and `--check` fails when one moves, demonstrated with the exact edit that caused
P1. The `Collator` stub gained its missing members, stopped sharing one
strength-less singleton, and was rewritten to match the JDK exactly: 22 of 1369
mismatched pairs before, 0 of 1369 at all four strengths now, with
`ParityMain.collatorScenarios()` holding it there. Details in
`patches/LEDGER.md`.

**7. Documentation, in one pass. ✅ DONE 2026-09-19.** All of D0-D15.
The two that mattered beyond tidiness: D7 (the mmrocket-sim work is now
recorded as incorporated under GPL-3.0, and the four heavily modified aero
files carry section 5(a) notices) and D6 (`stubbyNoseFloor` documented, and
its javadoc no longer names a gate it does not use).

**8. Build hardening (G12, G13, G18). ✅ DONE 2026-09-19.** The toolchain
is pinned by vendor and exact version, the byte-diff step says which of its two
causes fired, `build-engine.mjs` refuses to vendor a build missing a facade
export or containing `ParityMain`, and the wrapper retries a cold-cache blip.

**Remaining open:** **G14** (fixture `_expect` assertions), left at the owner's
direction.

**A4** is closed as far as it can be. It is not fixable in Java - you cannot
catch a wasm trap - so it is contained by bounding the inputs, and that
containment is now TESTED against the shipped WASM build in
`web/src/engine/engineBoundary.wasm.test.ts`. Until today every engine test in
`web/` loaded the JS build, so the suite vouched for a backend nobody runs. **Appendix R** is
out of scope by decision. Everything else in this report is closed.

**G11** is now enforced: the `reproducible` job reads the repo and ref out of
`extract/UPSTREAM` instead of carrying a second copy. **G15**'s stale table is
deleted in favor of the generated `DIVERGENCE.txt`. **A11** cannot be wired
without a stepper option to wire, so the shim now documents the upstream
invariant it breaks and what to do when one is added.

**Not scheduled.** Appendix R, the RASAero work - the four opt-in supersonic
findings plus **R5**, the unfinished `fairing` component, which the owner
identified as part of the same effort on 2026-09-19. Nothing else is
deferred: every remaining item is either a deviation from upstream, a gate that
does not do what it says, or an API boundary that trusts input it should not.

### R5 · `fairing`, an unfinished RASAero component the kernel used to reject

`ComponentFactory.java:434-435`, `web/src/engine/openRocketEngine.ts:426-429`

`'fairing'` is a declared `ComponentType` whose comment says "the editor's
`engineTree()` lowers a fairing to a kernel strake-fin + CD/mass overrides before
buildTree". **`engineTree` does not exist anywhere in `web/src`** (verified).
`orkImport.ts:450` produces `{type:'fairing'}` nodes and `orkExport.ts:540`
writes `<fairing>` back, so a design containing a fairing round-trips through our
own file format and then fails to build at all: `buildRocket` throws
`Unknown component type: 'fairing'`, no static info, no simulation. The renderers
draw it, so the UI is consistent right up to the point the engine refuses.

Found independently by two slices.

*Fix.* Implement the lowering, or accept `fairing` as a mass and CD override
component. At minimum delete the stale comment and make the message name the
app-level type.

**Reclassified 2026-09-19.** The owner identified `fairing` as RASAero-scope
work, which puts it in this appendix rather than in the API chapter.

Worth recording because the audit got the framing wrong: this was reported as a
user-visible break, and it is not one, because **nothing can create a fairing**.
`ALLOWED_CHILDREN` has no entry, `defaultNode` has no case and `componentFields`
gives it no property panel, so it appears only in a design loaded from a `.ork`
this app itself wrote. The renderers draw it and import/export round-trip it,
which is what made it look like a live feature.

The kernel now accepts it as a mass-carrying component instead of throwing, so
such a file loads. Drag is still not modelled, and that is deliberate: finishing
it means deciding whether camera shrouds are a feature at all before deciding
which OpenRocket primitive supplies the frontal-area drag. Provenance is marked
in `ComponentFactory`, `openRocketEngine.ts`, `schema.ts`, `orkImport`,
`orkExport` and `ATTRIBUTION.md`.


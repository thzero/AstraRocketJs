# Cross-platform flight-parity determinism

**Status:** understood and accepted (not a bug). Flight-only parity tolerances were widened during the
OpenRocket *unstable* (26.xx) migration — see "Resolution" below. Static/instantaneous physics remains
bit-identical.

This note is the diagnostic record behind the tiered tolerances in
[`engine-java/test/parity/parity.mjs`](../engine-java/test/parity/parity.mjs) and the summary in
[`engine-java/README.md`](../engine-java/README.md) → *Cross-platform flight determinism*.

## Symptom

The parity test (`node engine-java/test/parity/parity.mjs`) runs the same `ParityMain` battery on the
reference JVM and on the TeaVM-compiled JavaScript engine and requires matching output. After the
migration from OpenRocket 24.12 to unstable:

- **Every static / instantaneous calculation stayed bit-identical** (within `1e-13`, i.e. JS `Math`
  ULP): CP, CNα, drag decomposition, mass, CG, atmosphere, quaternion math — including all of the
  RASAero supersonic extensions.
- **37 of 255 lines failed, all `flight.*`** (time-integrated trajectory summaries, event times, and
  sampled state). On the smooth reference flight the JVM and JS apogee differed by ~1.2 ms in time and
  ~0.2 mm in altitude.

## Investigation

1. **The JVM is byte-identical run-to-run.** Running the JVM reference twice (`gradlew parityJvm
   -Pparity`) produced 0 differing lines. This rules out identity-hash iteration order (a `HashMap` /
   `HashSet` keyed by `RocketComponent`, which has no `hashCode()` override, iterates in per-process
   identity-hash order on the JVM). The determinism patch that makes `InstanceMap extends LinkedHashMap`
   (see `patches/LEDGER.md`) is doing its job. So the divergence is genuinely JVM-vs-JS, not JVM
   nondeterminism.

2. **Instantaneous physics is bit-identical**, so the seed is not in the aero/mass/atmosphere math —
   those are exercised directly by static scenarios and match to `1e-13`.

3. **The sample *times* diverge, not just the values.** At "sample 50" the recorded times were
   `1.5440097665502694` (JVM) vs `1.5440100341322693` (JS) — a 2.68e-7 s difference. So the two builds
   are at slightly *different points in time*, i.e. the sequence of integration time-steps has drifted.
   Most of the apparent altitude difference at a given sample is just that time offset × velocity.

4. **Root cause: the adaptive RK4 step-size selection is ULP-sensitive.**
   `RK4SimulationStepper.step()` chooses each time-step as `min(dt[i])` over several limiting factors,
   with threshold comparisons (`if (dt[i] < store.timeStep)`, `if (Math.abs(maxTimeStep - store.timeStep)
   < minTimeStep)`, etc.). The JVM and JS compute the `dt[i]` to ~15 digits identically, but occasionally
   a ~1e-15 cross-platform `Math` difference tips *which* limit is smallest, so one side takes a very
   slightly different step. Over thousands of steps these tiny timing differences accumulate, and the
   **deliberately under-damped apogee turn** ("higher damping yields a much more realistic apogee turn")
   amplifies them.

5. **What made it newly visible.** OpenRocket unstable added a per-step aerodynamic-damping term
   (`AbstractSimulationStepper.computeAerodynamicDampingMomentCoefficient`, which calls the full
   `getForceAnalysis` every step and feeds the pitch moment). That makes the trajectory slightly more
   sensitive than 24.12, which stayed under the old `1e-9` flight tolerance. The term itself is
   bit-identical JVM↔JS (it is built from the bit-identical force analysis in deterministic
   `LinkedHashMap` order); it simply nudges the dynamics enough to expose the pre-existing step-size
   sensitivity.

## Measured magnitudes

Measured **by line index** (the harness compares by position; note that labels such as `aero.cp` repeat
across many Mach/AoA rows, so a label-keyed comparison gives bogus results):

| Regime | Worst relative diff | Physical meaning |
|---|---|---|
| Static / instantaneous | ≤ 1e-13 | bit-identical (JS `Math` ULP only) |
| Smooth reference flight | 1.9e-3 (near-apogee velocity 6.23 vs 6.22 m/s) | ≈ 0.2 mm of 330 m, ~1 ms of 7 s |
| Turbulent (gusty-wind) flight | 3.2e-2; sample count 517 vs 534 | different but equally-valid chaotic trajectories |

## Why it is not a bug

- The physics is correct on both sides; every snapshot a design tool actually *reports* (drag, CP, CNα,
  mass, stability margin) is bit-identical.
- The JVM is byte-identical run-to-run — this is not nondeterministic hashing.
- It is not caused by the RASAero extensions — it predates them (present with the plain
  `BarrowmanCalculator`), and the RASAero static outputs are themselves bit-identical JVM↔JS.
- OpenRocket's own desktop flight simulation is nondeterministic at this same ULP-amplified level for the
  same reason.

## Resolution (Option A, 2026-08-27, project-owner approved)

Widen the **flight-only** tolerances; keep static physics strict. In `engine-java/test/parity/parity.mjs`:

| Constant | Old | New | Covers |
|---|---|---|---|
| `REL_TOL_DEFAULT` (static) | 1e-13 | 1e-13 | unchanged — instantaneous stays bit-identical |
| `REL_TOL_FLIGHT` | 1e-9 | 5e-3 | smooth-flight drift (worst 1.9e-3) |
| `ABS_TOL_FLIGHT` | 1e-12 | 1e-4 | near-zero flight quantities near apogee |
| `REL_TOL_TURBULENT` | 1e-5 | 5e-2 | chaotic gusty-wind flights (worst 3.2e-2) |
| `ABS_SLACK_SERIESLENS` | 2 | 25 | differing sample counts (517 vs 534) |

Result: parity is green — 255 lines, 0 failures. The loosened bounds still catch real fidelity breaks (a
TeaVM miscompile or unported dependency diverges by orders of magnitude, not by 0.2 mm).

## Alternative considered (not taken)

Make the RK4 step-size threshold selection ULP-robust so JVM and JS always pick identical steps. Rejected
for now: it changes the integrator's step-size logic, is uncertain to fully succeed across all scenarios,
and risks subtly altering flight behavior — all to chase a physically-negligible 0.2 mm. Revisit only if
strict bit-identical flight replay becomes a hard requirement.

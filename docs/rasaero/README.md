# RASAero-style supersonic aerodynamics for OpenRocket — extraction & reference

This directory isolates a set of **opt-in aerodynamic model extensions** applied to OpenRocket
24.12's Extended Barrowman aerodynamics. They were carried in with FakeRocket's engine (see
`../../engine-java/patches/LEDGER.md`); this document pulls the physics and the code out on
their own so they can be reviewed as a potential **OpenRocket contribution**.

- **The code**: `diffs/*.diff` — unified diffs of each touched file against **stock OpenRocket
  24.12** (`info.openrocket.core.*`). 7 files, ~705 added lines.
- **Everything is default-OFF / input-gated** — with the flag off (or the input absent) every
  number is bit-identical to stock OpenRocket. Proven two ways: the JVM↔JS parity test
  (`engine-java/test/parity/parity.mjs`, 258 assertions) and the classic-mode validation scorecard.

Authorship of these extensions is recorded in `engine-java/ATTRIBUTION.md`.

## Why: Extended Barrowman above Mach ~1.5

OpenRocket's aerodynamics is **Extended Barrowman** — slender-body + linearized-supersonic
theory. It is accurate subsonic and transonic and then degrades:

1. **Body CP/CNα are frozen at the slender-body (Mach-1) value for all Mach.** On a fast rocket
   the combined CP races forward — for the ARCAS model, stock predicts CP ≈ 27% of body length
   at Mach 4.6 vs. **57% measured** in the tunnel (NASA TN D-4013/D-4014). Over-optimistic
   stability: the sim says stable, the real rocket can weathercock.
2. **The supersonic fin normal-force slope uses the single-surface Busemann coefficient
   `K1 = 2/β`** (β = √(M²−1)) as if it were the whole slope — that is **half** of 2D linear
   theory (`4/β`), so CNα comes out ~50% low.
3. Several drag terms have **no Mach decay** (nose/boattail wave drag interpolators clamp flat
   past their last data point; base drag ignores motor thrust).

For subsonic/mid-power flight none of this matters. For supersonic high-power it does. These
extensions bolt **RASAero-style corrections** (RASAero is the de-facto hobby supersonic tool)
onto Barrowman, calibrated against published wind-tunnel/free-flight data.

## How it's wired

Three independent opt-ins, off by default:

| flag / input | scope | API |
|---|---|---|
| `supersonicAero` | supersonic CP/CNα + drag fidelity (the big one) | `BarrowmanCalculator.setSupersonicAero(boolean)` |
| `rogersKbf` | Rogers Modified Barrowman body-fin carryover | `BarrowmanCalculator.setRogersKbf(boolean)` |
| `nozzleExitDiameter` (per stage) | power-on base-drag reduction | `AxialStage` property, m |
| `airfoilSection` (per fin set) | RASAero fin cross-sections | `FinSet` property |

`BarrowmanCalculator` threads the two booleans into each per-component calculator when it builds
its calc map (`createCalcObject`), and preserves them across `newInstance()`. Validate any change
with `node validation/score.mjs [--supersonic]` (scores vs `validation/anchors.json`).

---

## Feature #1 — Supersonic aerodynamics (`supersonicAero`)

The centerpiece. Calibrated against **ARCAS** (NASA TN D-4013/D-4014), **Basic Finner**
(DREV-TM-9703), and **HB-2** (hypersonic) anchors. Built in phases; all in one flag.

### 1a. Supersonic fin normal force → 2D linear theory (`FinSetCalc`)

Stock charges the fin the single-surface Busemann level `2/β`. Flag-on scales the Busemann
triple to the 2D `4/β` level with the standard finite-span tip correction:

```
ssaeroScale(M) = 2 · max(1 − 1/(2·AR·β), 0.25)          β = √(M²−1)
```

and evaluates the Busemann K-terms **analytically** (stock interpolates a grid that clamps flat
above Mach 4.9):

```
K1 = 2/β
K2 = ((γ+1)M⁴ − 4β²) / (4β⁴)
K3 = ((γ+1)M⁸ + (2γ²−7γ−5)M⁶ + 10(γ+1)M⁴ + 8) / (6β⁷)
```

The transonic bridge's supersonic endpoint scales identically so the M0.9–1.5 interpolation
stays continuous. *Code: `ssaeroScale`, `k1Analytic`/`k2Analytic`/`k3Analytic`, `supersonicCP`.*

### 1b. Body-fin interference → exact NACA 1307 (`FinSetCalc`)

Classic Barrowman multiplies the fin CNα by the truncated "fins in presence of body" factor
`Kfb = 1 + τ` (τ = r/(s+r)) and **drops the reciprocal body carryover**. Flag-on uses the exact
NACA Report 1307 Eq. 14 slender-body split at all Mach:

```
CNα ← CNα · [ K_W(B) + fa · K_B(W) ]
K_B(W) = (1+τ)² − K_W(B)                         (total load ≤ (1+τ)²)
fa     = min(1, 0.5 + afterbody/rootChord)        (afterbody factor)

K_W(B)(λ) = (2/π) · [ (1+λ⁴)(½·atan(½(1/λ − λ)) + π/4)
                      − λ²((1/λ − λ) + 2·atan(λ)) ] / (1−λ)²      λ = r/(s+r)
```

`K_W(B) → 1` as λ→0, `→ 2` as λ→1. The afterbody factor (fins flush with the base get half the
carryover; fins with body behind them get full) is computed by walking the parent body + aft
symmetric siblings. *Code: `kWB1307`, `calculateNonaxialForces`, `calculateAfterbodyFactor`.*

### 1c. Mach-dependent nose CNα (`SymmetricComponentCalc`)

A nose (fore radius ≈ 0) no longer freezes at its slender-body value:

```
CNα(M) = CNα_slender · (1 + g·(min(M,5) − 1)),   M > 1
g = 0.10 (conical) | 0.07 (ogive-class)
```

Slopes bracketed by exact Taylor–Maccoll cone/ogive theory (Sims NASA SP-3004 class values reach
~1.2–1.4× slender by M4–5). Transitions/boattails stay slender. *Code: `calculateNonaxialForces`.*

### 1d. Drag fidelity (Phase 2)

- **Fin wave drag** — a sharp `AIRFOIL` section no longer gets the swept-cylinder blunt-LE drag
  plateau (which neither decays with Mach nor belongs on a sharp edge, and whose subsonic form
  `(1−M²)^−0.417` blows up near M0.9). Flag-on: thin-airfoil wave drag `K·4·(t/c)²/β`
  (K = 4/3 biconvex) × `cos²Γ_LE`, on planform area, blended over M0.9–1.2; subsonic profile drag
  stays in the friction form factor. *(`FinSetCalc.calculatePressureCD`)*
- **Fin-body junction interference** — fin friction ×1.8 (calibrated to the ARCAS fins-on/off
  tunnel increment; RASAero prints a "Fin Interference" component of the same relative size).
  *(`FinSetCalc.calculateFrictionCD`)*
- **Boattail/reducer wave drag** — stock has none (subsonic base-scaled estimate at every speed).
  Flag-on: linearized strip `Cp = −2θ/β` on the expansion surface, blended M0.8→1.5 (the 1/β form
  diverges near M1). *(`SymmetricComponentCalc.calculatePressureCD`)*
- **Nose wave drag decay** — interpolators no longer clamp flat past their last data point:
  conical/ogive continue on the analytic branch `2.1·sin²φ + 0.5·sinφ/β`; table shapes decay with
  the Fleeman/Bonney shape `×(1.59 + 1.83/M²)`. *(`SymmetricComponentCalc`)*
- **Base drag cap** — `min(0.25/M, 1.2/M²)` above M1 (≈0.85 of the vacuum base limit 2/(γM²),
  Hoerner Ch. 16). *(`BarrowmanCalculator.effectiveBaseCD`)*

### 1e. Hypersonic corrections (Phase 4)

- **Skin friction** — the `(1+0.15M²)^−0.58` compressibility fit tracks Van Driest II only to
  M≈4; flag-on fades to the VD-II adiabatic-wall fit `(1+0.144M²)^−0.65` (Hopkins & Inouye, NASA
  TN D-6945) over M3.5–4.5. *(`BarrowmanCalculator.calculateFrictionCD`)*
- **Nose Cp coefficient** — the `2.1·sin²φ` asymptote fades to the Rayleigh-pitot stagnation
  `Cp_max(M)` (NACA Report 1135 Eq. 100, → 1.839 as M→∞) over M4–8.
  *(`SymmetricComponentCalc.stagnationCpMax`)*

---

## Feature #3 — Rogers Modified Barrowman body carryover (`rogersKbf`)

Independent of `supersonicAero` (and **suppressed** when it's on, to avoid double-counting — 1b
already contains the full carryover). Slender-body theory says the total fin+carryover load is
`(1+τ)²·(fin-alone)`; OpenRocket already credits `(1+τ)` to the fins, so the body carryover that
completes it is `τ(1+τ)·(fin-alone) = τ·cna`, placed at the fin **root quarter-chord** (NACA 1307
puts carryover near the root, forward of the swept-fin MAC) and averaged into the fin CP. Net: CP
moves slightly **aft** → a more conservative static margin. *Code: `FinSetCalc.calculateNonaxialForces`.*

## Feature #2 — Power-on base drag (`nozzleExitDiameter`)

RASAero computes a distinct **power-on** drag: during motor burn the exhaust plume pressurizes
the base over the nozzle-exit footprint, recovering that area's base pressure. Stock OpenRocket's
`calculateBaseCD` is Mach-only with no thrust term. Model (no published formula exists — the
literal geometric mechanism from the RASAero Manual / Rogers & Cooper 2011):

```
power-on base area = max(0, baseArea − nozzleExitArea)     while the owning stage thrusts
```

Requires knowing *which stages are thrusting at this instant*, so three small plumbing changes
carry that state from the simulation into the aero calc:

- `AxialStage` — new `double nozzleExitDiameter` (m, default 0) + accessors *(diff: AxialStage)*
- `FlightConditions` — new `Set<Integer> thrustingStages` + `isStageThrusting(int)` *(diff: FlightConditions)*
- `AbstractSimulationStepper` — populates `thrustingStages` from `status.getActiveMotors()`
  (thrust > 0 → the mount's stage) *(diff: AbstractSimulationStepper)*
- `BarrowmanCalculator.calculateBaseCD` — subtracts the nozzle-exit area when the stage thrusts.

Default 0 ⇒ power-off, bit-identical.

## Feature #4 — RASAero fin cross-sections (`airfoilSection`)

RASAero's 8 fin sections vs. the kernel's 3. Input-gated (absent ⇒ classic behavior). `FinSet`
gains `airfoilSection` (`hexagonal`|`naca`|`doublewedge`|`biconvex`|`hexbluntbase`|`singlewedge`),
`airfoilLeDiamond`/`airfoilTeDiamond` (chamfer lengths), `finLeRadius`. `FinSetCalc.sectionPressureCD`
computes per-shape linearized thickness wave drag (DATCOM 4.1.5.1 / Hoerner), referenced to
planform area:

```
hexagonal:    τ²/β · (1/a1 + 1/a2)          (chamfer fractions a1,a2; default 1/3)
naca:         (16/3)·τ²/β   + implicit LE radius 1.1019·τ²·c
doublewedge:  τ²/(β·m(1−m)),  m = LE diamond fraction (default 0.5)
biconvex:     (16/3)·τ²/β
hexbluntbase: τ²/β·(1/a1)  + fin base drag
singlewedge:  τ²/β         + fin base drag
```

Wave terms blend over M0.9–1.2, swept by `cos²Γ_LE`; blunt-base sections carry `baseCD·τ` at all
Mach; an explicit LE radius adds swept-cylinder bluntness on its `2r` frontal height. Sections do
not change CNα/CP (thickness is drag-only in linear theory). *Code: `FinSetCalc.sectionPressureCD`.*

---

## Validation

`validation/score.mjs` grades the drag/CP/CNα sweep against `validation/anchors.json` (ARCAS
short/long, Basic Finner, HB-2), with per-dataset tolerances from the sources' stated accuracies.

| model | gate points within tolerance |
|---|---|
| classic Extended Barrowman (flag off) | **7 / 135** — supersonic CP frozen, as expected |
| supersonic-aero model (flag on) | **64 / 135** |

The classic-off failure is the *point*: it quantifies where stock OpenRocket is wrong above Mach 1.

## Documented limitations (be honest with users)

- **Transonic peak (M0.95–1.2) underpredicts** the tunnel by up to ~0.2–0.3 CD (fin transonic
  drag rise is ~4× subsonic in the data; RASAero underpredicts the same anchors too). Backlog.
- **Basic Finner Cx0 runs low** (~0.04–0.13) — suspected free-flight base-pressure environment
  behind a finned body (below the clean-cylinder Hoerner law).
- **HB-2**: spherical-cap **nose bluntness** and **flare-effectiveness decay with Mach** are
  deliberately unmodeled (flare physics with one dataset, no hobby relevance).
- Some **RASAero formulas are proprietary** and were reconstructed/approximated from published
  descriptions; the low-α nose→body carryover and full Jorgensen η·Cd_c crossflow are deferred.

## Notes for upstreaming to OpenRocket

- **Feature vs. TeaVM-compat.** These 7 diffs are almost entirely feature code. The **only**
  TeaVM-specific change is in `BarrowmanCalculator`: `createCalcObject()` replaces
  `Reflection.construct(BARROWMAN_PACKAGE, comp, "Calc", comp)` with an explicit `instanceof`
  chain (TeaVM has no `Class.forName`). OpenRocket does not need that — it can keep the reflective
  construction and thread the `supersonicAero`/`rogersKbf` flags onto the calc objects another way
  (e.g. after construction, or via the existing map). Everything else ports as-is.
- **Guards.** Every path is behind a flag or a zero-default input; classic behavior is
  bit-identical (verified by the JVM↔JS parity test and the classic scorecard). A PR can keep
  that guarantee and expose the flags in the Swing preferences/analysis UI.
- **The diffs** in `diffs/` are against the stock 24.12 sources; regenerate with
  `diff -u <stock>/info/openrocket/core/<f> engine-java/src/java/info/openrocket/core/<f>`.

### File map

| diff | feature content | TeaVM-compat content |
|---|---|---|
| `aerodynamics_barrowman_FinSetCalc.java.diff` | #1 (fin NF, NACA 1307, drag), #3, #4 | — |
| `aerodynamics_barrowman_SymmetricComponentCalc.java.diff` | #1 (nose CNα, boattail/nose drag, hypersonic) | — |
| `aerodynamics_BarrowmanCalculator.java.diff` | #1 (base CD, friction), #2 (base area), flag plumbing | `createCalcObject` (reflection replacement) |
| `rocketcomponent_FinSet.java.diff` | #4 (airfoil section properties) | — |
| `rocketcomponent_AxialStage.java.diff` | #2 (`nozzleExitDiameter`) | — |
| `aerodynamics_FlightConditions.java.diff` | #2 (`thrustingStages`) | — |
| `simulation_AbstractSimulationStepper.java.diff` | #2 (populate thrusting stages) | — |

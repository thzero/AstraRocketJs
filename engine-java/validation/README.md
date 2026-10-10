# Validation harness

Scores the JS engine against **measured** wind-tunnel and free-flight anchor
datasets. Tolerances and conventions are in `anchors.json` (`_readme` and the
per-series fields); each dataset's published source is named in the fixture and
in the scorecards. The research write-ups those were drawn from are not in this
repo, so anything not recorded here is not recorded anywhere.

## Run it

Needs nothing built. `score.mjs` imports the committed engine directly
(`web/src/engine/vendor/openrocket-engine.mjs`) and installs its own stdout
sinks, so node alone is enough: no JDK, no workspace build.

```
node validation/score.mjs                    # classic Extended Barrowman (flag off)
node validation/score.mjs --supersonic       # the opt-in supersonic aero model
node validation/score.mjs --strict           # exit 1 unless every gate point passes
```

`--strict` (also `npm run validate:strict`) is the goal, not a gate: with 9 of 135
points passing on the classic model and 61 on the supersonic one, it fails today
by design. CI gates on the ratchet in `floors.json` instead.

## Scoreboard

The current anchors have 135 gate points. The Phase 1 to 4 scorecards are historical, scored against the earlier 137-gate anchors.

The two current scorecards were regenerated on 2026-10-04 from the committed
engine and match a live run row for row. Regenerate them after any engine
rebuild (see below).

| Model | Gate points | Scorecard |
|---|---|---|
| Classic Extended Barrowman | **9/135 (6.7%)** | `scorecard-classic.md` |
| + Phase 1 (supersonic CP/CNα) | 52/137 historical | `scorecard-phase1-2026-08-04.md` |
| + Phase 2 (drag fidelity) | 68/137 historical | `scorecard-phase2-2026-08-04.md` |
| + Phase 3 (fin airfoil sections) | 65/137 historical | `scorecard-phase3-2026-08-04.md` |
| + Phase 4 (hypersonic corrections) | 65/137 historical | `scorecard-phase4-2026-08-04.md` |
| Supersonic model, current anchors | **61/135 (45.2%)** | `scorecard-supersonic.md` |

Scoring conditions: Basic Finner scores at α = 2° (its free-flight fits ride
at finite yaw; see the `_aoaNote` in anchors.json); everything else at α = 0.

After any engine rebuild, regenerate both current scorecards and read the diff:

```
node validation/score.mjs > validation/scorecard-classic.md
node validation/score.mjs --supersonic > validation/scorecard-supersonic.md
```

## Files

- `fixtures/*.json`: RocketTree fixtures for the tunnel models (each file's
  `_notes` records its modeling approximations):
  - `arcas-short.json` / `arcas-long.json`: NASA TN D-4013/D-4014 sounding
    rocket, ogive + swept fins, data to M4.63
  - `basic-finner.json`: Army-Navy Basic Finner, cone + rectangular fins,
    free-flight data to M4.47
  - `hb2.json`: AGARD HB-2 blunt cone-cylinder-flare, finless body anchor to
    M10 (the spherical nose cap is modeled as a sharp cone; the kernel has no nose-bluntness model)
- `floors.json`: the CI ratchet: gate count, gated-set hash and the two score
  floors, read by `score.mjs --check-floors`
- `anchors.json`: machine-readable anchor tables (units/conventions in its
  `_readme`; `gate: false` series are informational)
- `score.mjs`: builds each fixture, runs `aeroSweep` (which emits CD
  power-off/on + CP + CNα per Mach), interpolates at anchor Machs, grades
- `scorecard-classic.md`: the current classic Extended Barrowman scorecard
  (flag off): **9/135 gate points**
- `scorecard-supersonic.md`: the current supersonic-model scorecard: **61/135**
- `scorecard-phase1-2026-08-04.md` to `scorecard-phase4-2026-08-04.md`: the
  historical phase scorecards, against the 137-gate anchors

## Baseline reading (why almost everything fails, and why that's fine)

The harness scores both models against measured anchors; CI gates on the floors. The classic kernel:

1. **CP travel is wildly overpredicted, not just frozen.** Body CP never reads
   Mach (frozen at its M1 value near the nose) while fin CNα falls off with
   the Busemann 4/β trend, so the *combined* CP races forward far faster than
   any tunnel shows (ARCAS: model 27 %L vs measured 57 %L at M4.63). The
   supersonic model's body CNα/CP corrections address this from both ends.
2. **Supersonic CD is high by ~2×** at M3–4.6 (wave-drag extrapolation + the
   0.25/M base model + no per-shape fin thickness treatment).
3. **The transonic rise starts too early and peaks too low** vs the ARCAS
   tunnel (kernel rises from M0.8; tunnel peaks ≈0.685 at M1.05, kernel
   ≈0.61 at M1.1).
4. **Subsonic CD runs high** on the tunnel fixtures. For ARCAS this is now
   Re-matched (the fixtures carry RASAero's `machAlt` table); Finner and HB-2
   still sweep at ISA sea level; see `anchors.json` `_readme`.

Keep gates honest: never widen a tolerance to make a model pass; the
tolerances come from the datasets' own stated accuracies.

That rule is enforced, not only stated. The scorecard prints a sha256 of the
gated set (every gated point's series, Mach, anchor and tolerance). CI runs
`score.mjs --check-floors`, which takes the gate count, that hash and the two
score floors from `floors.json`, the one place they live, so a widened tolerance
or a swapped gate flag fails even when the gate count holds. Each fixture's `_expect.aero` pins its own
drag, CNa and CP at Mach 0.5 and 2.0 under both models, so a fixture that stops
modeling its rocket fails before it is scored. A deliberate aero model change
re-records those with `node validation/score.mjs --record-expect`.

## Anchors not included

- MESOS / Aftershock II / GoFast end-to-end flight fixtures (they need
  thrust-curve reconstruction and manual forum retrievals)
- Cajun (fin semispan not in our extract; retrievable from NASA TM X-1771)
- Power-on ΔCD series (Nike-Apache deck): the fixtures carry no nozzle-exit data
- Reynolds matching for Finner and HB-2 (ARCAS is machAlt-matched)

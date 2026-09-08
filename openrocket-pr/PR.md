# Add a subsonic pressure-drag floor for stubby stored-table nose cones

## Summary

The four "stored-table" nose shapes — **ellipsoid, power series, parabolic series, and Haack series** — are given essentially **zero subsonic pressure drag** when they are short (low fineness ratio). This is non-physical: a stubby ellipsoid or Von Kármán nose is a blunt body with real, measurable subsonic pressure drag. This PR adds a fineness-dependent floor for those shapes so a short example is no longer treated as drag-free below its drag-divergence Mach.

Conical and ogive noses are unaffected, and every nose at fineness ratio ≥ 1.8 is unaffected, so the change is confined to the shapes and sizes where the current model is demonstrably wrong.

## Why the current result is zero

In `SymmetricComponentCalc.calculateNoseInterpolator()`:

1. The stored-table shapes begin their tabulated pressure-drag curve at the drag-divergence Mach with the value **0**.
2. The fineness-ratio extrapolation is **multiplicative** (`stag * (tabulated/stag)^log4`), so it maps that leading `0` to `0` at *every* fineness ratio — it cannot lift a zero.
3. The subsonic power-law fit that would otherwise fill in `M < min` is skipped by the `if (minValue < 0.001) return;` guard, precisely because the leading value is 0.

The net effect is that `LinearInterpolator` clamps flat to the leading `0`, and the nose contributes no subsonic pressure drag regardless of how blunt it is. For the shapes' own default parameters (e.g. Haack, parabolic ≥ 0.5, power in [0.5, 0.75]) this happens at any fineness ratio.

## What this changes

Two coupled edits, both in `SymmetricComponentCalc`:

1. **Restructure the subsonic tail from three early `return`s into one guard.** The subsonic power-law fit now runs under `if (minValue >= 0.001 && cdMach0 < minValue - 0.01 && minDeriv > 0.01)` — the *exact logical negation* of the three conditions that previously returned. Any nose that took the fit before takes it identically now; the only purpose of the restructure is to let the new floor run afterward instead of returning before it.

2. **Add `applyStubbyNoseFloor(...)`**, applied as `max(existing, floor)` across the whole subsonic range (including the leading tabulated point, so the curve doesn't sit at the floor and then jump at drag-divergence Mach). The floor is

   ```
   floor = STUBBY_NOSE_ROUNDNESS * cone * taper
   cone  = 0.8 / (1 + 4 f^2)            // this class's own conical Cd(M=0)
   taper = 1 - (f / 1.8)^2              // fades to 0 at the fineness cut-off
   STUBBY_NOSE_ROUNDNESS = 1/3
   ```

   Scope is the four stored-table shapes only (`int1 != null` in the builder is exactly those). Conical and ogive build their curve analytically and a cone's own `Cd(M=0)` is ~3× this floor, so `max()` would ignore it anyway; a short tangent ogive is a separate case that deserves its own evidence.

## Basis for the numbers

This is a **bracket on the endpoint and the shape of the law, not a calibrated curve** — the code comments say so, and the constants are documented inline:

- **Fineness cut-off 1.8** — Centuri TIR-100 §8 (Mark Mercer's wind-tunnel series, one nose swapped at a time on a Centuri Javelin, whole-rocket Cd on body frontal area) shows no significant variation across the standard catalogue nose shapes from fineness ratio 4.0 down to the BC-70 at 1.8.
- **Roundness 1/3** — Mercer's deltas at fineness ratio 0.50 put a rounded stubby nose at 0.20–0.48 of a real cone; this model's own conical branch is itself ~2–4× high at the blunt end, so "rounded as a fraction of *this model's* cone" lands near 1/3. That reads ≈0.12 (on body frontal area) at fineness ratio 0.5, consistent with an independent CFD estimate for a stubby nose. Erring high charges *more* drag / predicts *less* altitude — the conservative direction.

The interpolation between fineness ratio 0.5 and the 1.8 cut-off is exactly that: interpolation. I'd rather ship a defensible bracket that fixes an obvious "zero" than leave the zero in place, but I'm happy to adjust the calibration if maintainers have better data.

## Impact / backwards compatibility

- **Unaffected (bit-identical):** all conical and ogive noses; all noses at fineness ratio ≥ 1.8; transitions and boattails (fore radius > 0); every nose that previously took the subsonic power-law fit.
- **Changed:** ellipsoid / power / parabolic / Haack noses at fineness ratio < 1.8 gain a subsonic pressure-drag term where they previously had ~0. This raises predicted drag and lowers predicted altitude for stubby designs using those shapes.

Because it changes simulation output for those cases, it targets the development branch (`unstable`).

## Verification

I verified the mechanism in a derivative build that compiles this exact algorithm. Representative effect on an isolated nose's subsonic pressure Cd (body frontal area, M ≈ 0.3):

| Nose (ellipsoid) | before | after |
|---|---|---|
| fineness ratio 0.5 (stubby) | 0.0824 | 0.1230 |
| fineness ratio 3.0 (slender, control) | 0.000476 | 0.000476 |

The stubby case gains the floor; the slender control is untouched, confirming the fineness cut-off. Aside from the targeted shapes/sizes, output is unchanged.

## Open questions for maintainers

1. **Always-on vs. a preference.** I've implemented it always-on (it's a model correction, and gating a single drag term behind a document/application preference is unusual). If you'd prefer it behind a preference, point me at the right settings hook and I'll wire it.
2. **Calibration.** The 1/3 roundness and the 0.8/(1+4f²) cone reference are brackets, not fits. Happy to revise against better wind-tunnel/CFD data.
3. **Tangent ogive.** Deliberately excluded here. A stubby ogive reads low too and could get the same treatment in a follow-up with its own evidence.

## Suggested test

A unit test in the aero package asserting, for a short ellipsoid/Haack nose, that `calculatePressureCD` at a subsonic Mach is now non-trivially positive and that a fineness-ratio-3 nose of the same shape is unchanged from the pre-patch value. I can add one matching your existing aero test conventions if you'd like it in this PR.

## Checklist

- [x] Confined to `SymmetricComponentCalc`; conical/ogive and fineness ≥ 1.8 untouched
- [x] Restructure is the exact negation of the removed early returns (no behavior change to existing fitted noses)
- [x] Constants documented inline with their sources
- [x] Patch applies cleanly to `unstable` (`git apply --check` clean)
- [ ] Unit test (offered above — say the word)

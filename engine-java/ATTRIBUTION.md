# Engine attribution

`engine-java/` is derived from the **OpenRocket** core — a post-24.12 development build
(https://openrocket.info, https://github.com/openrocket/openrocket) — its `info.openrocket.core`
module extracted to source and minimally patched to compile to JavaScript and WebAssembly with
TeaVM. OpenRocket is **GPL-3.0**, and this engine (and AstraRocketJs as a whole) inherits
that license.

## RASAero-style aerodynamics extensions — mmrocket-sim

**License of the incorporated work.** The mmrocket-sim extensions are
themselves derivative of OpenRocket and are incorporated here **under
GPL-3.0**, the same license this engine and AstraRocketJs ship under. Stating
it matters: incorporating another project's code with an unstated license is
the one defect a redistributor cannot fix after the fact, and this file named
the author without naming the grant.

Some extracted sources also carry **opt-in supersonic-aerodynamics extensions that are NOT part of
OpenRocket**: the supersonic-aero model (`supersonicAero`), the Rogers-Kbf body-fin carryover
(`rogersKbf`), the stubby-nose subsonic pressure-drag floor (`stubbyNoseFloor` — a THIRD
independent flag, and one that appeared in no document until 2026-09-19; see
`SymmetricComponentCalc.applyStubbyNoseFloor`), the power-on base-drag term
(`nozzleExitDiameter`), the RASAero fin cross-sections (`airfoilSection`), and the wind-tunnel
validation harness (`validation/`).

One more piece of that work reaches outside the engine: the **`fairing` component**
(a camera shroud) and its `<fairing>` `.ork` extension element, in `web/`. It was never
finished — nothing in the editor can create one, and the kernel models it as mass only,
with no drag. It is recorded here because its provenance is the same RASAero effort, and
because an unfinished extension is easy to mistake for a core feature.

These are the **original work of the mmrocket-sim project**
(<https://github.com/mtnmanak/mmrocket-sim>, by Mountain Man Rockets) — designed, implemented,
and calibrated there as opt-in extensions to OpenRocket's Extended Barrowman kernel.

Lineage, to be precise: **OpenRocket** (GPL-3.0) provides the Extended Barrowman kernel
these extend. **RASAero II** (Rogers Aeroscience) is a separate program, not used or included
here — these are an independent reimplementation of RASAero-*style* corrections built from
published sources (NACA Reports 1307/1135, NASA TN D-4013/D-4014/D-6945, Hoerner, DATCOM) and
calibrated against public wind-tunnel/free-flight data. The extraction (physics writeup + diffs
vs stock OpenRocket) lives in `../docs/rasaero/`.

## What's here

- `src/java` — the OpenRocket core subset, **already patched** for TeaVM. The
  deviations from upstream live as full-file overrides in `patches/` (UUID→LongUUID,
  InstanceMap→LinkedHashMap, a reflection-free Barrowman calc map, a few TeaVM classlib
  workarounds). Regenerate with `extract/extract.mjs` (see README).
- `src/shims/java` — replacements for JVM-only surface (e.g. `LongUUID`; `Geo2D`, an awt-free
  2D-geometry helper that lets the kernel drop `java.awt.geom`). **The two files carrying the
  third-party authorship live here**: `aerodynamics/RASAeroDragCalculator.java` and
  `aerodynamics/RASAeroStabilityCalculator.java`, both original mmrocket-sim work, not OpenRocket.
  Five other shims instead SHADOW an upstream class of the same name; `extract/SHIMS.txt` records
  what upstream looked like when each was last reviewed.
- `src/jdkstubs` — `java.text.Collator` stand-in (TeaVM's class library lacks it).
- `src/api/java` — the `api.OpenRocketEngine` @JSExport facade the web app calls.
- `extract/` — `extract.mjs` + `manifest.txt`: regenerate `src/java/` from an OpenRocket source
  tree (`--src` / `OPENROCKET_SRC`), with `--check` drift detection.
- `test/parity/` (ParityMain.java + parity.mjs) — the parity differential test (JVM vs TeaVM-JS
  bit-identical). The harness compiles **only under `-Pparity`**, so the shipped engine has no
  test code. (See also `validation/`: wind-tunnel aero scoring, alongside the parity test.)
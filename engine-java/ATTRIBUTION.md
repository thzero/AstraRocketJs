# Engine attribution

`engine-java/` is derived from **OpenRocket 24.12** (https://openrocket.info,
https://github.com/openrocket/openrocket) — its `info.openrocket.core` module extracted to source
and minimally patched to compile to JavaScript with TeaVM. OpenRocket is **GPL-3.0-or-later**,
and this engine (and FakeRocket as a whole) inherits that license.

## RASAero-style aerodynamics extensions — mmrocket-sim

Some extracted sources also carry **opt-in supersonic-aerodynamics extensions that are NOT part of
OpenRocket**: the supersonic-aero model (`supersonicAero`), the Rogers-Kbf body-fin carryover
(`rogersKbf`), the power-on base-drag term (`nozzleExitDiameter`), the RASAero fin cross-sections
(`airfoilSection`), and the wind-tunnel validation harness (`validation/`).

These are the **original work of the mmrocket-sim project**
(<https://github.com/mtnmanak/mmrocket-sim>, by Mountain Man Rockets) — designed, implemented,
and calibrated there as opt-in extensions to OpenRocket's Extended Barrowman kernel.
`patches/LEDGER.md` is mmrocket-sim's own first-hand patch record. Any contribution of this work
upstream (e.g. to OpenRocket) must credit mmrocket-sim as its author.

Lineage, to be precise: **OpenRocket** (GPL-3.0-or-later) provides the Extended Barrowman kernel
these extend. **RASAero II** (Rogers Aeroscience) is a separate program, not used or included
here — these are an independent reimplementation of RASAero-*style* corrections built from
published sources (NACA Reports 1307/1135, NASA TN D-4013/D-4014/D-6945, Hoerner, DATCOM) and
calibrated against public wind-tunnel/free-flight data. The extraction (physics writeup + diffs
vs stock OpenRocket 24.12) lives in `../docs/rasaero/`.

## What's here

- `src/java` — the OpenRocket core subset, **already patched** for TeaVM. The
  deviations from upstream are documented in `patches/LEDGER.md` (UUID→LongUUID,
  InstanceMap→LinkedHashMap, a reflection-free Barrowman calc map, a few TeaVM classlib
  workarounds). Regenerate with `extract/extract.mjs` (see README).
- `src/shims/java` — replacements for JVM-only surface (e.g. `LongUUID`; `Geo2D`, an awt-free
  2D-geometry helper that lets the kernel drop `java.awt.geom`).
- `src/jdkstubs` — `java.text.Collator` stand-in (TeaVM's class library lacks it).
- `src/api/java` — the `api.OpenRocketEngine` @JSExport facade the web app calls.
- `patches/LEDGER.md` — the record of every kernel deviation and why (re-audit on upstream upgrade).
- `extract/` — `extract.mjs` + `manifest.txt`: regenerate `src/java/` from an OpenRocket source
  tree (`--src` / `OPENROCKET_SRC`), with `--check` drift detection.
- `test/parity/` (ParityMain.java + parity.mjs) — the parity differential test (JVM vs TeaVM-JS
  bit-identical). The harness compiles **only under `-Pparity`**, so the shipped engine has no
  test code. (See also `validation/`: wind-tunnel aero scoring, alongside the parity test.)
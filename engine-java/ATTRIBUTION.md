# Engine attribution

`engine-java/` is derived from the **OpenRocket** core (https://openrocket.info,
https://github.com/openrocket/openrocket): its `info.openrocket.core` module extracted to source
and patched to compile to JavaScript and WebAssembly with TeaVM. OpenRocket is **GPL-3.0**, and
this engine (and AstraRocketJs as a whole) inherits that license.

`extract/UPSTREAM` names the exact commit.

For what is in this directory and how it is built, see `README.md`.

## Example rockets — OpenRocket

`web/public/examples/` holds the sixteen example `.ork` designs OpenRocket ships and opens
from *File → Open Example*. They are **OpenRocket's own work, GPL-3.0**, taken from
`core/src/main/resources/datafiles/examples/` at the commit `extract/UPSTREAM` pins, by
`web/scripts/sync-examples.mjs`.

**Modified:** each file's stored `<flightdata>` is stripped. Nothing else is changed.

## RASAero-style aerodynamics extensions — mmrocket-sim

Some extracted sources carry **opt-in supersonic-aerodynamics extensions that are NOT part of
OpenRocket**: the supersonic-aero model (`supersonicAero`), the Rogers-Kbf body-fin carryover
(`rogersKbf`), the stubby-nose subsonic pressure-drag floor (`stubbyNoseFloor`), the power-on
base-drag term (`nozzleExitDiameter`), the RASAero fin cross-sections (`airfoilSection`), and the
wind-tunnel validation harness (`validation/`). Outside the engine, in `web/`: the **`fairing`
component** and its `<fairing>` `.ork` extension element.

These are the **original work of the mmrocket-sim project**
(<https://github.com/mtnmanak/mmrocket-sim>, by Mountain Man Rockets), designed, implemented and
calibrated there as opt-in extensions to OpenRocket's Extended Barrowman kernel. They are
themselves derivative of OpenRocket and are incorporated here **under GPL-3.0**, the same license
this engine and AstraRocketJs ship under.

Two files carry that authorship whole, both under `src/shims/java/info/openrocket/core/aerodynamics/`:
`RASAeroDragCalculator.java` and `RASAeroStabilityCalculator.java`. The rest reaches the kernel as
`PATCH(...)` sections of extracted OpenRocket files, listed in `patches/LEDGER.md`.

`extract/MMROCKET-SIM` records the commit these were last reviewed against.

**RASAero II** (Rogers Aeroscience) is a separate program, not used or included here. These are an
independent reimplementation of RASAero-*style* corrections built from published sources (NACA
Reports 1307/1135, NASA TN D-4013/D-4014/D-6945, Hoerner, DATCOM) and calibrated against public
wind-tunnel and free-flight data. The physics writeup and the diffs against stock OpenRocket are
in `../docs/rasaero/`.

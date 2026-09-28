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

## Shape descriptions — OpenRocket

`web/src/i18n/locales/*.json` carries a `shapeDesc` block: the paragraph the property panel
shows under the shape picker, explaining what an ogive, power series or clipped ellipsoid
transition actually is. Those strings are **OpenRocket's own work, GPL-3.0**, taken from
`core/src/main/resources/l10n/messages*.properties` at the commit `extract/UPSTREAM` pins
(`Shape.<name>.desc1` for a nose cone, `desc2` for a transition), including the translations
for every language this app ships.

**Modified:** HTML entities are resolved to characters, whitespace is collapsed, and one
misspelling in the English parabolic-series string is corrected. The `<b>`, `<i>` and `<sup>`
markup is kept and rendered by `components/design/ShapeDescription.tsx`.

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

## RASAero II design export — mmrocket-sim

The `.CDX1` design exporter in `web/` was **ported from the mmrocket-sim project's
`services/rasaeroFile.ts`** (<https://github.com/mtnmanak/mmrocket-sim>, by Mountain Man Rockets),
and is incorporated here **under GPL-3.0** like the rest of their work above. It is the app-side
writer only: no engine code and no aerodynamics, just the file format.

**Modified:** the single module was split into an orchestrator, `web/src/services/rasaeroExport.ts`,
and the per-block writers under `web/src/services/rasaero/` (sustainer, booster, recovery, launch
site, engines, simulation, surface, units). The output was checked against real RASAero II on
2026-08-25.

`extract/MMROCKET-SIM` records the commit this was last reviewed against.

## Two corrected elastic cord densities — mmrocket-sim

`web/scripts/data/materials.app.json` carries two line materials that are not upstream OpenRocket's:
`Elastic cord, corrected (flat 19 mm, 3/4 in)` at 0.0123 kg/m and
`Elastic cord, corrected (flat 25 mm, 1 in)` at 0.016 kg/m.

Upstream's own figures for those two widths are 0.0012 and 0.0016, which are lighter than its
0.0043 for a 6 mm cord — a dropped digit rather than a measurement. mmrocket-sim spotted it and
published the corrected values; both were adopted here, verified against interpolation of
upstream's adjacent 6 mm and 12 mm entries. The wrong upstream entries are kept as well, so a
design that names one still reads back the density it was saved with.

`extract/MMROCKET-SIM` records the commit these were last reviewed against.

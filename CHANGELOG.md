# Changelog

All notable changes to AstraRocketJs are recorded here. The engine is validated
against desktop **OpenRocket** (`.ork` round-trips and its Component Analysis),
so most entries describe getting a computation to match OpenRocket exactly.

## [Unreleased]

### Added
- **Multi-stage flight charts.** The Flight tab now plots each stage of a staged flight as its own coloured line, with a stage selector to choose which to overlay. A spent booster's separate climb, descent, and landing are drawn from its own flight branch; the time axis spans every stage, and event markers and the hover readout cover all shown stages. Single-stage flights are unchanged.
- **Keyboard navigation for the component tree.** The tree is now a single tab stop with roving focus: ↑/↓ (and Home/End) move between parts, ←/→ collapse/expand a branch, and Enter/Space select — instead of one tab stop per part with no arrow keys.

### Changed
- **Taller flight charts.** The Flight-tab chart panels are twice as tall for easier reading.

### Fixed
- **Freeform fin drawn ahead of where it flies.** A freeform fin whose tip trailing corner overhangs its root was measured to its aftmost point instead of its root chord, so a bottom-/middle-anchored fin was drawn, dragged, and snapped forward of its true station by the overhang. (The property panel and the simulation were always correct — this was a 2D-view display error.)

### Accessibility
- **Aft (head-on) view names its parts.** The aft view was marked `role="img"`, which collapsed it to a single node and hid every part name from screen readers; it's now a labelled group that still exposes each part.

## [0.0.7]

### Fixed — mass, CG & stability now match OpenRocket

Three separate defects were making a design's **on-pad mass, CG, and stability**
read differently from desktop OpenRocket. On a representative dual-deploy,
multi-stage design (`Fireball.ZL1.DD.multi`) they stacked up to **4.86 cal** in
our app versus **3.14 cal** in OpenRocket; with all three fixed, the app now
matches OpenRocket to the caliber-fraction (CG **138.15 cm**, stability **3.14
cal**), component-by-component.

- **On-pad stability now includes the motors.** The loaded (on-pad) CG, CP
  margin, and stability were being computed from the **unloaded** rocket — a
  seated motor's mass was never counted — so stability read too high and CG too
  far forward. This affected *every* design's on-pad readout; it was only obvious
  on rockets with heavy motors. The flight configuration's motor list is now
  refreshed after a motor is seated, so the static analysis includes the
  propellant and casing, matching `MassCalculator.calculateLaunch`.

- **Motor loaded mass (and CG) now read from the motor file, like OpenRocket.**
  The bundled motor catalog took each motor's loaded weight from thrustcurve.org's
  `totalWeightG` **metadata field**, which disagrees with the motor's own
  thrust-curve **file** for **197 of 815 motors** (e.g. AeroTech **J350W: 665 g
  metadata vs 651 g in the file**, Estes **B6: 19.1 → 15.6 g**). OpenRocket loads
  the file; the catalog sync now does too, reading loaded mass from the RASP
  header / RockSim `initWt`, plus the real **CG-vs-time** from RockSim data
  (used instead of a mid-length approximation).

- **Recovery-device mass is now positioned correctly.** A parachute, streamer,
  or shock cord's **packed length** was dropped on import and never applied in the
  engine, so its mass sat at the default 25 mm length instead of its real packed
  length. For a bottom-/top-referenced device this misplaced the CG — a shock
  cord could be tens of millimetres off. The packed length is now read from the
  `.ork` and applied to `ShockCord` / `Parachute` / `Streamer`.

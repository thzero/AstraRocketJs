# Changelog

All notable changes to AstraRocketJs are recorded here. The engine is validated
against desktop **OpenRocket** (`.ork` round-trips and its Component Analysis),
so most entries describe getting a computation to match OpenRocket exactly.

## [Unreleased]

### Added
- **Works offline, and installs.** The app now caches itself, the physics engine, and both reference catalogs, so it opens and runs a full simulation with no connection — useful at a launch site with no signal. Your browser will also offer to install it (home screen on mobile, its own window on desktop). When a new version is deployed, a prompt offers to reload rather than reloading under you mid-design.
- **Loading screens say what they are doing.** The startup splash reports the engine download with real progress ("Downloading engine… 1.4 / 2.3 MB") and names the compile step, and the motor and component pickers show the same for their catalog downloads — instead of a single static "Loading…" through a multi-megabyte transfer. A failed catalog load now reports the error and offers a retry, where it previously left an empty list with no explanation.
- **Catalogs refresh without a redeploy.** Motor and component catalogs are published weekly to a separate `data` branch and served over a CDN, so a catalog update reaches the app without rebuilding or redeploying it. The copy inside the build remains a fallback for when the CDN is unreachable.
- **Multi-stage flight charts.** The Flight tab now plots each stage of a staged flight as its own coloured line, with a stage selector to choose which to overlay. A spent booster's separate climb, descent, and landing are drawn from its own flight branch; the time axis spans every stage, and event markers and the hover readout cover all shown stages. Single-stage flights are unchanged.
- **Keyboard navigation for the component tree.** The tree is now a single tab stop with roving focus: ↑/↓ (and Home/End) move between parts, ←/→ collapse/expand a branch, and Enter/Space select — instead of one tab stop per part with no arrow keys.

### Changed
- **Taller flight charts.** The Flight-tab chart panels are twice as tall for easier reading.

### Fixed
- **Two different motors acting as one in the dashboard.** Motors sharing a manufacturer, common name, and diameter — AeroTech's F67W (White Lightning) and F67C (Classic), several Cesaroni reloads, 14 pairs in all — shared a row identity, so selecting or check-boxing one also took the other, and a compare or combine could pull the wrong thrust curve. The full manufacturer designation is now part of that identity.
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

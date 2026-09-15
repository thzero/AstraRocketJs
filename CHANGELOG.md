# Changelog

All notable changes to AstraRocketJs are recorded here. The engine is validated
against desktop **OpenRocket** (`.ork` round-trips and its Component Analysis),
so most entries describe getting a computation to match OpenRocket exactly.

## [Unreleased]

### Added
- **Flight-path exports for drift casting.** The KML export now sets the **track**'s altitude and the **waypoints**' altitude separately, and both offer **Clamped to the ground** — which lays them flat on the terrain, for when the question is what the rocket drifts *over* rather than how high it went. A common pairing is the track at sea level with the pins clamped: the flight suspended in the air where it belongs, its labels readable against the ground they sit over. **Draw shadow down to the ground** adds KML's `<extrude>` curtain under the track and a plumb line under each pin, and a clamped track is tessellated so it drapes over hills instead of cutting through them. Three presets — **Drift cast**, **Flight path**, **Landing plots** — set the waypoints, the lines and the placement together in one click, without hiding anything: the dialog always shows what the file will contain.
- **A Sketch tab on phones, drawn in landscape.** The rocket drawing — 2D, 3D, Aero and the flight views — has its own tab beside Rocket and Simulate, instead of sharing the screen with the stats strip and being squeezed into a couple of hundred pixels. The 2D views are landscape drawings (a hobby airframe is 15–25× longer than it is wide), so on a phone held upright they are now turned a quarter turn — nose at the top, the rocket's length running down the screen, rulers and markers and all — and turned back once the phone is sideways and already the right shape. The view switch and the 2D presets turn with the drawing, so they sit along the screen's long edge at the top of the sheet they control. The **3D** model and the **Aero** charts turn the same way — a Mach sweep is a wide drawing too. The Rocket tab keeps the design banner and the static stats. Nothing changes on a desktop, where all of it still shows at once.
- **Flight-path exports place the track properly.** The KML/GPX export dialog gained a **Placement** section: what altitudes are measured from (automatic, the ground, or sea level — automatic picks sea level only when the launch site has a real altitude, so a ground-relative track is never buried under the terrain), whether waypoint names are drawn, and whether pins carry their stage's colour. Staged flights get a track colour per stage and waypoints named for the stage that flew them (“Booster Apogee”), and a separated stage's track now starts at separation rather than repeating the ascent it flew bolted to the sustainer — so a spent booster reports its own peak speed. A design whose launch position was never filled in — both coordinates still zero — is exported from the Kennedy Space Center rather than dropped on Null Island, and coordinates are projected with WGS84 degree lengths. The flight-path model matches desktop OpenRocket's field for field, so Mustache templates written for either app render correctly in the other.
- **Choose your units.** Settings ▸ **Units** picks the unit for each kind of quantity — component and motor dimensions, altitude, mass, velocity, wind speed, acceleration, angle, bulk / fabric / cord density, temperature, pressure, thrust and impulse — with **Metric** and **Imperial** presets for setting them all at once. Every field, readout, chart, ruler and stat follows. The unit shown beside a value is itself a picker for **that one field**: set a nose cone's length to inches and its thickness, the component tree, the rulers and the stats strip all stay as they were. Per-field choices stick across reloads and never rewrite your defaults; a field you leave alone keeps following them. A field showing a non-default unit is tinted amber — and says so to a screen reader — so one inch measurement among centimetres reads as deliberate rather than as a glitch. The Units tab can reset every per-field choice at once, and the Metric / Imperial buttons clear them too. The PDF report and both CSV exports are written in your units and name the unit they used — and the report dialog can pin its PDF and CSV to **Metric** or **Imperial** instead, for when the document is for someone else. Designs are unaffected — the engine and every saved `.ork` stay SI, so switching units never edits your rocket.
- **Keep several rockets.** Designs are now a library rather than one working file: **Open…** lists your saved rockets to switch between, **Save As…** branches a copy, and **New** starts a fresh one without disturbing the last. Everything still autosaves as you edit. Your existing design is carried into the library automatically the first time you open the app.
- **Import / Export replace Open / Save for files.** Menu → **Open** and **Save** now mean the in-app library; `.ork` files move to and from your disk through **Import ▸ OpenRocket** and **Export ▸ OpenRocket**, alongside the other export formats.
- **Exports work in the installed app on iPhone and iPad.** A download started from an installed PWA silently did nothing on iOS; exports there now go through the system share sheet ("Save to Files"). Every export — `.ork`, RASAero, CSV, 3D meshes, cut sheets, schematics — shares one save path.
- **Works offline, and installs.** The app now caches itself, the physics engine, and both reference catalogs, so it opens and runs a full simulation with no connection — useful at a launch site with no signal. Your browser will also offer to install it (home screen on mobile, its own window on desktop). When a new version is deployed, a prompt offers to reload rather than reloading under you mid-design.
- **Loading screens say what they are doing.** The startup splash reports the engine download with real progress ("Downloading engine… 1.4 / 2.3 MB") and names the compile step, and the motor and component pickers show the same for their catalog downloads — instead of a single static "Loading…" through a multi-megabyte transfer. A failed catalog load now reports the error and offers a retry, where it previously left an empty list with no explanation.
- **Catalogs refresh without a redeploy.** Motor and component catalogs are published weekly to a separate `data` branch and served over a CDN, so a catalog update reaches the app without rebuilding or redeploying it. The copy inside the build remains a fallback for when the CDN is unreachable.
- **Multi-stage flight charts.** The Flight tab now plots each stage of a staged flight as its own coloured line, with a stage selector to choose which to overlay. A spent booster's separate climb, descent, and landing are drawn from its own flight branch; the time axis spans every stage, and event markers and the hover readout cover all shown stages. Single-stage flights are unchanged.
- **Keyboard navigation for the component tree.** The tree is now a single tab stop with roving focus: ↑/↓ (and Home/End) move between parts, ←/→ collapse/expand a branch, and Enter/Space select — instead of one tab stop per part with no arrow keys.

### Changed
- **Dialogs fill the screen on a phone.** Settings, the motor browser, the report and the rest now run edge to edge below the desktop breakpoint, instead of floating as a card with a gutter round it and strips of dimmed app above and below. Short prompts — the confirmation, the work-in-progress notice, the report's print settings — stay as centred cards, since filling a screen with two lines and a button is just empty space. Nothing changes on a desktop.
- **Your work is stored in a larger, safer place.** Designs, custom motors, materials and templates moved from browser local storage — synchronous and capped near 5 MB — to IndexedDB, which is asynchronous and effectively uncapped; existing data migrates on first load. The app also asks the browser not to evict your designs under disk pressure, and warns up front if the browser blocks IndexedDB (usually private browsing) rather than letting you discover it later as a failed save.
- **Taller flight charts.** The Flight-tab chart panels are twice as tall for easier reading.

### Fixed
- **A finished simulation going nowhere on a phone.** A run selected the flight chart but left you on the Simulate tab, so the chart appeared on the Sketch tab where you were not looking — and displaced your drawing when you got there. The flight views now have their own **Results** tab, which appears once a run has produced one and which a finished run takes you straight to; Sketch keeps the design views. The tab leads with the run's numbers — apogee, rod exit, max speed, landing, downrange — so they sit beside the charts they describe instead of a tab away.
- **Part colours unreachable on a phone.** Settings ▸ Colors hid the 3D part-colour swatches below the desktop width, on the assumption that a phone had no 3D model to colour. It does — through the Sketch tab — so the section now shows at every width.
- **The bottom tab bar scrolling away on a phone.** The app header's action group and the 2D / 3D / Aero toggle never wrapped, so on a phone the page was half again wider than the screen and could be scrolled sideways — taking the bottom tab bar, which is exactly one screen wide, off with it. Both rows now wrap. The shell is also measured against the *dynamic* viewport, so the tab bar no longer hides under the browser's address bar, and it keeps clear of the iPhone home indicator.
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

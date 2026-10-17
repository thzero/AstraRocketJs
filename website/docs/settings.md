---
title: "Settings"
sidebar_position: 6
---
Open **Settings** from the app menu (top-right ☰). Settings are **global**: they apply to every design and simulation, and are remembered in your browser.

## Units

Every quantity has its own unit, set on the **Units** tab. **Metric defaults** and **Imperial defaults** set them all at once; below those, each quantity has its own dropdown:

| Quantity | What it covers | Metric | Imperial |
| --- | --- | --- | --- |
| Component dimensions | lengths, diameters, thicknesses, CG / CP, the 2D rulers | cm | in |
| Motor dimensions | a motor's own diameter and length, the motor browser's diameter filter and mount bore | mm | in |
| Altitude / distance | apogee, downrange, deployment altitudes, launch-site altitude | m | ft |
| Area | a streamer's strip area | cm² | in² |
| Mass | component and rocket masses | g | oz |
| Velocity | launcher exit, max speed, deployment and landing speeds | m/s | ft/s |
| Wind speed | launch-condition wind and gusts | m/s | mph |
| Acceleration | max acceleration | m/s² | ft/s² |
| Angle | fin and launcher angles, wind direction | ° | ° |
| Density (bulk) | solid materials, by volume | g/cm³ | oz/in³ |
| Density (fabric) | parachute and streamer material, by area | g/m² | oz/ft² |
| Density (cord) | shock cord and shroud lines, by length | g/m | oz/ft |
| Temperature | launch-site air temperature | °C | °F |
| Pressure | launch-site air pressure | hPa | psi |
| Thrust / force | motor thrust | N | lbf |
| Impulse | total impulse | N·s | lbf·s |
| Roll rate | the flight's roll rate | r/s | r/s |

A fresh install starts on the **metric defaults**, and the reset buttons restore the same set.

Everything follows your choice: the property fields you type into, the component tree, the stats strip, the 2D rulers and calipers, the 3D callouts, the flight and drag charts, the motor browser, and the PDF and CSV exports (which name the unit they used, and can be pinned to metric or imperial of their own: see [Files & Exports](./files-and-exports.md)). The **Component dimensions** unit also reaches the flight: see [What units don't change](#what-units-dont-change).

### Changing a unit on one field

The unit printed next to a value is also a picker: click it and pick another. That changes **that field and nothing else**: set a nose cone's *Length* to inches and its *Thickness*, the component tree, the rulers and the stats strip all carry on in your default unit. The change sticks across reloads.

A field showing something other than your default is **tinted amber**, so one inch measurement among centimeters reads as something you chose rather than a glitch. Hovering it says what your default is.

Pickers appear on **individual named values**: the fields you type into, the stat tiles, the launch conditions, a material's density. They deliberately don't appear on tables, chart axes, ruler scales or component-tree rows: those are many values at once, and are always shown in your defaults.

This tab stays the one place that moves everything at once. A field you have never touched keeps following it: so changing a default here still updates every field you left alone.

Because a per-field choice lives on one field, it can be easy to forget where you set it. Three controls put things back, from narrowest to widest:

| Control | What it does |
| --- | --- |
| **Reset N fields back to these units** (appears only when some exist) | Clears every per-field choice. Your quantity defaults are left alone. |
| **Metric defaults** / **Imperial defaults** | Sets all the quantity defaults *and* clears every per-field choice, so a preset always takes full effect. |
| **Reset Units** (bottom of the dialog) | Back to the metric defaults with no per-field choices: units only, leaving your colors, simulation and other settings untouched. |

A per-field choice is *cleared* rather than rewritten, so the field goes back to **following** your defaults: change a default later and it moves with it.

### Where your unit choices live

Units belong to **the browser you set them in**, not to a design and not to a file. Practically:

- They apply to every design you open here, and stay put until you change them.
- They do **not** travel in a `.ork`. Open one of your files in desktop OpenRocket and it shows it in *OpenRocket's* units, set in its own preferences; a file from OpenRocket opens here in yours. The rocket is identical either way: only the presentation differs.
- They do **not** follow you to another computer, another browser, or a private window, and clearing your browser's site data resets them along with every other setting.

### Aero table shading

**Colors ▸ Aero table shading** picks how the [Aero](./views-and-analysis.md) per-component tables tint their cells. *By magnitude* is one color that strengthens with the value, scaled against the largest figure in the table. *By heat* reproduces desktop OpenRocket's green-to-red exactly: its formula, its fixed 0–1.5 Cd scale, dark text on light cells. Neither is more correct; pick the one you read faster. *By heat* applies to the **drag** table only: its scale is an absolute Cd one, which CNα and the roll coefficients are not on (a fin set's CNα of 15 would clamp to the same red as a nose cone's 2 and tell you nothing) so those tables stay unshaded under it, exactly as desktop OpenRocket colors only its drag tab. The same switch sits beside the legend under the table, so you can change it without leaving the view.

### What units don't change

Units are a **display and entry** preference. Your design is always stored in SI, so switching units never edits a rocket or re-saves a file. The one exception is the **Component dimensions** unit: the kernel compares airframe diameter steps, gaps and overlaps in that unit when it decides whether to warn about them, as desktop OpenRocket does in its own length unit. Changing it can change the warnings a run reports, so it marks every simulation that has already run as **outdated**.

Otherwise:

- `.ork` files stay in meters and kilograms: byte-for-byte what desktop OpenRocket writes.
- Format-defined exports keep their own units: RASAero (`.CDX1`) in inches/pounds, DXF cut sheets and 3D meshes in millimeters.
- The PDF report's 1:1 templates and its printed scale bar stay in mm/cm: that bar measures the **page**, so it must match a real ruler. (The report and design CSV otherwise follow your units, or can be pinned to metric or imperial in the export dialog: see [Files & Exports](./files-and-exports.md).)
- Unitless figures don't move either: stability in calibers or % of length, drag coefficients, Mach, CNα, times in seconds.

## Colors

The **Colors** tab holds three settings:

- **Part colors (3D model)**: the color each kind of part is drawn in on the 3D model. A row you have changed gets a reset button that puts back its default color.
- **Flight-path phase colors**: the colors of the **Boost**, **Coast** and **Descent** segments of the 3D flight path.
- **Aero table shading**: see [above](#aero-table-shading).

## Materials {#materials}

What a **newly added part** is made of. A row per material slot: the fourteen structural part types, plus a parachute's canopy and shroud lines, a streamer and a shock cord, because a part can carry more than one kind of material at once.

The choice is spent when you add the part: the material is written onto it there and then, so it shows in the property panel and travels with the design in the `.ork`. Parts already in the rocket are not touched, and neither is a design you open. Leave a row unset and the part gets the engine's own stock material for that slot instead (Cardboard, Ripstop nylon or Elastic cord, and Delrin for a rail button), so a new part always names what it is made of.

Desktop OpenRocket's equivalent preference works the same way: each new part takes the preferred material when it is created, so what you chose is in the file.

Custom materials can be defaults too. The adhesives are not offered, as in a structural part's own list. The first option in each row's list sets no default for that slot, and the part type keeps getting the stock material named above.

There is no row for fin fillets. A fillet you add starts as West System Six10, a thickened epoxy; a fillet in a file that names no material reads as Cardboard, as desktop OpenRocket reads it.

## Simulation defaults

These are on the **Simulation** tab, and seed each new simulation's run (you can still tune per-simulation launch conditions: see [Running a Simulation](./running-a-simulation.md)):

- **Confirm deletion of simulations**: ask before removing a simulation. On by default, because a deleted simulation takes its results with it.
- **Run outdated simulations automatically**: when the Results tab shows a simulation that has never run or whose result is outdated, run it. Off by default.

- **Time step**: the integrator step size. Smaller is more accurate but slower.
- **Max sim time**: a safety cap on simulated flight time, which ends a run that never lands.
- **Max angle step**: the most the rocket may rotate in one integration step. Smaller is more accurate through a fast pitch-over, and slower.
- **Random seed**: fixes the wind/turbulence randomness so a run is reproducible; leave it unset for varied runs.
- **Calculation method** and **Simulation method**: shown for reference rather than chosen: every flight runs Extended Barrowman aerodynamics with a 6-DOF Runge-Kutta 4 integrator.

Each simulation can override any of these. An override left **empty** is not missing: it means *follow the global*, and the field shows the global value as its placeholder. That is why run options never block a flight: there is always a default underneath. **Reset to default** clears a simulation's overrides; **Save as default** pushes what it is currently running into these globals.

Changing the time step, max sim time, max angle step or random seed marks every simulation that has already run as **outdated**. A simulation that overrides that setting is left alone, since its own value still applies.

## Launch

The **Launch** tab holds the launch conditions a new simulation starts from, in the same cards as a simulation's own launch panel (see [Running a Simulation](./running-a-simulation.md)). Changing them does not touch simulations that already exist; edit those in their own launch panel.

### Required launch conditions

Seven launch fields have no sensible default, so they cannot be left blank: **launcher length**, **launcher angle**, **wind speed**, **wind standard deviation**, **site altitude**, **latitude** and **longitude**. They are marked with a red **\*** wherever they appear, and behave exactly like a component's [required dimensions](./designing-a-rocket.md#required-dimensions): clearing one writes nothing, and a simulation missing one is named and skipped rather than flown. Wind speed and wind standard deviation are required only with the **Average** wind model: a **Multi-level** profile does not use them, and the panel hides them while one is set.

Note these seven are *required*, not *non-zero*: still air, no gusts, sea level, the equator, the prime meridian and a launcher straight up are all real settings, and all of them are zero. Only launcher length has to be positive in practice.

In this dialog the same fields can never end up blank at all: they seed every new simulation, so clearing one here simply keeps the value it had.

### Open-Meteo API key {#open-meteo-key}

At the bottom of the Atmosphere card on the Launch tab is a field for an Open-Meteo API key, used by [weather from Open-Meteo](./running-a-simulation.md#weather). Leave it empty to use Open-Meteo's free service, which is for non-commercial use. A key from a paid Open-Meteo plan sends requests to its paid service instead. The key is stored only in this browser, outside these settings, so **Reset** leaves it alone and no design or `.ork` you save carries it.

### Esri map key {#esri-key}

The **Map imagery** card at the bottom of the Launch tab has a field for an Esri map key. The maps (the launch site map, and the imagery under the flight views) come from Esri's map services, and they load without a key. A key from your own free ArcGIS Location Platform account is sent with every map request, so the maps you look at are used under your own account. Leave the field empty to use the maps as they are; while it is empty, every satellite and street map shows a note under its layer buttons saying a key can be added here. The key is stored only in this browser, outside these settings, so **Reset** leaves it alone and no design or `.ork` you save carries it.

To get a key:

1. Create a free account at [location.arcgis.com](https://location.arcgis.com/).
2. In its dashboard, open **Developer credentials** and create **API key credentials**.
3. Under privileges, choose **Basemaps** and nothing else.
4. Under referrers, add the address you open this app at, so the key works only there.
5. Choose an expiry date (a key lasts at most a year), create the key, and copy it right away: it is shown only once.
6. Paste it into the field.

When the key expires, create a new one and paste it in, or clear the field to go back to the maps without one.

## Playback {#playback}

- **Default speed**: the speed the 3D flight path starts playing at, from 0.25× to 4×. It is a starting point, not a lock: the speed control in the view changes the current playback without touching this.

## Sketch

Defaults for the 2D view. You can also toggle these on the view itself.

- **Center of gravity / pressure**: show the CG and CP markers.
- **Rulers**: one switch per side (top, bottom, left, right).

## Safety warnings

Also on the **Simulation** tab: five thresholds, in the units you have chosen for velocity.

- **Min launcher-exit velocity**: below this the fins have too little airflow to steer, so the rocket can weathercock into the wind or go unstable as it leaves the launcher. The launcher-exit tile is green at or above this and warns below it. This one only colors the tile and the [Off the rail](./tools.md#off-the-rail) figures: it does not reach the flight engine, it has no per-simulation override, and changing it does not mark results outdated.

The other four are deployment thresholds. They color the result tiles *and* reach the flight engine, so they decide which warnings a run reports rather than only how the numbers are painted.

- **Deploy-speed warning above**: single deployment (no drogue): above this speed, opening the parachute risks zippering the airframe or tearing the canopy.

The last three apply only to **dual deployment** (a stage carrying a drogue), where the main and the drogue are judged instead of the single threshold above:

- **Main deploy speed (max)**: above this the main is coming out too fast, usually a drogue too small to slow the rocket, or a main set to deploy too high.
- **Main deploy speed (min)**: below this the main opens while the rocket is barely descending, which normally means it deployed near apogee: a slow, drifty descent from full altitude.
- **Drogue deploy speed (min)**: below this the drogue comes out too slowly at apogee to inflate properly.

All three depend on the rocket saying which chute is which. That is set on the stage: choose **Dual deployment** under **Recovery deployment type** and pick the parachute or streamer that opens at apogee as the **Drogue device**, and the flight is judged as dual deployment. With **Single deployment** the whole stage is judged against **Deploy-speed warning above** alone.

Each of the four deployment thresholds can also be overridden per simulation, in the simulation's own options.

Changing any of those four marks every simulation that has already run as **outdated**, so a saved result never claims to describe settings it was not flown under. A simulation that pins the setting for itself is left alone, since its own value still applies. Run it again to bring the numbers up to date.

## Flight model

Also on the **Simulation** tab. Everything above decides when a flight *warns*. This one changes what the flight does.

- **Guide-aware launcher clearance**: off by default, which is OpenRocket's own behavior: the rocket stays on the launcher for its full length wherever its launch lugs or rail buttons sit. OpenRocket works out a guide-aware length and then never uses it, so a guide mounted above the rocket's aft end is credited with guided travel it does not have, and rail buttons are not considered at all.

  Turn it on and the guided phase ends by a rule for each kind of guide. A launch lug guides until its aft end leaves the rod. A rail needs two rail buttons and guides only until the second-to-last button leaves it, so a single rail button gives no guided travel at all. The rocket is released at that moment as well as reported there, so the flight itself changes, not just the number. Expect the rocket to leave a little sooner and the exit velocity to come out a little lower. A design with no guide at all is a tower launcher and flies identically either way.

  It is a setting rather than a correction because the engine is checked against desktop OpenRocket flight for flight. Left off, a run matches OpenRocket exactly.

  Changing it marks every simulation that has already run as **outdated**.

## General

- **Theme**: Dark, Light, Follow system (light or dark as your device is set, changing when it does) or Daylight (high contrast), a light theme with black text and darker colors for reading a screen in sunlight at the field. Dark by default. The 3D views and the schematic follow the theme; a downloaded or printed schematic keeps its own print colors whatever the theme. The ☀ button in the header switches to Daylight in one tap, and a second tap goes back to the theme you had.
- **Save design info (statistics) in the file**: writes the design's derived figures (mass, CG, CP, stability) into a saved `.ork`, as desktop OpenRocket can. Off by default.
- **Ask where to save each file**: opens the browser's own save dialog for every export, so you choose the name and the folder. On by default, and shown only in browsers that have that dialog (Chrome and Edge). Off, or in Firefox and Safari, files go straight to your downloads folder.

## Reset

Two buttons sit at the bottom of the dialog: **Reset ‹tab›** puts back just the tab you are on (so **Reset Units** touches units and nothing else), and **Reset all** returns every setting on every tab to its default. Reset all asks first, since it cannot be undone. **Reset Launch** and **Reset Materials** also ask first, because those tabs hold what you entered.

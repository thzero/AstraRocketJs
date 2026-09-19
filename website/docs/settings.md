---
title: "Settings"
sidebar_position: 6
---
Open **Settings** from the app menu (top-right ☰). Settings are **global** — they apply to every design and simulation, and are remembered in your browser.

## Units

Every quantity has its own unit, set on the **Units** tab. **Metric defaults** and **Imperial defaults** set them all at once; below those, each quantity has its own dropdown:

| Quantity | What it covers | Metric | Imperial |
| --- | --- | --- | --- |
| Component dimensions | lengths, diameters, thicknesses, CG / CP, the 2D rulers | cm | in |
| Motor dimensions | a motor's own diameter and length | mm | in |
| Altitude / distance | apogee, downrange, deployment altitudes, launch-site altitude | m | ft |
| Mass | component and rocket masses | g | oz |
| Velocity | rail exit, max speed, deployment and landing speeds | m/s | ft/s |
| Wind speed | launch-condition wind and gusts | m/s | mph |
| Acceleration | max acceleration | m/s² | ft/s² |
| Angle | fin and launch-rod angles, wind direction | ° | ° |
| Density (bulk) | solid materials, by volume | g/cm³ | oz/in³ |
| Density (fabric) | parachute and streamer material, by area | kg/m² | oz/yd² |
| Density (cord) | shock cord and shroud lines, by length | kg/m | oz/ft |
| Temperature | launch-site air temperature | °C | °F |
| Pressure | launch-site air pressure | hPa | psi |
| Thrust / force | motor thrust | N | lbf |
| Impulse | total impulse | N·s | lbf·s |

A fresh install starts on the **metric defaults**, and that is exactly what the reset buttons restore too — there is only one metric set, so nothing can surprise you with a different "metric".

Everything follows your choice: the property fields you type into, the component tree, the stats strip, the 2D rulers and calipers, the 3D callouts, the flight and drag charts, the motor browser, and the PDF and CSV exports (which name the unit they used, and can be pinned to metric or imperial of their own — see [Files & Exports](./files-and-exports.md)).

### Changing a unit on one field

The unit printed next to a value is also a picker — click it and pick another. That changes **that field and nothing else**: set a nose cone's *Length* to inches and its *Thickness*, the component tree, the rulers and the stats strip all carry on in your default unit. The change sticks across reloads.

A field showing something other than your default is **tinted amber**, so one inch measurement among centimeters reads as something you chose rather than a glitch. Hovering it says what your default is.

Pickers appear on **individual named values** — the fields you type into, the stat tiles, the launch conditions, a material's density. They deliberately don't appear on tables, chart axes, ruler scales or component-tree rows: those are many values at once, and are always shown in your defaults.

This tab stays the one place that moves everything at once. A field you have never touched keeps following it — so changing a default here still updates every field you left alone.

Because a per-field choice lives on one field, it can be easy to forget where you set it. Three controls put things back, from narrowest to widest:

| Control | What it does |
| --- | --- |
| **Reset N fields back to these units** (appears only when some exist) | Clears every per-field choice. Your quantity defaults are left alone. |
| **Metric defaults** / **Imperial defaults** | Sets all the quantity defaults *and* clears every per-field choice, so a preset always takes full effect. |
| **Reset Units** (bottom of the dialog) | Back to the metric defaults with no per-field choices — units only, leaving your colors, simulation and other settings untouched. |

A per-field choice is *cleared* rather than rewritten, so the field goes back to **following** your defaults — change a default later and it moves with it.

### Where your unit choices live

Units belong to **the browser you set them in**, not to a design and not to a file. Practically:

- They apply to every design you open here, and stay put until you change them.
- They do **not** travel in a `.ork`. Open one of your files in desktop OpenRocket and it shows it in *OpenRocket's* units, set in its own preferences; a file from OpenRocket opens here in yours. The rocket is identical either way — only the presentation differs.
- They do **not** follow you to another computer, another browser, or a private window, and clearing your browser's site data resets them along with every other setting.

### Aero table shading

**Colors ▸ Aero table shading** picks how the [Aero](./views-and-analysis.md) per-component tables tint their cells. *By magnitude* is one color that strengthens with the value, scaled against the largest figure in the table. *By heat* reproduces desktop OpenRocket's green-to-red exactly — its formula, its fixed 0–1.5 Cd scale, dark text on light cells. Neither is more correct; pick the one you read faster. *By heat* applies to the **drag** table only: its scale is an absolute Cd one, which CNα and the roll coefficients are not on — a fin set's CNα of 15 would clamp to the same red as a nose cone's 2 and tell you nothing — so those tables stay unshaded under it, exactly as desktop OpenRocket colors only its drag tab. The same switch sits beside the legend under the table, so you can change it without leaving the view.

### What units don't change

Units are a **display and entry** preference. Your design is always stored in SI, so switching units never edits a rocket or re-saves a file:

- `.ork` files stay in meters and kilograms — byte-for-byte what desktop OpenRocket writes.
- Format-defined exports keep their own units: RASAero (`.CDX1`) in inches/pounds, DXF cut sheets and 3D meshes in millimeters.
- The PDF report's 1:1 templates and its printed scale bar stay in mm/cm — that bar measures the **page**, so it must match a real ruler. (The report and design CSV otherwise follow your units, or can be pinned to metric or imperial in the export dialog — see [Files & Exports](./files-and-exports.md).)
- Unitless figures don't move either: stability in calibers or % of length, drag coefficients, Mach, CNα, times in seconds.
- Motor mount and filter diameters stay in mm, since 18 mm / 24 mm / 29 mm are effectively motor **names**.

## Simulation defaults

These seed each new simulation's run (you can still tune per-simulation launch conditions — see [Running a Simulation](./running-a-simulation.md)):

- **Confirm deletion of simulations** — ask before removing a simulation. On by default, because a deleted simulation takes its results with it.

- **Time step** — the integrator step size. Smaller is more accurate but slower.
- **Max sim time** — a safety cap on simulated flight time, which ends a run that never lands.
- **Max angle step** — the most the rocket may rotate in one integration step. Smaller is more accurate through a fast pitch-over, and slower.
- **Random seed** — fixes the wind/turbulence randomness so a run is reproducible; leave it unset for varied runs.
- **Calculation method** and **Simulation method** — shown for reference rather than chosen: every flight runs Extended Barrowman aerodynamics with a 6-DOF Runge-Kutta 4 integrator.

Each simulation can override any of these. An override left **empty** is not missing — it means *follow the global*, and the field shows the global value as its placeholder. That is why run options never block a flight: there is always a default underneath. **Reset to default** clears a simulation's overrides; **Save as default** pushes what it is currently running into these globals.

### Required launch conditions

Six launch fields have no sensible default, so they cannot be left blank: **rod length**, **rod angle**, **wind speed**, **wind standard deviation**, **site altitude** and **latitude**. They are marked with a red **\*** wherever they appear, and behave exactly like a component's [required dimensions](./designing-a-rocket.md#required-dimensions) — clearing one writes nothing, and a simulation missing one is named and skipped rather than flown.

Note these six are *required*, not *non-zero*: still air, no gusts, sea level, the equator and a rod straight up are all real settings, and all of them are zero. Only rod length has to be positive in practice.

In this dialog the same fields can never end up blank at all — they seed every new simulation, so clearing one here simply keeps the value it had.

## Safety warnings

Five thresholds, in the units you have chosen for velocity. They color the result tiles *and* reach the flight engine, so they decide which warnings a run reports rather than only how the numbers are painted.

- **Min rail-exit velocity** — below this the fins have too little airflow to steer, so the rocket can weathercock into the wind or go unstable as it leaves the rod. The rod-exit tile is green at or above this and warns below it.
- **Deploy-speed warning above** — single deployment (no drogue): above this speed, opening the parachute risks zippering the airframe or tearing the canopy.

The last three apply only to **dual deployment** (a stage carrying a drogue), where the main and the drogue are judged instead of the single threshold above:

- **Main deploy speed (max)** — above this the main is coming out too fast, usually a drogue too small to slow the rocket, or a main set to deploy too high.
- **Main deploy speed (min)** — below this the main opens while the rocket is barely descending, which normally means it deployed near apogee: a slow, drifty descent from full altitude.
- **Drogue deploy speed (min)**: below this the drogue comes out too slowly at apogee to inflate properly.

All three depend on the rocket saying which chute is which. Tick **Drogue (dual deployment)** on the parachute or streamer that opens at apogee, and the flight is judged as dual deployment. Leave it clear and the whole stage is single deployment, judged against **Deploy-speed warning above** alone.

Each of these can also be overridden per simulation, in the simulation's own options.

## Reset

Two buttons sit at the bottom of the dialog: **Reset ‹tab›** puts back just the tab you are on (so **Reset Units** touches units and nothing else), and **Reset all** returns every setting on every tab to its default.

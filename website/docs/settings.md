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

A field showing something other than your default is **tinted amber**, so one inch measurement among centimetres reads as something you chose rather than a glitch. Hovering it says what your default is.

Pickers appear on **individual named values** — the fields you type into, the stat tiles, the launch conditions, a material's density. They deliberately don't appear on tables, chart axes, ruler scales or component-tree rows: those are many values at once, and are always shown in your defaults.

This tab stays the one place that moves everything at once. A field you have never touched keeps following it — so changing a default here still updates every field you left alone.

Because a per-field choice lives on one field, it can be easy to forget where you set it. Three controls put things back, from narrowest to widest:

| Control | What it does |
| --- | --- |
| **Reset N fields back to these units** (appears only when some exist) | Clears every per-field choice. Your quantity defaults are left alone. |
| **Metric defaults** / **Imperial defaults** | Sets all the quantity defaults *and* clears every per-field choice, so a preset always takes full effect. |
| **Reset Units** (bottom of the dialog) | Back to the metric defaults with no per-field choices — units only, leaving your colours, simulation and other settings untouched. |

A per-field choice is *cleared* rather than rewritten, so the field goes back to **following** your defaults — change a default later and it moves with it.

### Where your unit choices live

Units belong to **the browser you set them in**, not to a design and not to a file. Practically:

- They apply to every design you open here, and stay put until you change them.
- They do **not** travel in a `.ork`. Open one of your files in desktop OpenRocket and it shows it in *OpenRocket's* units, set in its own preferences; a file from OpenRocket opens here in yours. The rocket is identical either way — only the presentation differs.
- They do **not** follow you to another computer, another browser, or a private window, and clearing your browser's site data resets them along with every other setting.

### Aero table shading

**Colors ▸ Aero table shading** picks how the [Aero](./views-and-analysis.md) per-component tables tint their cells. *By magnitude* is one colour that strengthens with the value, scaled against the largest figure in the table. *By heat* reproduces desktop OpenRocket's green-to-red exactly — its formula, its fixed 0–1.5 Cd scale, dark text on light cells. Neither is more correct; pick the one you read faster. *By heat* applies to the **drag** table only: its scale is an absolute Cd one, which CNα and the roll coefficients are not on — a fin set's CNα of 15 would clamp to the same red as a nose cone's 2 and tell you nothing — so those tables stay unshaded under it, exactly as desktop OpenRocket colours only its drag tab. The same switch sits beside the legend under the table, so you can change it without leaving the view.

### What units don't change

Units are a **display and entry** preference. Your design is always stored in SI, so switching units never edits a rocket or re-saves a file:

- `.ork` files stay in metres and kilograms — byte-for-byte what desktop OpenRocket writes.
- Format-defined exports keep their own units: RASAero (`.CDX1`) in inches/pounds, DXF cut sheets and 3D meshes in millimetres.
- The PDF report's 1:1 templates and its printed scale bar stay in mm/cm — that bar measures the **page**, so it must match a real ruler. (The report and design CSV otherwise follow your units, or can be pinned to metric or imperial in the export dialog — see [Files & Exports](./files-and-exports.md).)
- Unitless figures don't move either: stability in calibers or % of length, drag coefficients, Mach, CNα, times in seconds.
- Motor mount and filter diameters stay in mm, since 18 mm / 24 mm / 29 mm are effectively motor **names**.

## Simulation defaults

These seed each new simulation's run (you can still tune per-simulation launch conditions — see [Running a Simulation](./running-a-simulation.md)):

- **Time step** — the integrator step size. Smaller is more accurate but slower.
- **Max time** — a safety cap on simulated flight time.
- **Random seed** — fixes the wind/turbulence randomness so a run is reproducible; leave it unset for varied runs.
- **Calculation method** — the aerodynamic model (classic Extended Barrowman, and the opt-in supersonic/RASAero-style corrections).

## Safety warnings

Thresholds that color-code the simulation result tiles so problems stand out:

- **Rail-exit velocity minimum** — the rod/rail departure speed below which the rocket may not be going fast enough to fly straight; results under it are flagged.
- **Deployment-speed warning** — if recovery deploys above this speed the tile is flagged (fast deployment can damage a chute); a safely low deploy speed shows green.

## Reset

Two buttons sit at the bottom of the dialog: **Reset ‹tab›** puts back just the tab you are on (so **Reset Units** touches units and nothing else), and **Reset all** returns every setting on every tab to its default.

# Views & Analysis

The center pane's toolbar switches between views. **2D**, **3D**, and **Aero** are always available; **Flight** and **3D path** appear once you've run a simulation.

## 2D schematic

A to-scale side view of the rocket with **CG** (▲) and **CP** (●) markers and the stability margin called out.

- **Calipers** — drag-to-measure tools. The horizontal caliper measures the distance between two vertical lines (lengths); the vertical caliper measures across (diameters / spans). Lines **snap** to component edges.
- **Rulers** — a measurement frame around the drawing, with a **toggle per side** (top / bottom / left / right) next to the CG/CP and Info buttons.
- **Zoom / pan** — the +/− buttons or scroll to zoom, drag to pan.
- **Roll** — the side slider spins the rocket about its long axis, so you can see fin sets edge-on or broadside.
- **Side / Aft** — switch between the side profile and an aft (head-on) view; **Reset** restores the default framing.

## View toggles (2D and 3D)

Two toolbar buttons control what's overlaid on the **2D** and **3D** views:

- **CG / CP** — show or hide the **CG / CP / stability** markers and their callouts.
- **Info** — show or hide the quick-glance **length · mass · CG · CP · stability** card in the upper-left corner (the same summary as the [stats strip](#reading-the-stats-strip), handy when the strip is scrolled off on a phone).

## 3D model

An interactive 3D model of the rocket — orbit to inspect the geometry from any angle.

## Aerodynamics (Aero)

Drag and stability vs Mach number, for analyzing high-speed behavior:

- **Cd vs Mach** — total drag coefficient across the Mach range.
- **Drag breakdown** — friction / pressure / base contributions.
- **CP vs Mach** — how the center of pressure moves with speed.

You can export these as **CSV** (see [Files & Exports](Files-and-Exports)).

## Flight (after a simulation)

A panel of **flight charts** over time: altitude, velocity, acceleration, Mach, thrust, mass, drag, and stability. Flight events (burnout, apogee, deployment, landing) are marked. Toggle which measures show from the chip bar, hover for a synchronized crosshair and value readout across every chart, and zoom / pan the time axis (the +/− buttons, drag, or Ctrl / pinch-scroll).

**Staged rockets** — when a flight separated into more than one stage, a **stage selector** appears above the charts. Each selected stage draws as its own coloured line — a spent booster's separate climb, descent, and landing — sharing each chart's scale, with the hover readout and event markers covering every shown stage. Deselect a stage to focus on the rest.

## 3D path (after a simulation)

The flight **trajectory in 3D** — the rocket's path through space, including drift from wind.

An **⬇ Export** button saves the flight path for mapping tools — **KML** (Google Earth), **GPX**, or a **waypoint CSV** — with options for which waypoints and lines to include, and support for your own templates. See [Files & Exports](Files-and-Exports#exporting-the-flight-path-kml--gpx--csv).

## Reading the stats strip

The bottom strip summarizes the current design as a grid of tiles (collapse it with the chevron on its header):

- **Length**, **max diameter**, **fineness ratio** (length / diameter).
- **Mass** and **CG**, each shown **empty / loaded** (dry, and with the motor) in one tile.
- **CP** (center of pressure).
- **Recovery weight** — the descent mass (loaded mass minus the propellant that burns off). Shown once a motor is loaded; this is the mass the parachute actually brings down.
- **Stability** — in **calibers** (on the pad) and as **% of length**.
- **Drag coeff.** — the coast (power-off) drag coefficient at Mach 0.3.
- **Normal-force slope** — CNα (per radian), the Barrowman normal-force-coefficient slope at Mach 0.3.
- **Pitch** and **roll moment of inertia** (loaded), in kg·m².

A stability of roughly **1–2 calibers** is the usual healthy range; the stability tile is color-coded to flag under- or over-stable designs.

---
title: "Views & Analysis"
sidebar_position: 10
---
The center pane's toolbar switches between views. **2D**, **3D**, and **Aero** are always available; **Flight** and **3D path** appear once you've run a simulation.

On a phone the design views live on the **Sketch** tab and the flight views on **Results**, which appears once a run has produced one; picking either from the toolbar takes you to its tab. The toolbar turns with the drawing so it always sits along the long edge of the screen. See [Getting Started](./getting-started.md#the-layout).

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
- **Info** — show or hide the quick-glance **length · mass · CG · CP · stability** card in the upper-left corner (the same summary as the [stats strip](#reading-the-stats-strip), handy on a phone, where the strip is on the other tab).

## 3D model

An interactive 3D model of the rocket — orbit to inspect the geometry from any angle.

## Aerodynamics (Aero)

Drag and stability vs Mach number, for analyzing high-speed behavior:

- **Cd vs Mach** — total drag coefficient across the Mach range. A second **power-on** curve appears only when a stage declares a nozzle exit diameter (an imported `.ork` property; there is no field for it in the editor). It is the one figure in this panel that depends on the motor — everything else is geometry — so the toolbar names the motor it was computed for, which is whichever the active simulation has loaded.
- **Drag breakdown** — friction / pressure / base contributions, stacked. For the same split *per part*, see the **Per component** pane below.
- **CP vs Mach** — how the center of pressure moves with speed.

A row of **flight conditions** sets what the whole sweep is flown at:

- **AoA** — angle of attack in degrees. At 0 the rocket flies straight; raising it moves the CP.
- **Wind dir** — the wind's direction about the roll axis. **Worst** sets it to the angle where this rocket's CP sits furthest forward, i.e. where it is *least* stable — the safety question "is it stable in any orientation". For a symmetric three-fin rocket the CP does not depend on this angle at all and Worst reports 0; on a two-fin or otherwise asymmetric design it matters a great deal.
- **Roll rate** — in rad/s. Roll *damping* opposes an existing roll, so that column reads zero until you set one.

A **Charts / Per component** switch chooses what the panel shows — the three curves, or the tables below. The tables report at a single Mach: on the **Charts** pane the hover crosshair picks it, and on **Per component** a slider does, stepping only to Mach numbers the sweep actually computed. The two share one value, so switching panes lands on whatever you were just looking at.

**Drag by component** tabulates each part's drag at that Mach, split into **pressure / base / friction** — the same figures desktop OpenRocket shows in *Component Analysis ▸ Drag characteristics*. Rows are ordered worst-first and sum to the whole rocket. Cells are **shaded in proportion to their value** so the parts that cost you drag stand out without reading every figure, with the scale shown beneath the table. Two styles are offered, switched from the buttons beside the legend (or from **Settings ▸ Colors** — it is one preference, so either place sets it and it sticks): *By magnitude* (the default) is one color that strengthens with the value, scaled against the largest figure in the table; *By heat* is the desktop's green-to-red on its own fixed 0–1.5 Cd scale, with dark text on light cells, for anyone who reads that faster from having used it. *By heat* shades this drag table only — its scale is an absolute Cd one, and CNα and the roll coefficients are not on it, so those tables stay unshaded under that choice (the desktop colors only its drag tab for the same reason).

A part that exists more than once — a fin set, most often — also gets a **Per instance** column reading `0.251 × 3`: one fin's drag and how many there are. The **Cd** column is always the total for all of them.

**Stability contribution** is the companion table, and the one that answers *why the CP is where it is*: each part's **CNα** (its share of the rocket's normal-force slope) and its own **CP**. The fin set usually carries the great majority of the CNα — that is what holds the CP aft — while the nose cone contributes a couple of units pulling it forward. The rocket's CP is the CNα-weighted mean of the rows. Parts that carry no normal force, such as a straight body tube, are left out rather than listed as zeros. Each row also carries the part's **mass** — one instance, all instances, and the CG of the set — so the two halves of a stability question sit side by side.

**Roll dynamics** lists every fin set with its **roll forcing** and **roll damping** coefficients. Both read zero on a rocket that is neither canted nor rolling — that is the honest answer, not a missing table. Give a fin set a **cant angle** and the forcing coefficient comes up; it is the one place in the app that confirms a cant is doing what you intended. Damping opposes an existing roll, so it needs the **Roll rate** control above.

**Max Mach** sets how far the sweep runs: **M1** (the default — most hobby rockets never go supersonic, and a wider sweep squeezes the subsonic part of the curve into the left edge), or **M2 / M3 / M5** for one that does.

You can export these as **CSV** (see [Files & Exports](./files-and-exports.md)).

## Flight (after a simulation)

A panel of **flight charts** over time: altitude, velocity, acceleration, Mach, thrust, mass, drag, and stability. Flight events (burnout, apogee, deployment, landing) are marked, which answers *when*; the **[Flight events](./running-a-simulation.md#flight-events)** table on the Results pane reads the same events down a list, each with the state of the rocket at that instant. Toggle which measures show from the chip bar, hover for a synchronized crosshair and value readout across every chart, and zoom / pan the time axis (the +/− buttons, drag, or Ctrl / pinch-scroll). **The measures you pick are remembered** — open thrust and mass once and they are still open next time, in this design and any other.

**Choosing which flight** — run one simulation and the pane's title is simply its name. Run several at once and the title becomes a **picker** listing exactly those: click it and choose the flight to read. One at a time, and the choice governs all three results views — the charts, the [ground track](#ground-track-after-a-simulation) and the 3D path — so switching shows you the same flight whichever way you are looking at it.

It is deliberately not the Simulations tab's tick boxes: those say what **Run** should fly, which is a different question from what you are reading.

**Staged rockets** — when a flight separated into more than one stage, a **stage selector** appears above the charts. Each selected stage draws as its own colored line — a spent booster's separate climb, descent, and landing — sharing each chart's scale, with the hover readout and event markers covering every shown stage. Deselect a stage to focus on the rest.

## Ground track (after a simulation)

The flight seen from **directly above**: where the rocket went over the ground, with height thrown away. The 3D path answers *how did it fly*; this answers *where does it come down, and how far from the pad* — which on a breezy day is the difference between a walk and a search.

North is up, the pad is at the center, and both axes share one scale, so the picture is read like a map of the field you are standing on. **Range rings** carry the measurement, labeled in your distance unit, and each track ends in a ring at its landing point. Underneath, every track reports **how far** and **which bearing** — the two numbers you actually walk on.

It draws the same traces the flight charts do, so a staged flight shows each stage's own descent — a spent booster usually lands somewhere quite different from the sustainer.

### The ground under the track

The track can be drawn over **aerial imagery of the field you flew from**, at the coordinates that simulation was flown at. That is the difference between reading "364 m on a bearing of 270" and seeing that the booster came down in the treeline.

**None · Satellite · Street** in the corner chooses the layer. It starts on **None**, and nothing is fetched until you ask for the ground: the rings and the numbers are the measurement and they do not depend on a picture, so opening Results is not a reason to go and get one. Which layer you pick is shared with the [launch-site map](./running-a-simulation.md#the-map), and turning the ground on or off carries between this view and the 3D path for the session, because it is one question about how you want to read the ground rather than a setting per view.

The zoom follows the flight: a 200 m drift draws closer in than a 5 km one. The view never zooms closer than about **100 m across**, however short the flight — still air lands a rocket a few centimeters from the pad, and a picture of that much grass is no picture at all. So a landing on the pad reads as a dot on the pad, which is the truth about it.

Tiles are the same ones the launch-site map uses and are cached the same way, so a field you checked at home still draws with no signal. Somewhere you have never viewed draws without them, which is the plain plot and still a correct measurement — the range rings do not depend on the picture. The provider's credit sits in the corner whenever imagery is showing, as its terms require.

To take the same thing outside the app, the [flight-path export](./files-and-exports.md) writes it as KML or GPX for Google Earth, and the flight CSV now carries **East** and **North** columns beside altitude.

## 3D path (after a simulation)

The flight **trajectory in 3D** — the rocket's path through space, including drift from wind.

The **ground plane can carry the same aerial imagery**, laid at the launch site's coordinates so the trajectory arcs over the real field rather than over an empty grid. The same **None · Satellite · Street** buttons sit at the top left, starting on **None** and sharing their choice with the ground track and the launch-site map. The imagery covers a little past the furthest the rocket got from the pad rather than the whole plane, so a three-hundred-meter flight does not fetch a kilometer of scenery either side; the reference grid carries on beyond its edge.

An **⬇ Export** button saves the flight path for mapping tools — **KML** (Google Earth), **GPX**, or a **waypoint CSV** — with options for which waypoints and lines to include, and support for your own templates. See [Files & Exports](./files-and-exports.md#exporting-the-flight-path-kml--gpx--csv).

### Playing the flight back

The 3D path replays the flight rather than only drawing it. **▶ Play flight** starts a T-minus countdown (5, 4, 3, 2, 1) and then launches; clicking again during the countdown cancels it, and during the flight pauses. Drag the **timeline** to scrub to any moment, and pick a **speed** from 0.25× to 4×. Speed is about wall-clock time, not simulated time, so the boost is not over before you have seen it.

The speed a run starts at comes from **[Settings ▸ Playback](./settings.md#playback)**.

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

# Views & Analysis

The center pane's toolbar switches between views. **2D**, **3D**, and **Aero** are always available; **Flight** and **3D path** appear once you've run a simulation.

## 2D schematic

A to-scale side view of the rocket with **CG** (▲) and **CP** (●) markers and the stability margin called out.

- **Calipers** — drag-to-measure tools. The horizontal caliper measures the distance between two vertical lines (lengths); the vertical caliper measures across (diameters / spans). Lines **snap** to component edges.
- **Rulers** — a length ruler along the bottom (spanning the viewport) and a cross-section ruler on the right.
- **Zoom / pan** — the +/− buttons or scroll to zoom, drag to pan.
- **Roll** — the side slider spins the rocket about its long axis, so you can see fin sets edge-on or broadside.
- **Side / Aft** — switch between the side profile and an aft (head-on) view; **Reset** restores the default framing.

## 3D model

An interactive 3D model of the rocket — orbit to inspect the geometry from any angle.

## Aerodynamics (Aero)

Drag and stability vs Mach number, for analyzing high-speed behavior:

- **Cd vs Mach** — total drag coefficient across the Mach range.
- **Drag breakdown** — friction / pressure / base contributions.
- **CP vs Mach** — how the center of pressure moves with speed.

You can export these as **CSV** (see [Files & Exports](Files-and-Exports)).

## Flight (after a simulation)

A panel of **flight charts** over time: altitude, velocity, acceleration, Mach, thrust, mass, drag, and stability. Flight events (burnout, apogee, deployment, landing) are marked.

## 3D path (after a simulation)

The flight **trajectory in 3D** — the rocket's path through space, including drift from wind.

## Reading the stats strip

The bottom strip summarizes the current design:

- **Length**, **max diameter**, **fineness ratio** (length / diameter).
- **Mass** and **CG**, both **empty** (dry) and **loaded** (with the motor).
- **CP** (center of pressure).
- **Stability** — in **calibers** and **% of length**, both **on the pad** and at **rail exit** (rail exit is the more meaningful number, since the rocket is lighter and the CG has shifted by the time it leaves the rod/rail).

A stability of roughly **1–2 calibers** is the usual healthy range; the tiles are color-coded to flag under- or over-stable designs.

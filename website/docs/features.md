---
title: "Features"
sidebar_position: 2
---
## Physics
- Runs OpenRocket's **real physics core** — Extended Barrowman (+ RASAero-style supersonic) aerodynamics, mass/CG, and RK4/RK6 flight — compiled to **WebAssembly** (JavaScript fallback), validated bit-identical to upstream OpenRocket.
- Flight simulations run in a **Web Worker**, off the main thread, so the interface stays responsive during a run.

## Design & analysis
- **Component-tree editor** (collapsible branches and list) with live **CG / CP / stability** as you edit — calibers and % of length — plus fineness ratio, **recovery weight** (descent mass), Mach-0.3 **drag coefficient** and **normal-force slope** (CNα), and the loaded **roll / pitch moments of inertia**, in the stats strip.
- **Multi-stage rockets** — add booster stages, pods, and parallel (strap-on) boosters; configure stage **separation** (ignition / burnout / ejection / apogee / altitude / never) and **upper-stage ignition** timing.
- **Parachute descent sizing** — select a canopy to see the descent rate it gives (vs. the main / drogue bands) and the diameter needed to hit each, from the descent mass and launch-site air density.
- **Scale the whole rocket** by a factor or to a target body diameter, in one undoable step — every length, diameter, wall, fin planform and position, with fixed-size hardware (rail buttons, camera shrouds, lug bores) left alone.
- **Undo / redo** across the whole workspace — component add / remove / edit **and** simulation changes (motor, ignition, launch conditions, add/rename/delete sim) on one timeline, with `Ctrl/⌘+Z` and `Ctrl+Shift+Z` (or the toolbar arrows). One edit = one step, even for a slider drag.
- **2D schematic** with drag-to-measure **calipers**, length + cross-section rulers, zoom/pan, roll (spin), and an aft (head-on) view.
- **3D model** view, and a **3D flight path** after a simulation. The **CG / CP** markers and a quick-glance **length · mass · CG · CP · stability** card can be toggled on both the 2D and 3D views.
- **Aerodynamics view**: Cd vs Mach, drag breakdown (friction / pressure / base), CP vs Mach.
- **Flight charts**: altitude, velocity, acceleration, Mach, thrust, mass, drag, and stability over time. For a staged flight, each stage's trajectory overlays as its own line, with a stage selector to choose which to show.

- **Several rockets at once** — the app keeps a library of your designs in the browser; switch between them from **Open…**, rename or delete, and **Save As…** to branch a copy. Everything autosaves as you work. See **[Files & Exports](./files-and-exports.md)**.
- **Works offline and installs** — the app, engine and catalogs are kept on your device after the first visit, so you can design and simulate with no connection; your browser will also offer to add it to your home screen or desktop. See **[Offline & Installing](./offline-and-installing.md)**.

## Data & I/O
- **Full `.ork` support** — open and save round-trip at full fidelity (files re-open in desktop OpenRocket).
- **Motor picker** with real **thrust curves** from [thrustcurve.org](https://www.thrustcurve.org) (~800 motors), downloaded once and cached for offline use. Filter by engine code, impulse class, manufacturer(s), and a **diameter range** that defaults to the motor-mount bore; selections are remembered.
- Pick from a motor's **multiple thrust curves** (the chosen one is what the engine simulates), set the **ejection delay** from the motor's own charges or a manual value, or **plug** any motor. A per-motor card shows the curve and delay, with a **thrust-curve popup**; multi-mount rockets get **one card per motor tube**. Plus **`.eng` import** and custom motors.
- OpenRocket **materials** (built-in + your own) and a **component-preset** catalog (~2,900 real Estes / Apogee / LOC / … parts).
- **Exports**: a full **rocket design report** (summary, parts detail, motors, and 1:1 fin/nose/transition templates) to **PDF**, or the design summary to **CSV**; the design to **RASAero II (`.CDX1`)** for aero analysis; individual components to **3D models (STL / OBJ / GLB)** for printing/CAD and flat parts (fins, rings, bulkheads) to **DXF** cut sheets; flight data & drag tables to **CSV**; the **flight path** to **KML / GPX / waypoint CSV** (Google Earth / GPS mapping) with importable custom **Mustache templates**; and the 2D schematic to **SVG / PNG / JPG**.
- Multiple named **simulations**, each with a full launch setup (rod, site, atmosphere, multi-level wind, earth model).

## Platform
- **Client-only** — no server, no accounts, nothing uploaded. A working copy of your design persists in the browser (so a refresh won't lose it); the design itself is a `.ork` file on your disk.
- **Responsive** — a three-pane desktop workbench that collapses to a tabbed single column on phones.
- **Keyboard navigation** — the component tree is fully arrow-key navigable (broader accessibility is an ongoing effort).
- Available in **English and Spanish**.

## Not (yet) supported
- **Metric/SI units only** — no imperial / unit-preference option yet.
- **Staged flight trajectories aren't validated yet** — multi-stage rockets are authorable and simulate (each booster flies its own branch), and their static mass / CG / stability match OpenRocket, but the flown staged trajectory hasn't been checked end-to-end against desktop OpenRocket. Treat staged flight results as preliminary.
- A single (dark) theme.

See the [FAQ](./faq.md) for more on the current limits.

---
title: "Files & Exports"
sidebar_position: 12
---
## Opening and saving `.ork`

AstraRocketJs reads and writes standard **OpenRocket `.ork`** files, so designs move both ways between it and desktop OpenRocket.

- **Import** (menu → Import → OpenRocket) loads an existing `.ork` at full fidelity — stages, transitions, couplers, rings, bulkheads, and more, not just the simple editor layout. A banner notes anything that couldn't be fully resolved (e.g. an unknown motor). The imported rocket becomes its own entry in your saved designs.
- **Export** (menu → Export → OpenRocket) writes the current design back to a `.ork` file on your device.

A round-trip through export and import is verified to preserve the physics (mass, CG, CP, stability), and the files re-open in desktop OpenRocket.

> **Menu → Open and Save work on designs saved inside the app** (see [Saved designs](#saved-designs) below); `.ork` files move to and from your disk through **Import** and **Export**.

## Saved designs

The app keeps a library of your rockets in the browser, so you can work on several and switch between them without exporting a file each time.

- **Open…** lists your saved rockets ("My Rockets"), newest first. Pick one to switch to it; you can rename or delete from the same list.
- **Save** commits the open design now. Editing already autosaves every half-second, so this is reassurance rather than a requirement — and if the rocket has never been named, it asks for a name first.
- **Save As…** stores a copy under a new name, leaving the original as it was.
- **New** starts a fresh rocket as a separate entry, without touching the one you had open.

> **Saved designs are per-browser and per-device.** The library lives in this browser on this machine — it does not sync, and clearing your browser data removes it (see [Offline & Installing](./offline-and-installing.md)).
>
> **`.ork` files are how you sync.** Export to a folder your system already syncs — iCloud Drive, OneDrive, Google Drive, Dropbox — and the design is on your other machines, backed up, and shareable; import it there to carry on. That also works with desktop OpenRocket, since it is the same file format.

## Exporting to RASAero II (`.CDX1`)

**Menu → Export → RASAero II (.CDX1)** writes the design as a RASAero II `.CDX1` file, so you can open it in **[RASAero II](https://www.rasaero.com/)** for its own aerodynamic and flight analysis.

RASAero models only the **external aerodynamic shape**, so the export carries the airframe — nose cone, body tubes, transitions / boat tails, fins, and launch lugs — plus the loaded **weight and CG** (written into RASAero's simulation block). Internal parts with no aerodynamic effect (centering rings, bulkheads, shock cords, engine blocks) are dropped; parachutes become RASAero recovery entries. Dimensions are converted to RASAero's units (inches, pounds, feet, °F).

Because RASAero can't represent every shape, the export **stops with a clear message** rather than write a file RASAero would reject — for example tube or elliptical fins, a non-conical transition, more than one fin set on a tube, or a freeform fin that isn't a simple trapezoid. In those cases, use `.ork` instead.

## Exporting a component as a 3D model or cut file

Export is **per component**, not whole-rocket: in the **Components** tree, every part that has a real shape carries a small **⬇** button that offers the formats appropriate to *that* part. Parts with no printable object — parachutes, streamers, shock cords, mass components, rail buttons — carry no button.

- **3D models — STL, OBJ, GLB.** A single, **watertight solid** of the part, built for 3D printing and CAD (STL/OBJ import into any slicer or modeller; GLB also carries a color for viewers). Offered for nose cones, transitions, body tubes, inner tubes, launch lugs, tube fins, fin sets, centering rings, bulkheads, couplers and engine blocks.
- **DXF — 2D cut sheet.** The flat outline of a **plate-cut** part for a laser cutter or CNC router (AutoCAD R12, in millimeters, CUT / REFERENCE layers). Offered only for the parts you actually cut from sheet: **fins, centering rings and bulkheads**. Fin outlines fold in any through-the-wall tab; discs carry the bore and a center cross-hair.

Notes on the 3D geometry:

- Everything is scaled to **millimeters** (the unit slicers and CAD assume) and each part is a **watertight, manifold solid** — a slicer won't reject it.
- **Tubes are hollow** (real wall thickness), not solid rods; nose cones and transitions include their **shoulders**; a nose/transition/bulkhead is a solid body.
- A **fin set** exports one fin; a **tube fin set** exports one tube — you print/cut as many as the design has.
- Filenames come from the component's name (or its type).

## Rocket design report (PDF / CSV)

**Menu → Rocket Design Report** opens a **Print or export** dialog to produce a full design report — the same content as OpenRocket's printout.

Tick the elements to include:

- **Design report** — a schematic of the rocket plus the summary numbers (length, max diameter, empty/loaded mass and CG, CP, fineness, stability in calibers and %, Mach-0.3 drag coefficient, normal-force slope, and pitch/roll inertia), for the whole rocket and each stage.
- **Parts detail** — per stage, every component with its material, dimensions and mass.
- **Fin templates**, **Nose cone templates**, **Transition templates** — **1:1** cut/trace outlines (fins fold in any through-the-wall tab), with a cm/inch ruler to verify the print scale. Print at **100% / actual size** (no page scaling).

Plus a few options:

- **Motors Summary** — per simulation, a flight summary (apogee, times, and off-rod / max / deployment / landing velocities) and a motor table (average and peak thrust, burn time, total impulse, thrust-to-weight, weight, size).
- **Update simulation data** — re-runs the simulation first so the flight numbers are current (it doesn't change your on-screen view).
- **Show by stage** — group the summary and parts by stage.

Then choose an output:

- **Save as PDF** — a real PDF file (vector text, tables and 1:1 templates; the schematic is drawn to scale).
- **Save as CSV** — the design summary as a tidy `Scope, Field, Value, Unit` table (Design / Rocket / per-stage blocks, plus each fin set's root position), for a spreadsheet.

The **Settings** button (persisted) controls the **template fill / border colors**, **paper size** (Letter / A4) and **orientation** (Portrait / Landscape). Values are in the app's metric units.

## Exporting data

**Flight and drag data** can be exported as **CSV** for use in a spreadsheet or your own analysis (values are in metric/SI units):

- **Flight data** — the simulated time-history (from the Flight view).
- **Drag table** — the Cd / breakdown / CP vs Mach data (from the Aero view).

## Exporting the flight path (KML / GPX / CSV)

After a simulation, the **3D path** view has an **⬇ Export** button that saves the flight's trajectory and ground track for mapping tools:

- **KML** — opens in **Google Earth**: the flight-path line, the ground track, and labelled waypoints.
- **GPX** — a standard GPS track (waypoints + track) for GPS tools and mapping apps.
- **Waypoint CSV** — one row per point of interest (pad, apogee, landing, …) with latitude / longitude.

In the export dialog you choose which **waypoints** to include (pad, liftoff, burnout, apogee, recovery deployment, landing, max velocity, max acceleration), whether to include the **flight-path line** and the **ground track**, how much to thin the path (**keep every Nth point**), and the **altitude / distance units**.

The coordinates are placed about the simulation's **launch latitude / longitude** (set in the launch conditions) and follow the wind drift. If no launch position is set (both zero), the track would land at (0, 0) off the coast of Africa — the dialog warns you.

### Custom export templates

The three built-in formats are **[Mustache](https://mustache.github.io/) templates**, and you can supply your own:

- **Download template** — save the selected format's template as a starting point.
- **Import template…** — add a `.mustache` file named `<name>.<ext>.mustache` (e.g. `my-track.kml.mustache`, `waypoints.csv.mustache`). The extension becomes the output file type. Your template appears in the format list, renders against the same flight data, and can be deleted. Imported templates are stored in your browser (nothing is uploaded).

Templates see the flight as a model with the same field names as OpenRocket's desktop export (e.g. `{{title}}`, `{{#branches}}`, `{{#waypoints}}`, `{{latitude}}`, `{{longitude}}`, `{{altitudeMslMeters}}`, `{{#path}}`), so templates written for desktop OpenRocket work here too.

## Exporting images

The **2D schematic** can be exported as a drawing:

- **SVG** — a true-scale vector drawing with the design data (prints at 100% scale).
- **PNG / JPG** — a high-resolution raster image; pick the format and width.

## Nothing leaves your device

All import/export happens locally in your browser — files are read from and written to your own device, with no upload to any server.

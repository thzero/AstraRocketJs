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

- **3D models — STL, OBJ, GLB.** A single, **watertight solid** of the part, built for 3D printing and CAD (STL/OBJ import into any slicer or modeler; GLB also carries a color for viewers). Offered for nose cones, transitions, body tubes, inner tubes, launch lugs, tube fins, fin sets, centering rings, bulkheads, couplers and engine blocks.
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

**Units** (persisted, next to the other options) picks what the PDF and the CSV are written in: **My default units** follows [Settings ▸ Units](./settings.md#units), or pin the document to **Metric** or **Imperial** so it reads the same whatever you happen to be working in — useful when the report is for someone else. Note that "my default units" means the tab defaults, *not* a unit you have set on an individual field: a report written half in inches and half in centimeters because of where you happened to click is not one anyone wants. The 1:1 templates and the printed scale bar always stay in mm/cm, because they measure the page.

The **Settings** button (persisted) controls the **template fill / border colors**, **paper size** (Letter / A4) and **orientation** (Portrait / Landscape).

## Exporting data

**Flight and drag data** can be exported as **CSV** for use in a spreadsheet or your own analysis. Columns are in [your chosen units](./settings.md#units) and each header names the unit it carries, so a file stays self-describing; numbers always use `.` as the decimal separator whatever your app language:

- **Flight data** — the simulated time-history (from the Flight view).
- **Drag table** — the Cd / breakdown / CP vs Mach data (from the Aero view).

### Choosing what goes in the flight CSV

The **CSV** button on the Flight view opens an export dialog rather than downloading straight away:

- **Variables to export** — everything the run recorded, each with the unit it will be written in. A simulation records every series the engine computes, so this is the full set rather than a chosen handful; series the app has no name for are listed under their kernel symbol. **Select all** and **Select none** are there for the extremes, and the count tells you where you are.
- **Format settings** — the field separator (comma, semicolon, TAB or SPACE), how many decimal places, and whether to use exponential notation for series that span many magnitudes.
- **Comments** — whether to head the file with the simulation's name, a line per column describing it, and a line per flight event; plus the character that marks a comment.
- **Stage to export** — on a staged flight, which branch to write.

Your choices are remembered for the next export.

## Exporting the flight path (KML / GPX / CSV)

After a simulation, the **3D path** view has an **⬇ Export** button that saves the flight's trajectory and ground track for mapping tools:

- **KML** — opens in **Google Earth**: the flight-path line, the ground track, and labeled waypoints.
- **GPX** — a standard GPS track (waypoints + track) for GPS tools and mapping apps.
- **Waypoint CSV** — one row per point of interest (pad, apogee, landing, …) with latitude / longitude.

In the export dialog you choose which **waypoints** to include (pad, liftoff, burnout, apogee, recovery deployment, landing, max velocity, max acceleration), whether to include the **flight-path line** and the **ground track**, how much to thin the path (**keep every Nth point**), and the **altitude / distance units**.

**Presets** — *Drift cast*, *Flight path* and *Landing plots* — set all three of those at once, because the waypoints, the lines and the placement have to agree for a file to answer one question well. They only move the controls, so what the file will contain is always what the dialog shows, and any one of them is a starting point you can adjust. Each states its selection in full, waypoints included, so no preset is a one-way door: *Landing plots* narrows the waypoints to the landing, and going back to *Drift cast* puts them all back.

**Placement** controls how the track sits on the map:

- **Track altitude from** and **Waypoint altitude from** — two separate choices, because the line and the pins want different things. *Automatic* uses sea level when the launch site has a real altitude set and the ground when it is still 0. That default matters: a flight measured from the pad but placed against sea level is buried under the terrain, which is what a launch site at 1200 m would otherwise give you. *Clamped to the ground* lays the track flat on the terrain — the one to pick when the question is what the rocket drifts **over** rather than how high it went. A common pairing is the track at sea level with the pins clamped: the flight suspended in the air where it belongs, and its labels readable against the ground they sit over.
- **Draw shadow down to the ground** — a curtain under the track and a plumb line under each pin, so you can read where a point in the air sits on the map. It switches off on its own once both halves are clamped, since there is nothing left to draw from.
- **Draw waypoint names on the map** — a near-vertical flight stacks its waypoints into a few hundred meters of screen; turn the names off for bare markers you can click.
- **Color waypoint pins per stage** — colored pins load an icon from Google's servers, so turn them off for a file that has to render offline.

The **Flight path** group carries two more controls that belong to the lines themselves:

- **Each stage's track starts** (staged flights only) — a separated stage's data begins as a copy of the whole stack's, so by default its track starts **at separation** and the shared ascent is drawn once. Choose **on the pad** to have every stage read as a complete flight instead. This also decides where a stage's *max velocity* and *max acceleration* are measured from, so a spent booster reports its own peaks rather than the stack's.
- **Stage colors…** — one swatch per stage. Each stage starts on the same palette color desktop OpenRocket and the [flight charts](./views-and-analysis.md#flight-after-a-simulation) give it, so a stage keeps its identity between the graph and the map; pick another to override it. One color drives all three of that stage's marks: the flight-path line at full strength, the ground track darkened (seen from straight above, a ground track sits directly beneath its flight path, and two lines of the same brightness read as one), and the waypoint pins. **Reset to defaults** puts every stage back on the palette, and **Cancel** leaves your previous choice alone.

### Naming the export

Several exports opened in one Google Earth session are otherwise indistinguishable: every two-stage design contributes a folder called *Sustainer* and a track called *Sustainer flight path*, and two designs can each own a *Simulation 1*. The **Mission** box names this one — the text is prefixed to the document name, every folder and every track, so *Sod Blaster* gives you *Sod Blaster Sustainer flight path*. A name that already starts with the mission is left alone rather than stuttering.

**Prefix the waypoint names too** extends it to the markers, and is off by default: a near-vertical flight packs every marker into a few screen pixels, where the labels already overlap enough to have a switch of their own (*Draw waypoint names on the map*, above), and longer names only make that worse. Turn it on when two flights' markers genuinely sit on top of each other.

The mission name is **not** remembered between exports — a stale one would quietly mislabel the next file, which is worse than retyping it. The marker checkbox is remembered, because that one is a working habit rather than a property of one flight. Neither is stored in your design, and the per-stage colors are likewise chosen per export.

The coordinates are placed about the simulation's **launch latitude / longitude** (set in the launch conditions) and follow the wind drift, projected with WGS84 degree lengths so a track exported here lands on the same spot as the same flight exported from desktop OpenRocket.

If both coordinates are still zero the position was never filled in, and the export is anchored at the **Kennedy Space Center** instead — the dialog warns you. Only (0, 0) counts, because it is open ocean; a site on the prime meridian or the equator is a real place and is exported where you put it. Your design is never modified; this only decides what coordinates go into the file.

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

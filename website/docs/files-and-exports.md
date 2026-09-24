---
title: "Files & Exports"
sidebar_position: 12
---
## Opening and saving `.ork`

AstraRocketJs reads and writes standard **OpenRocket `.ork`** files, so designs move both ways between it and desktop OpenRocket.

- **Import** (menu → Import → OpenRocket) loads an existing `.ork` at full fidelity — stages, transitions, couplers, rings, bulkheads, and more, not just the simple editor layout. A banner notes anything that couldn't be fully resolved (e.g. an unknown motor). The imported rocket becomes its own entry in your saved designs. If one of your saved rockets already has that name — which is what happens when you tweak a design in OpenRocket and import it again — the app asks whether to **overwrite** it or **keep both**, and offers a free name for the new one.
- **Examples** (menu → Import → Examples) opens one of the [example rockets](./getting-started.md#example-rockets) that ship with the app. It is an import like any other, so what you get is your own unsaved copy — including the question above if you have opened that example before.
- **Export** (menu → Export → OpenRocket) writes the current design back to a `.ork` file on your device.

A round-trip through export and import is verified to preserve the physics (mass, CG, CP, stability), and the files re-open in desktop OpenRocket.

## RockSim (`.rkt`)

RockSim designs open and save too, from **menu → Import → RockSim** and **menu → Export → RockSim**. The reader also works off the file's contents rather than its name, so a `.rkt` picked in the OpenRocket dialog still opens.

What comes across: nose cones, body tubes and transitions; inner tubes and motor mounts; centering rings, bulkheads, engine blocks and couplers; trapezoidal, elliptical and freeform fin sets with their cant, rotation and through-the-wall tabs; tube fins; launch lugs; parachutes and streamers; mass objects and shock cords; external pods; and up to three stages. Dimensions, materials, finishes, placement and measured mass/CG come with them.

What does not:

- **Motors and launch conditions.** RockSim keeps those with its *simulations*, which are a separate object from the design, so an imported rocket arrives with no motor loaded and an exported one leaves without yours. Pick a motor after importing.
- **Ring tails**, which have no equivalent here.
- **Detachable pods**, which import as fixed — the design still flies, with the pod attached the whole way.
- **Subassemblies**, whose contents are merged into the design rather than kept as a group.

Going the other way, RockSim has no element for **rail buttons** or **parallel (strap-on) stages**. Those are left out of the file, and the app tells you which parts were dropped rather than letting you find out when somebody else opens it.

> **Menu → Open and Save As work on designs saved inside the app** (see [Saved designs](#saved-designs) below); `.ork` files move to and from your disk through **Import** and **Export**.

## Saved designs

The app keeps a library of your rockets in the browser, so you can work on several and switch between them without exporting a file each time.

- **Open…** lists your saved rockets ("My Rockets"), newest first. Pick one to switch to it; you can rename or delete from the same list.
- **Save As…** stores a copy under a new name, leaving the original as it was. There is no plain **Save**: editing autosaves every half-second, and the header says when the last save landed, so the only thing left to ask for is a name.
- **New** starts a fresh rocket as a separate entry, without touching the one you had open.

> **Saved designs are per-browser and per-device.** The library lives in this browser on this machine — it does not sync, and clearing your browser data removes it (see [Offline & Installing](./offline-and-installing.md)).
>
> **`.ork` files are how you sync.** Export to a folder your system already syncs — iCloud Drive, OneDrive, Google Drive, Dropbox — and the design is on your other machines, backed up, and shareable; import it there to carry on. That also works with desktop OpenRocket, since it is the same file format.

## Exporting to RASAero II (`.CDX1`)

**Menu → Export → RASAero II (.CDX1)** writes the design as a RASAero II `.CDX1` file, so you can open it in **[RASAero II](https://www.rasaero.com/)** for its own aerodynamic and flight analysis.

RASAero models only the **external aerodynamic shape**, so the export carries the airframe — nose cone, body tubes, transitions / boat tails, fins, and launch lugs — plus the loaded **weight and CG** (written into RASAero's simulation block). Internal parts with no aerodynamic effect (centering rings, bulkheads, shock cords, engine blocks) are dropped; parachutes become RASAero recovery entries. Dimensions are converted to RASAero's units (inches, pounds, feet, °F).

Because RASAero can't represent every shape, the export **stops with a clear message** rather than write a file RASAero would reject — for example tube or elliptical fins, a non-conical transition, more than one fin set on a tube, or a freeform fin that isn't a simple trapezoid. In those cases, use `.ork` instead.

## Exporting the whole rocket for 3D printing (`.3mf`)

**Menu → Export → 3D print (.3mf)** writes every printable part of the design in one go. The dialog lists what the design can actually print, all ticked; untick anything you do not want. Parachutes, shock cords, mass components and rail buttons are not listed at all, because they have no solid body to print.

Two options:

- **One file per part (a .zip)** — off by default. Left off, you get a single `.3mf` holding one **named object per part**, which is the point of the format: the slicer's object list reads *Nose cone*, *Body tube*, *Centering ring*, not `part1`, `part2`, `part3`. Turned on, you get a zip of one file per part for a workflow that wants them separate.
- **Place each part on the build plate** — on by default; each part is moved so it is centered and resting at Z = 0 rather than sitting where it was in the rocket.

Parts keep the **orientation they have in the design** — the rocket's axis runs along X, so bodies arrive lying down. That is deliberate: standing them up would be right for tubes and wrong for every fin and ring, and it would make the 3MF differ from the STL of the same part. Your slicer's lay-flat or rotate is one click.

3MF is also offered per component, beside STL/OBJ/GLB, on the **⬇** button in the tree.

> **Why 3MF rather than STL.** STL is naked triangles: no name, no color, no declared unit, one object per file. 3MF carries all four, so a whole rocket arrives in the slicer already identified.

## Exporting a component as a 3D model or cut file

Export is **per component**, not whole-rocket: in the **Components** tree, every part that has a real shape carries a small **⬇** button that offers the formats appropriate to *that* part. Parts with no printable object — parachutes, streamers, shock cords, mass components, rail buttons — carry no button.

- **3D models — STL, OBJ, GLB, 3MF.** A single, **watertight solid** of the part, built for 3D printing and CAD (STL/OBJ import into any slicer or modeler; GLB also carries a color for viewers; **3MF** carries the part's name, its color and the unit, and is the one to pick if your slicer takes it). Offered for nose cones, transitions, body tubes, inner tubes, launch lugs, tube fins, fin sets, centering rings, bulkheads, couplers and engine blocks. To get the whole rocket at once, see [3D printing the whole rocket](#exporting-the-whole-rocket-for-3d-printing-3mf) above.
- **DXF — 2D cut sheet.** The flat outline of a **plate-cut** part for a laser cutter or CNC router (AutoCAD R12, in millimeters, CUT / REFERENCE layers). Offered only for the parts you actually cut from sheet: **fins, centering rings and bulkheads**. Fin outlines fold in any through-the-wall tab; discs carry the bore and a center cross-hair.

Notes on the 3D geometry:

- Everything is scaled to **millimeters** (the unit slicers and CAD assume) and each part is a **watertight, manifold solid** — a slicer won't reject it.
- **Tubes are hollow** (real wall thickness), not solid rods; nose cones and transitions include their **shoulders**; a nose/transition/bulkhead is a solid body.
- A **fin set** exports one fin; a **tube fin set** exports one tube — you print/cut as many as the design has.
- Filenames are the rocket's name and then the component's (or its type), so the nose cones of two designs do not collide in your downloads folder. See [What a download is called](#what-a-download-is-called).

## Rocket design report (PDF / CSV)

**Menu → Rocket Design Report** opens a **Print or export** dialog to produce a full design report — the same content as OpenRocket's printout.

Tick the elements to include:

- **Design report** — a schematic of the rocket plus the summary numbers (length, max diameter, empty/loaded mass and CG, CP, fineness, stability in calibers and %, Mach-0.3 drag coefficient, normal-force slope, and pitch/roll inertia), for the whole rocket and each stage.
- **Parts detail** — per stage, every component with its material, dimensions and mass.
- **Fin templates**, **Nose cone templates**, **Transition templates** — **1:1** cut/trace outlines (fins fold in any through-the-wall tab), with a cm/inch ruler to verify the print scale. Print at **100% / actual size** (no page scaling).
- **Fin marking guide**: **1:1** wrap-around strips that say *where around the tube* each part goes, one per body tube that carries a fin set. See [Fin marking guide](#fin-marking-guide) below.

Plus a few options:

- **Motors Summary** — per simulation, a flight summary (apogee, times, and off-rod / max / deployment / landing velocities) and a motor table (average and peak thrust, burn time, total impulse, thrust-to-weight, weight, size).
- **Update simulation data** — re-runs the simulation first so the flight numbers are current (it doesn't change your on-screen view).
- **Show by stage** — group the summary and parts by stage.

Then choose an output:

- **Save as PDF** — a real PDF file (vector text, tables and 1:1 templates; the schematic is drawn to scale).
- **Save as CSV** — the design summary as a tidy `Scope, Field, Value, Unit` table (Design / Rocket / per-stage blocks, plus each fin set's root position), for a spreadsheet.

**Units** (persisted, next to the other options) picks what the PDF and the CSV are written in: **My default units** follows [Settings ▸ Units](./settings.md#units), or pin the document to **Metric** or **Imperial** so it reads the same whatever you happen to be working in — useful when the report is for someone else. Note that "my default units" means the tab defaults, *not* a unit you have set on an individual field: a report written half in inches and half in centimeters because of where you happened to click is not one anyone wants. The 1:1 templates and the printed scale bar always stay in mm/cm, because they measure the page.

The **Settings** button (persisted) controls the **template fill / border colors**, **paper size** (Letter / A4) and **orientation** (Portrait / Landscape).

### Fin marking guide

The cutting templates give a fin's shape. This gives its **position**: a paper strip you wrap around the body tube to mark where each fin, tube fin, launch lug and rail button goes. It is the only printed aid **tube fins** get at all, since a tube has no outline to cut a template from.

One strip per body tube that carries a fin set, printed 1:1. Everything angular on that tube shares the strip, each an arrow across it under its own name, so the guide answers *where does the lug sit relative to the fins*.

To use one: print at **100% / actual size**, check the ruler, cut the strip out, wrap it around the tube with the **Fore** arrow pointing at the nose and the two ends **butted together, not overlapped**, then mark through each arrow. Rule a line along the tube through each pair of marks; that line is where the part goes.

Some details worth knowing:

- The strip is cut to the circumference **plus one paper thickness** (0.1 mm), because the marks sit on the outside of the wrapped paper rather than on the tube. Without it the ends fall short, and the smaller the tube the more it shows.
- The **seam** is placed in the widest gap between marks, so nothing you have to mark ends up under the tape.
- **Canted fins** are marked on the slant, with dashed lines at the root's fore and aft ends and a cross at its center.
- A strip too long for the page is **cut into pieces** that butt together and are taped in order, with the joins kept off the marks. Nothing is ever scaled down: a shrunk marking guide is worse than none. A 4 in tube wraps 320 mm, so it always takes two pieces.
- A part no strip can carry is **named in a footnote** rather than dropped, so nothing disappears silently: a lug on a nose cone or transition, whose circumference changes along its length, or a lug on a tube with no fin set.

Where the first fin sits around the body is the fin set's **Rotation** field, in the component panel's **Placement** section. A launch lug and a rail button carry the same field: it is one property, so it has one name.

### What a download is called

Every export names its file the same way, because a downloads folder is a flat list shared with everything else your browser saves there. The parts, in reading order:

| The file is | Named | For example |
| --- | --- | --- |
| about the rocket | rocket, then what the file is | `Bertha-design.ork`, `Bertha-report.pdf`, `Bertha-aero-table.csv`, `Bertha-2d.svg` |
| about a simulation | rocket, then the run, then what the file is | `Bertha-C6 flight-flight-data.csv`, `Bertha-C6 flight-flight-events.csv`, `Bertha-C6 flight-flight-path.kml` |
| a printable part | rocket, then the component | `Bertha-Nose cone.stl` |

A simulation export carries the run's name as well as the rocket's, because a rocket has several simulations and they are the thing being compared. Characters a filesystem will not take are replaced, and a part with nothing in it drops out, so an unnamed design still produces a usable filename.

The rocket's name is its own name if you set one, otherwise the name of the file it was imported from. Re-saving a design you opened gives the same filename back rather than stacking suffixes, because that name is read from inside the file and never from the filename.

## Exporting data

**Flight and drag data** can be exported as **CSV** for use in a spreadsheet or your own analysis. Columns are in [your chosen units](./settings.md#units) and each header names the unit it carries, so a file stays self-describing; numbers always use `.` as the decimal separator whatever your app language:

- **Flight data** — the simulated time-history (from the Flight view).
- **Drag table** — the Cd / breakdown / CP vs Mach data (from the Aero view).
- **Flight events** — the event timeline, one row per event, from the **CSV** button on the [Flight events](./running-a-simulation.md#flight-events) table. Where the table on screen keeps each event's extras on a line under it, the file gives every one of them its own column: stability, thrust-to-weight, angle of attack, Mach and dynamic pressure, plus the source component and the stage. Most rows leave most of those columns blank, which is the honest shape — only the rail-departure row has a thrust-to-weight, and an empty cell says it does not have one rather than that it is zero. This is separate from the flight data above, which can already carry the events as comment lines: a comment is for a reader, and this is the events as data.

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

In the export dialog you choose which **waypoints** to include (pad, liftoff, burnout, apogee, ejection, landing, max velocity, max acceleration), whether to include the **flight-path line** and the **ground track**, how much to thin the path (**keep every Nth point**), and the **altitude / distance units**.

**Presets** — *Drift cast*, *Flight path* and *Landing plots* — set all three of those at once, because the waypoints, the lines and the placement have to agree for a file to answer one question well. They only move the controls, so what the file will contain is always what the dialog shows, and any one of them is a starting point you can adjust. Each states its selection in full, waypoints included, so no preset is a one-way door: *Landing plots* narrows the waypoints to the landing, and going back to *Drift cast* puts them all back.

The one that matches the controls is highlighted, and a fresh dialog opens on *Flight path*. Because a preset only moves the controls, the highlight clears the moment you change one of the things it covers, and comes back when the controls spell that preset out again — it never claims a shape the dialog has since been adjusted out of.

**Placement** controls how the track sits on the map:

- **Track altitude from** and **Waypoint altitude from** — two separate choices, because the line and the pins want different things. *Automatic* uses sea level when the launch site has a real altitude set and the ground when it is still 0. That default matters: a flight measured from the pad but placed against sea level is buried under the terrain, which is what a launch site at 1200 m would otherwise give you. *Clamped to the ground* lays the track flat on the terrain — the one to pick when the question is what the rocket drifts **over** rather than how high it went. A common pairing is the track at sea level with the pins clamped: the flight suspended in the air where it belongs, and its labels readable against the ground they sit over.
- **Draw shadow down to the ground** — a curtain under the track and a plumb line under each pin, so you can read where a point in the air sits on the map. It switches off on its own once both halves are clamped, since there is nothing left to draw from. No preset turns it on: under a single pin it reads as a position, but under the whole length of an arcing flight path it is a solid wall that buries the flight it is meant to explain. Turn it on for the case it is good at, which is placing one particular point on the map.
- **Draw waypoint names on the map** — a near-vertical flight stacks its waypoints into a few hundred meters of screen; turn the names off for bare markers you can click.
- **Color waypoint pins per stage** — colored pins load an icon from Google's servers, so turn them off for a file that has to render offline.

The **Flight path** group carries two more controls that belong to the lines themselves:

- **Each stage's track starts** (staged flights only) — a separated stage's data begins as a copy of the whole stack's, so by default its track starts **at separation** and the shared ascent is drawn once. Choose **on the pad** to have every stage read as a complete flight instead. This also decides where a stage's *max velocity* and *max acceleration* are measured from, so a spent booster reports its own peaks rather than the stack's.
- **Stage colors…** — one swatch per stage. Each stage starts on the same palette color desktop OpenRocket and the [flight charts](./views-and-analysis.md#flight-after-a-simulation) give it, so a stage keeps its identity between the graph and the map; pick another to override it. One color drives all three of that stage's marks: the flight-path line at full strength, the ground track darkened (seen from straight above, a ground track sits directly beneath its flight path, and two lines of the same brightness read as one), and the waypoint pins. **Reset to defaults** puts every stage back on the palette, and **Cancel** leaves your previous choice alone.

### Summary balloons

Google Earth shows a feature's **description** in a balloon when you click it, and the KML fills three of them:

- **The document** carries the flight summary: the rocket, the motor configuration, the launch site's coordinates and elevation, the peak altitude, velocity and acceleration, the maximum range from the pad, the time to apogee, the flight time, and one line per stage giving that stage's landing coordinates, distance, bearing and time.
- **Each stage folder** carries that stage's own maximum range, and its landing on one line in the same shape the summary uses: coordinates first, then distance and bearing from the pad, then the time.
- **Each waypoint** carries the time since liftoff, the altitude above the pad and above sea level on one line, the position as a distance and bearing from the pad, its own coordinates, and — for an ejection — the recovery device that deployed.

**Every coordinate is written `latitude, longitude`, and says so.** A bare pair is ambiguous, and in a KML file it is ambiguous in a way that has a wrong answer waiting: KML's own coordinate triples are written *longitude* first, so a reader who knows the format has an active reason to read the pair backwards, and at a real launch site both readings are plausible places. Each pair is therefore tagged `(lat, lon)` and written to six decimals — about 10 cm, and signed decimal degrees, which is exactly what the app's own latitude and longitude fields take, so a coordinate read out of a balloon can be pasted straight back in.

The landing coordinates are the ones you will actually use. A distance and a bearing from the pad are for reading the map; the pair is what you type into a handheld to go and find the rocket, so every landing line leads with it:

```
Sod Blaster landing: 30.615051, -97.496600 (lat, lon); 50.0 m at 0° from the pad; T+3.0 s
```

The clauses are separated by semicolons because the coordinate carries a comma of its own, and every time in the file is written `T+` and to one decimal, so one quantity has one notation.

**Maximum range is not the landing distance.** A rocket can drift downrange under the chute and then partway back, so the farthest point from the pad is often not where it lands. The range is the figure that matters for range safety; where it came down is a separate fact, and both are exported. A stage's range is measured over its whole flight, including the ascent the stages flew bolted together, because the stack's excursion counts against every stage that was part of it.

A line with nothing to say disappears rather than rendering empty: there is no configuration line for a rocket with no named configuration, no "above sea level" altitude when the launch site is still at 0 (that height would really be the height above the pad), no recovery device on a pin that is not an ejection, and no landing at all for a run that ended while the rocket was still in the air.

**Summary balloons** switches the whole lot off, for a file going somewhere the descriptions would only get in the way. The geometry, the names and the colors are unaffected.

An ejection pin is named for the event, qualified by the device when you gave that device a name: *Drogue Ejection* and *Main Ejection*. That tells the two apart on a dual-deployment flight while keeping the event vocabulary every other pin uses, and on a staged flight it stacks with the stage into *Booster Drogue Ejection* — long, and exactly what that pin is. A device left on its default name adds nothing the balloon's **Device** line does not, so its pin is just **Ejection**.

Every line carries a bold label, so a balloon reads as a list of facts rather than a paragraph. Google Earth adds the feature's name as a heading above it, and a **Directions: To here / From here** pair below it, from its own default balloon template rather than from the file.

Where a balloon opens differs by viewer. Google Earth Pro opens a waypoint balloon when you click the pin in the 3D view, but opens the document and folder balloons only from their names in the **Places** panel. Google Earth for web opens all three from the project panel.

### Naming the export

Several exports opened in one Google Earth session are otherwise indistinguishable: every two-stage design contributes a folder called *Sustainer* and a track called *Sustainer flight path*, and two designs can each own a *Simulation 1*. The **Mission** box names this one — the text is prefixed to the document name, every folder and every track, so *Sod Blaster* gives you *Sod Blaster Sustainer flight path*. A name that already starts with the mission is left alone rather than stuttering.

**Prefix the waypoint names too** extends it to the markers, and is off by default: a near-vertical flight packs every marker into a few screen pixels, where the labels already overlap enough to have a switch of their own (*Draw waypoint names on the map*, above), and longer names only make that worse. Turn it on when two flights' markers genuinely sit on top of each other.

The mission name is **not** remembered between exports — a stale one would quietly mislabel the next file, which is worse than retyping it. The marker checkbox is remembered, because that one is a working habit rather than a property of one flight. Neither is stored in your design, and the per-stage colors are likewise chosen per export.

The coordinates are placed about the simulation's **launch latitude / longitude** (set in the launch conditions) and follow the wind drift, projected with WGS84 degree lengths so a track exported here lands on the same spot as the same flight exported from desktop OpenRocket.

If both coordinates are still zero the position was never filled in, and the export is anchored at the **Kennedy Space Center** instead — the dialog warns you. Only (0, 0) counts, because it is open ocean; a site on the prime meridian or the equator is a real place and is exported where you put it. Your design is never modified; this only decides what coordinates go into the file.

### The language of the file

The **Language** box, next to the units, writes the export in a language other than the one you are reading the app in. It defaults to *Same as the app*.

It belongs to the file for the same reason the units do: a KML going to somebody else may want their language whatever you happen to have the app set to. The choice is remembered between exports, and *Same as the app* is remembered too — picking Spanish once and then going back does not quietly leave the next file in Spanish.

It covers everything the export writes: the waypoint names, the *flight path* and *ground track* track names, every line of the balloons, and the default name of a recovery device you never renamed — a parachute you left alone is labeled in the export's language, not in English. What it cannot cover is text you wrote yourself — the mission name, the names you gave your own components, and any prose hardcoded in an imported template, which stays in whatever language its author typed.

### Custom export templates

The three built-in formats are **[Mustache](https://mustache.github.io/) templates**, and you can supply your own:

- **Download template** — save the selected format's template as a starting point.
- **Import template…** — add a `.mustache` file named `<name>.<ext>.mustache` (e.g. `my-track.kml.mustache`, `waypoints.csv.mustache`). The extension becomes the output file type. Your template appears in the format list, renders against the same flight data, and can be deleted. Imported templates are stored in your browser (nothing is uploaded).

Templates see the flight as a model with the same field names as OpenRocket's desktop export (e.g. `{{title}}`, `{{#branches}}`, `{{#waypoints}}`, `{{latitude}}`, `{{longitude}}`, `{{altitudeMslMeters}}`, `{{#path}}`), so templates written for desktop OpenRocket work here too.

`{{labels.*}}` holds the built-in templates' own strings in the export language — `{{labels.peakAltitude}}`, `{{labels.landing}}`, `{{labels.flightPath}}` and the rest — which is how those templates follow the **Language** box. A phrase whose word order changes between languages is not in there: `{{rangeText}}` on a waypoint, and `{{landingText}}` and `{{landingHeading}}` on a stage, arrive as finished strings, because a template gluing translated fragments together in English order produces English word order in every language. The values behind them are all still on the model, so a template that wants to build its own sentence still can.

The summary values are on the model too. At the top level: `{{maxRange}}` (the farthest any stage got from the pad, in the distance unit), `{{timeToApogee}}` and `{{flightTime}}` (seconds, one decimal), `{{velocityUnit}}` and `{{accelerationUnit}}` (labels for `{{maxVelocity}}` and `{{maxAcceleration}}`, which are always SI), `{{launchLatitudeStr}}`, `{{launchLongitudeStr}}` and `{{launchAltitude}}`, and `{{#includeDescriptions}}` for the balloon switch. Per stage: `{{maxRangeMeters}}` and `{{maxRange}}`, and `{{#hasLanding}}` gating `{{landingDistance}}`, `{{landingBearing}}`, `{{landingTime}}`, `{{landingLatitudeStr}}` and `{{landingLongitudeStr}}`. Each waypoint already carried `{{latitudeStr}}` and `{{longitudeStr}}`, the same six-decimal strings.

Two things to know when writing balloons of your own. **Write the HTML pre-escaped** — `&lt;b&gt;`, not `<b>` — and do not wrap it in `CDATA`. Every value a template substitutes is escaped, because a rocket's name could otherwise break the XML, and inside a `CDATA` block those escapes are not decoded: a rocket named `Bill & Ted` would reach the balloon as the literal text `Bill &amp; Ted`. Pre-escaped, the markup and the value are each escaped exactly once and the parser decodes them together. (A name containing `]]>` would also close a `CDATA` block early and produce an invalid file.) Second, **an empty value and a zero are false**, so `{{#launchAltitudeMeters}}…{{/launchAltitudeMeters}}` makes the line around it disappear when there is nothing to say, rather than printing a label with a blank after it.

## Exporting images

The **2D schematic** can be exported as a drawing:

- **SVG** — a true-scale vector drawing with the design data (prints at 100% scale).
- **PNG / JPG** — a high-resolution raster image; pick the format and width.

## Nothing leaves your device

All import/export happens locally in your browser — files are read from and written to your own device, with no upload to any server.

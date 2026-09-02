# Files & Exports

## Opening and saving `.ork`

AstraRocketJs reads and writes standard **OpenRocket `.ork`** files, so designs move both ways between it and desktop OpenRocket.

- **Open** (menu → Open) loads an existing `.ork` at full fidelity — stages, transitions, couplers, rings, bulkheads, and more, not just the simple editor layout. A banner notes anything that couldn't be fully resolved (e.g. an unknown motor).
- **Save** (menu → Save) writes the current design back to a `.ork` file (downloaded to your device).

A save → re-open round-trip is verified to preserve the physics (mass, CG, CP, stability), and the files re-open in desktop OpenRocket.

> The design lives on **your disk** as a `.ork` file. The app also keeps a working copy in your browser so a refresh won't lose your current rocket — but **Save** is how you keep a design permanently.

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

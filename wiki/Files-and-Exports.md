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

## Exporting images

The **2D schematic** can be exported as a drawing:

- **SVG** — a true-scale vector drawing with the design data (prints at 100% scale).
- **PNG / JPG** — a high-resolution raster image; pick the format and width.

## Nothing leaves your device

All import/export happens locally in your browser — files are read from and written to your own device, with no upload to any server.

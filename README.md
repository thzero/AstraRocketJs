# AstraRocketJs

**▶ [Launch the app](https://thzero.github.io/AstraRocketJs/)** — runs in your browser, nothing to install. Works **offline** once loaded, and can be installed to your home screen or desktop if you want it there.

A **lightweight, browser-based UI for the OpenRocket engine** — not a full re-creation of OpenRocket's desktop app, but a fast, mobile-friendly interface over the same trusted physics, with **full OpenRocket (.ork) support** (open, edit, save round-trip). Design a rocket, watch its CG/CP/stability update live, and run a full flight simulation — entirely in the browser, with nothing to install and nothing uploaded.

The UI is **responsive**: a three-pane workbench (editor · rocket view · motor/sim) on desktop that becomes tabs on a phone (Rocket · Sketch · Simulate, plus **Results** once a run has produced one), with the rocket views turned a quarter turn so the airframe runs down the screen's long edge. The rocket view switches between a **2D schematic**, a **3D model**, an **aerodynamics** view, and — after a simulation — **flight charts** and a **3D flight path**.

## Highlights

**Real OpenRocket physics, fast, in the browser**
- The actual OpenRocket core (extended Barrowman **+ RASAero** aerodynamics, mass/CG, RK4/RK6 flight), compiled to **WebAssembly** (JavaScript fallback) via TeaVM — validated **bit-identical** to upstream OpenRocket.
- Flight simulations run in a **Web Worker**, off the main thread, so the UI stays responsive during a run.

**Design & analyze**
- Component-tree editor with **live CG / CP / stability** as you edit — calibers, % of length, **on-pad *and* rail-exit** margins, and fineness ratio.
- **Undo / redo** across the whole workspace — component edits *and* simulation changes on one timeline (`Ctrl/⌘+Z`, `Ctrl+Shift+Z`).
- **Multi-stage rockets** — add booster stages, pods, and parallel boosters, with configurable separation and upper-stage ignition (staged flights simulate as independent branches; trajectory validation vs. OpenRocket is in progress).
- **2D schematic** with drag-to-measure **calipers**, length + cross-section rulers, zoom/pan, spin (roll), and an aft (head-on) view.
- **3D model** view, plus a **3D flight path** after a simulation. CG/CP markers and a length·mass·CG·CP·stability card can be toggled on either view.
- **Scale the whole rocket** by a factor or to a target body diameter in one undoable step, and **parachute descent sizing** that reads the descent rate a canopy gives you and the diameter each target rate needs.
- **Aerodynamic analysis**: Cd vs Mach, the drag breakdown (friction / pressure / base) and CP vs Mach, plus **per-component tables** — drag split into pressure / base / friction, each part's mass / CNα / CP, and every fin set's roll forcing and damping — flown at a chosen angle of attack, wind direction and roll rate. The same figures desktop OpenRocket shows in *Component Analysis*.
- **Flight charts**: altitude, velocity, acceleration, Mach, thrust, mass, drag, and stability over time — with per-stage trajectory overlays for staged flights.

**Data & I/O**
- **Full `.ork` support** — open and save round-trip at full fidelity (files re-open in desktop OpenRocket).
- **RockSim `.rkt` import and export** — designs move both ways with RockSim as well, across up to three stages. Motors and launch conditions stay behind, since RockSim keeps those with its simulations rather than its designs.
- **The sixteen example rockets that ship with OpenRocket**, built in under **Import → Examples** — clusters, pods, tube fins, parallel and serial staging, dual deployment, a separating payload section. Pulled from the same OpenRocket commit the engine is built from, and opened as your own unsaved copy.
- Keep **several rockets** in the browser and switch between them; everything autosaves (the top bar says when the last save landed), and `.ork` import/export moves designs to and from your disk. Importing a rocket whose name you have already saved asks whether to overwrite it or keep both, so the library does not fill up with copies.
- Real motor **thrust curves** from thrustcurve.org (~800 motors), plus **`.eng` import** and custom motors.
- OpenRocket **materials** (built-in + your own) and a **component-preset** catalog (~2,900 real Estes/Apogee/LOC/… parts).
- **Exports**: a full **rocket design report** (summary, parts detail, motors, and 1:1 fin/nose/transition templates) to **PDF**, or the design summary to **CSV**; the design to **RASAero II (`.CDX1`)**; the whole design's printable parts to **3MF** (one file, a named object per part) and individual components to **3D models (STL / OBJ / GLB / 3MF)** for printing/CAD, with flat parts to **DXF** cut sheets; flight data & aero tables to **CSV**; the **flight path** to **KML / GPX / waypoint CSV** (Google Earth / GPS, with a **Mission** name and per-stage track colors, and importable custom **templates**); and the 2D schematic to **SVG / PNG / JPG**.
- Multiple named **simulations**, each with full launch setup (rod, site, atmosphere, multi-level wind, earth model).

**Yours, on your device**
- No server, no accounts, nothing uploaded — the physics runs entirely on your device. Your `.ork` designs are **files on your disk** (open / save); the browser just keeps a working copy (so a refresh won't lose your rocket) plus your custom motors, materials, and settings.
- **Units are yours to pick** — metric or imperial presets, or a unit per quantity (lengths, altitude, mass, velocity, wind, acceleration, angle, density, temperature, pressure, thrust, impulse), and the unit printed beside any value is a picker for that one field. Designs are always stored in SI, so switching units never edits a rocket or changes how a `.ork` is written — units live in your browser, not in the file, so a design opened in desktop OpenRocket shows in OpenRocket's units.
- **Responsive** (desktop three-pane workbench → tabs on a phone, with the rocket views turned to the screen's long edge), in **English and Spanish**.
- **Says what its numbers are worth** — launch conditions are held to the NAR / Tripoli flying limits (rod within 20° of vertical, surface wind at or below 20 mph) and a run outside them is refused. Every set of results carries a **Before you fly** card naming what the model does not have (fin flutter, structural loads, parachute inflation and opening shock, your motor on the day), linking to a **[Safety](https://thzero.github.io/AstraRocketJs/docs/safety)** page.

## Getting started

Just want to use it? Open **<https://thzero.github.io/AstraRocketJs/>** — that's the current `master` build, deployed to GitHub Pages.

To run it locally you need only **Node 22+** — no JDK (it uses a committed engine build):

```bash
cd web && npm install && npm run dev
```

Full setup — dev server, build, engine rebuild, catalog tools, and tests — is in **[CONTRIBUTING.md](CONTRIBUTING.md)** and the project **Wiki**.

## Layout

- `web/` — the app: Vite + React + TypeScript + Tailwind CSS.
- `engine-java/` — OpenRocket's physics core, extracted + patched for TeaVM and compiled to the WebAssembly + JavaScript modules the app loads (GPL-3.0).

## Documentation

- **[Documentation](https://thzero.github.io/AstraRocketJs/docs/)** — the user guide: getting started, designing a rocket, motors, the views, running simulations, files/exports, and safety.
- **[Safety](https://thzero.github.io/AstraRocketJs/docs/safety)** — what a simulation result is worth, what the model does not know, and what to check on the rocket you actually built before you fly it.
- **[Architecture & internals](https://thzero.github.io/AstraRocketJs/docs/architecture)** — how the extracted engine, motor/material/component data, `.ork` I/O, and swappable stores work (the developer reference).
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — how to report bugs, develop, translate, and submit changes (full guide in the [documentation](https://thzero.github.io/AstraRocketJs/docs/contributing)).
- **[Code of Conduct](CODE_OF_CONDUCT.md)**

## Contributing

Contributions are very welcome — code, bug reports, translations, docs, and more. Start with **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## Status

Engine: working, validated bit-identical against upstream OpenRocket (JVM↔JS, and WASM↔JS). UI: actively developed — component-tree editor, stability, 2D/3D views, motor picker, `.ork` import/export, and flight simulation with charts (run off the main thread in a Web Worker to keep the UI responsive).

## Safety and disclaimer

A simulation is a model, and a model is only as good as what it knows. Before you fly a rocket you designed here, read the **[Safety](https://thzero.github.io/AstraRocketJs/docs/safety)** page and check the rocket you actually built against it.

This software is provided "as is", without warranty of any kind, express or implied, including any warranty of accuracy, merchantability, or fitness for a particular purpose. Simulation results are estimates. They are not a substitute for the applicable safety code, a range safety officer, an airspace waiver, or your own judgment.

**You, and you alone, are responsible for any rocket you build, any motor you use, and any flight you make.** Neither AstraRocketJs, its contributors, nor the authors of the software it derives from accept any liability for injury, death, property damage, regulatory violations, or any other loss arising from use of this software or reliance on its output, to the fullest extent permitted by law. By using the software you accept this.

## Attribution & license

The engine derives from the OpenRocket core (GPL-3.0) at one pinned commit, named in [`engine-java/extract/UPSTREAM`](engine-java/extract/UPSTREAM) and shown, with its date, in the app's About dialog and on the docs' [Overview](https://thzero.github.io/AstraRocketJs/docs/) page; the opt-in supersonic-aero (RASAero) extensions are the original work of the mmrocket-sim project. Full credits and license lineage: **[`engine-java/ATTRIBUTION.md`](engine-java/ATTRIBUTION.md)** (and `docs/rasaero/` for the extensions' physics + diffs).

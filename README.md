# AstraRocketJs

A **lightweight, browser-based UI for the OpenRocket engine** — not a full re-creation of OpenRocket's desktop app, but a fast, mobile-friendly interface over the same trusted physics, with **full OpenRocket (.ork) support** (open, edit, save round-trip). Design a rocket, watch its CG/CP/stability update live, and run a full flight simulation — entirely in the browser, with nothing to install and nothing uploaded.

The UI is **responsive**: a three-pane workbench (editor · rocket view · motor/sim) on desktop that collapses to a single stacked, tabbed column on phones. The rocket view switches between a **2D schematic**, a **3D model**, an **aerodynamics** view, and — after a simulation — **flight charts** and a **3D flight path**.

## Highlights

**Real OpenRocket physics, fast, in the browser**
- The actual OpenRocket core (extended Barrowman **+ RASAero** aerodynamics, mass/CG, RK4/RK6 flight), compiled to **WebAssembly** (JavaScript fallback) via TeaVM — validated **bit-identical** to upstream OpenRocket.
- Flight simulations run in a **Web Worker**, off the main thread, so the UI stays responsive during a run.

**Design & analyze**
- Component-tree editor with **live CG / CP / stability** as you edit — calibers, % of length, **on-pad *and* rail-exit** margins, and fineness ratio.
- **2D schematic** with drag-to-measure **calipers**, length + cross-section rulers, zoom/pan, spin (roll), and an aft (head-on) view.
- **3D model** view, plus a **3D flight path** after a simulation. CG/CP markers and a length·mass·CG·CP·stability card can be toggled on either view.
- **Aerodynamics view**: Cd vs Mach, drag breakdown (friction / pressure / base), and CP vs Mach.
- **Flight charts**: altitude, velocity, acceleration, Mach, thrust, mass, drag, and stability over time.

**Data & I/O**
- **Full `.ork` support** — open and save round-trip at full fidelity (files re-open in desktop OpenRocket).
- Real motor **thrust curves** from thrustcurve.org (~800 motors), plus **`.eng` import** and custom motors.
- OpenRocket **materials** (built-in + your own) and a **component-preset** catalog (~2,900 real Estes/Apogee/LOC/… parts).
- **Exports**: flight data & drag tables to **CSV**, the **flight path** to **KML / GPX / waypoint CSV** (Google Earth / GPS, with importable custom **templates**), and the 2D schematic to **SVG / PNG / JPG**.
- Multiple named **simulations**, each with full launch setup (rod, site, atmosphere, multi-level wind, earth model).

**Yours, on your device**
- No server, no accounts, nothing uploaded — the physics runs entirely on your device. Your `.ork` designs are **files on your disk** (open / save); the browser just keeps a working copy (so a refresh won't lose your rocket) plus your custom motors, materials, and settings.
- **Responsive** (desktop three-pane workbench → tabbed single column on phones), in **English and Spanish**.

## Getting started

Needs only **Node 22+** — no JDK to run the app (it uses a committed engine build):

```bash
cd web && npm install && npm run dev
```

Full setup — dev server, build, engine rebuild, catalog tools, and tests — is in **[CONTRIBUTING.md](CONTRIBUTING.md)** and the project **Wiki**.

## Layout

- `web/` — the app: Vite + React + TypeScript + Tailwind CSS.
- `engine-java/` — OpenRocket's physics core, extracted + patched for TeaVM and compiled to the WebAssembly + JavaScript modules the app loads (GPL-3.0).

## Documentation

- **[Wiki](https://github.com/thzero/AstraRocketJs/wiki)** — the user guide: getting started, designing a rocket, motors, the views, running simulations, and files/exports.
- **[Architecture & internals](https://github.com/thzero/AstraRocketJs/wiki/Architecture)** — how the extracted engine, motor/material/component data, `.ork` I/O, and swappable stores work (the developer reference).
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — how to report bugs, develop, translate, and submit changes (full guide in the [Wiki](https://github.com/thzero/AstraRocketJs/wiki/Contributing)).
- **[Code of Conduct](CODE_OF_CONDUCT.md)**

## Contributing

Contributions are very welcome — code, bug reports, translations, docs, and more. Start with **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## Status

Engine: working, validated bit-identical against upstream OpenRocket (JVM↔JS, and WASM↔JS). UI: actively developed — component-tree editor, stability, 2D/3D views, motor picker, `.ork` import/export, and flight simulation with charts (run off the main thread in a Web Worker to keep the UI responsive).

**Units are metric/SI only for now** — an imperial / unit-preference option isn't wired up yet, so lengths, masses, etc. are shown in mm/cm/m, g/kg, and so on.

## Attribution & license

The engine derives from the OpenRocket core (a post-24.12 development build; GPL-3.0); the opt-in supersonic-aero (RASAero) extensions are the original work of the mmrocket-sim project. Full credits and license lineage: **[`engine-java/ATTRIBUTION.md`](engine-java/ATTRIBUTION.md)** (and `docs/rasaero/` for the extensions' physics + diffs).

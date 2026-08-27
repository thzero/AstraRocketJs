# AstraRocketJs

A **lightweight, browser-based UI for the OpenRocket engine** — not a full
re-creation of OpenRocket's desktop app, but a fast, mobile-friendly interface over
the same trusted physics, with **full OpenRocket (.ork) support** (open, edit, save
round-trip). Design a rocket, watch its CG/CP/stability update live, and run a full
flight simulation — entirely in the browser, with nothing to install and nothing
uploaded.

The UI is **responsive**: a three-pane workbench (editor · rocket view · motor/sim)
on desktop that collapses to a single stacked, tabbed column on phones. The rocket
view toggles between a **2D schematic** and a **3D model**.

## Highlights

- Runs OpenRocket's **real physics core** (extended Barrowman aerodynamics,
  mass/CG, RK4 flight) in the browser — compiled to JavaScript via TeaVM.
- **Full `.ork` support** — open, edit, and save designs round-trip.
- Live stability (CG/CP/caliber), 2D & 3D views, and flight simulation with
  altitude/velocity/acceleration charts and a 3D flight path.
- Real motor thrust curves (thrustcurve.org) and OpenRocket's material/component
  data. Client-only: your designs stay in your browser.

## Quick start

Needs **Node 22+**. The web app uses a committed engine build, so no JDK is
required just to run it.

```bash
cd web && npm install && npm run dev
```

Open the printed local URL. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full
development setup (typecheck, build, engine rebuild, tests).

## Layout

- `web/` — the app: Vite + React + TypeScript + Tailwind CSS.
- `engine-java/` — OpenRocket's physics core, extracted + patched for TeaVM and
  compiled to the JS module the app imports (GPL-3.0-or-later).

## Documentation

- **[Architecture & internals](docs/ARCHITECTURE.md)** — how the extracted engine,
  motor/material/component data, `.ork` I/O, and swappable stores work. (This is the
  seed for the project **GitHub Wiki**, where user + developer docs live.)
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — how to report bugs, develop, translate,
  and submit changes.
- **[Code of Conduct](CODE_OF_CONDUCT.md)**

## Contributing

Contributions are very welcome — code, bug reports, translations, docs, and more.
Start with **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## Status

Engine: working, validated bit-identical JVM↔JS against upstream OpenRocket. UI:
actively developed — component-tree editor, stability, 2D/3D views, motor picker,
`.ork` import/export, and flight simulation with charts.

## Attribution & license

The engine derives from OpenRocket 24.12 (GPL-3.0-or-later); the opt-in
supersonic-aero extensions are the original work of the mmrocket-sim project. Full
credits and license lineage: **[`engine-java/ATTRIBUTION.md`](engine-java/ATTRIBUTION.md)**
(and `docs/rasaero/` for the extensions' physics + diffs).

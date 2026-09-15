---
title: "Getting Started"
sidebar_position: 5
---
## Open the app

AstraRocketJs runs in your web browser — **there's nothing to install**. Open **[https://thzero.github.io/AstraRocketJs/](https://thzero.github.io/AstraRocketJs/)** and you're ready. It works on desktop and mobile; a modern browser (Chrome, Firefox, Safari, Edge) is all you need.

After that first visit it keeps working **offline**, so you can design and simulate at a launch site with no signal, and your browser will offer to **install** it alongside your other apps — see **[Offline & Installing](./offline-and-installing.md)**.

When it loads you'll see a brief splash while the physics engine loads, then a starter rocket. The header shows a small **`WASM`** or **`JS`** badge indicating which engine backend loaded (WebAssembly is the fast default; JavaScript is the fallback).

## The layout

On a desktop the screen is a **three-pane workbench**:

- **Left — Components.** The rocket's component tree. Add, select, and edit parts here.
- **Center — Rocket view.** Your rocket, with a toolbar to switch views (2D · 3D · Aero · and, after a sim, Flight · 3D path), toggles for the **CG / CP** markers and the quick-glance **info** card, and — in 2D — presets, calipers, and zoom. A **stats strip** along the bottom shows length, mass, CG, CP, stability, and more.
- **Right — Simulations.** Your simulation(s), the **Run** button, launch setup, and results.

On a **phone** the same areas become three tabs along the bottom, because there is no room to show them side by side:

- **Rocket** — the loaded-design banner and the stats strip.
- **Sketch** — the rocket view and its toolbar (2D · 3D · Aero). The 2D and 3D views are turned a quarter turn when you hold the phone upright, so the rocket runs down the long edge of the screen instead of being squeezed into its width; turn the phone sideways and they turn back. Dialogs fill the screen there too.
- **Simulate** — motor, launch setup, **Run**, and the result summary.
- **Results** — the run's numbers (apogee, rod exit, max speed, landing, downrange …) with the flight charts and the 3D flight path below them. It appears once a simulation has produced a result, and a finished run takes you straight to it.

The components panel is desktop-only, so a phone is for reading and simulating a design rather than building one.

The top bar has **undo / redo**, a language switcher (English · Español), and the **app menu**: New, Open… and Save… / Save As… (the in-app design library), **Import ▸ OpenRocket** and **Export ▸ OpenRocket / RASAero II** for `.ork` and other files on disk, **Rocket Design Report**, **Motor Dashboard**, **Settings**, **Help**, **Privacy** and **About**.

## Your first rocket

1. **Start from the default rocket**, or **New** (menu) for a fresh one, or **Open** an existing `.ork` file.
2. **Edit components** in the left panel — select a part and adjust its dimensions; the 2D view and the stability stats update live. See [Designing a Rocket](./designing-a-rocket.md).
3. **Pick a motor** in the right panel. See [Motors](./motors.md).
4. **Set your launch conditions** and press **Run flight simulation**. See [Running a Simulation](./running-a-simulation.md).
5. **Explore the results** — apogee and other tiles, plus the Flight and 3D-path views. See [Views & Analysis](./views-and-analysis.md).
6. Your rocket **saves itself as you work**, and menu → **Open…** switches between saved rockets. To keep a copy on your disk or open it in desktop OpenRocket, use menu → **Export → OpenRocket**. See [Files & Exports](./files-and-exports.md).

## Where your data lives

Your rocket is a `.ork` file **on your disk** — open and save it explicitly. The app also keeps a **working copy in your browser** so a refresh or accidental close won't lose your current design, along with your custom motors, materials, and [settings](./settings.md). Nothing is uploaded anywhere.

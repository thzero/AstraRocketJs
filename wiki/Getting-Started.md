# Getting Started

## Open the app

AstraRocketJs runs in your web browser — **there's nothing to install**. Open the app URL and you're ready. It works on desktop and mobile; a modern browser (Chrome, Firefox, Safari, Edge) is all you need.

When it loads you'll see a brief splash while the physics engine loads, then a starter rocket. The header shows a small **`WASM`** or **`JS`** badge indicating which engine backend loaded (WebAssembly is the fast default; JavaScript is the fallback).

## The layout

On a desktop the screen is a **three-pane workbench**:

- **Left — Components.** The rocket's component tree. Add, select, and edit parts here.
- **Center — Rocket view.** Your rocket, with a toolbar to switch views (2D · 3D · Aero · and, after a sim, Flight · 3D path), toggles for the **CG / CP** markers and the quick-glance **info** card, and — in 2D — presets, calipers, and zoom. A **stats strip** along the bottom shows length, mass, CG, CP, stability, and more.
- **Right — Simulations.** Your simulation(s), the **Run** button, launch setup, and results.

On a **phone**, the same areas stack into a single column with a tab bar; the components panel is hidden to keep the rocket view large.

The top bar has the **app menu** (New / Open `.ork` / Save `.ork` / Settings / About) and a language switcher (English · Español).

## Your first rocket

1. **Start from the default rocket**, or **New** (menu) for a fresh one, or **Open** an existing `.ork` file.
2. **Edit components** in the left panel — select a part and adjust its dimensions; the 2D view and the stability stats update live. See [Designing a Rocket](Designing-a-Rocket).
3. **Pick a motor** in the right panel. See [Motors](Motors).
4. **Set your launch conditions** and press **Run flight simulation**. See [Running a Simulation](Running-a-Simulation).
5. **Explore the results** — apogee and other tiles, plus the Flight and 3D-path views. See [Views & Analysis](Views-and-Analysis).
6. **Save** your design as an `.ork` file (menu → Save). See [Files & Exports](Files-and-Exports).

## Where your data lives

Your rocket is a `.ork` file **on your disk** — open and save it explicitly. The app also keeps a **working copy in your browser** so a refresh or accidental close won't lose your current design, along with your custom motors, materials, and [settings](Settings). Nothing is uploaded anywhere.

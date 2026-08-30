# Designing a Rocket

The **Components** panel (left on desktop) holds your rocket's component tree. As you add and edit parts, the 2D view and the **stability stats** (bottom strip) update live — so you always see the effect of a change on CG, CP, and stability.

## The component tree

A rocket is a tree of components, nose-to-tail, grouped into stages. Select any part (in the tree **or** by clicking it in the 2D view) to edit its properties.

Supported components include:

- **Body components** — nose cone, body tube, transition (shoulder/boattail).
- **Fins** — trapezoidal, elliptical, free-form, and tube fins.
- **Inner structure** — inner tube (motor mount), centering rings, bulkheads, couplers, engine blocks.
- **Recovery** — parachute, streamer, shock cord.
- **Mass & external** — mass component, launch lug, rail button, fairing/pods.

Each part exposes the dimensions and options the engine needs (lengths, radii, thickness, fin geometry, etc.). Editing is debounced — the model rebuilds and the stats refresh as you type/drag.

## Selecting parts from a catalog

Instead of dialing in dimensions by hand, use the contextual **"Select a part…"** pickers to drop in **real manufacturer parts** (Estes / Apogee / LOC / …):

- A **nose cone** or **body tube** picker prefills geometry and material.
- A **parachute** picker (Recovery) prefills diameter and drag coefficient.

Applying a preset just fills in the component's fields — you can tweak it afterward. The catalog is bundled reference data (~2,900 parts); nothing is fetched at runtime.

## Materials

Every structural component has a **material**, which the engine uses (by its **density**) to compute mass and CG:

- **Built-in materials** — OpenRocket's full list (bulk / surface / line, with densities).
- **Custom materials** — define your own (name + density); they're saved in your browser and reusable across designs.

> Note: a material's **density** (and therefore all physics) is preserved through a `.ork` round-trip, but a non-default material's **name** may not yet survive save/reload — see the [FAQ](FAQ).

## Motor mount

To fly, a rocket needs a motor mount (an inner tube) with a motor assigned. Picking and configuring motors is covered in **[Motors](Motors)**.

## Stability at a glance

The bottom **stats strip** always shows the current design's length, max diameter, empty/loaded mass and CG, CP, fineness ratio, and stability (in calibers and % of length, on-pad and at rail exit). More detail is in **[Views & Analysis](Views-and-Analysis)**.

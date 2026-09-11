# Designing a Rocket

The **Components** panel (left on desktop) holds your rocket's component tree. As you add and edit parts, the 2D view and the **stability stats** (bottom strip) update live — so you always see the effect of a change on CG, CP, and stability.

## The component tree

A rocket is a tree of components, nose-to-tail, grouped into stages. Select any part (in the tree **or** by clicking it in the 2D view) to edit its properties.

Branches with children **fold** at their **▾ / ▸** chevrons (or fold/unfold everything from the header), and you can **collapse the whole component list** — its header keeps the selected part in view — to give the property editor more room on a tall design. Deleting a part (the **Delete** button in its properties) asks you to confirm first.

The tree is fully keyboard-navigable: **Tab** into it, then **↑ / ↓** (and **Home / End**) move between parts, **← / →** collapse or expand a branch, and **Enter / Space** selects — so a long tree is a single tab stop, not one per part.

Supported components include:

- **Body components** — nose cone, body tube, transition (shoulder/boattail).
- **Fins** — trapezoidal, elliptical, free-form, and tube fins.
- **Inner structure** — inner tube (motor mount), centering rings, bulkheads, couplers, engine blocks.
- **Recovery** — parachute, streamer, shock cord.
- **Mass & external** — mass component, launch lug, rail button, fairing/pods.

Each part exposes the dimensions and options the engine needs (lengths, radii, thickness, fin geometry, etc.). Editing is debounced — the model rebuilds and the stats refresh as you type/drag.

## Staging (multi-stage rockets)

A rocket can have more than one stage. **+ Stage** (in the Components panel header) appends a **booster** below the current bottom stage; its parts (body, fins, motor mount, recovery) are built and edited exactly like the sustainer's. Select a **stage** node to set how it leaves the stack:

- **Separation** — the event that releases the booster: at **ignition**, **burnout**, **ejection**, **apogee**, an **altitude** (ascending/descending), or **never**. A stage set to *never* stays attached and comes down with the stage above it. An optional **delay** or **altitude** refines the trigger.
- **Upper-stage ignition** — an upper stage's motor lights on the booster's **burnout** or **ejection charge** (or **never**); set this on the motor card (see **[Motors](Motors)**).

You can also add **pods** (podsets) and **parallel** (strap-on) boosters as assemblies. After a staged flight, the **[Flight charts](Views-and-Analysis#flight-after-a-simulation)** plot each stage's own trajectory.

> Staged flights **simulate** as independent branches — each spent booster flies, deploys, and lands on its own — and static mass / CG / stability match desktop OpenRocket. The staged *flight trajectory* itself is not yet validated against OpenRocket end-to-end, so treat multi-stage flight numbers as preliminary.

## Undo / redo

Every edit is undoable. Use the **↶ / ↷** buttons in the top bar, or `Ctrl/⌘+Z` to undo and `Ctrl+Shift+Z` (or `Ctrl+Y`) to redo. One interaction is one step — a whole slider drag or a typed value undoes in a single press, not character by character.

Undo/redo covers the **whole workspace** on one timeline: adding, removing, moving, and editing components, **and** simulation changes (motor, ignition, launch conditions, and adding/renaming/deleting simulations). It restores your selection too, so you land back on the part that changed. Opening a `.ork` or starting a new design clears the history (a fresh document has nothing to undo across). Undo restores your *inputs*; cached flight results are cleared, so re-run to see the flight.

## Scaling the whole rocket

The **⤢ Scale** button (next to the rocket's name in the Components panel) resizes the entire design by one factor — the "build this plan at half size" or "upscale to a bigger tube" workflow. Enter a **factor** (with 0.5× / 2× shortcuts), or type a **target body diameter** and the factor follows (the two are linked, so you can scale straight to the tube you're building in). A live summary shows the before → after length and diameter.

It multiplies every length, diameter, wall thickness, fin planform (freeform points included), shoulder, tab, fillet, chute and streamer size, cord length, and axial position. It deliberately does **not** scale angles, fin/instance counts, material densities, drag coefficients, finish, motor choice, or launch settings; fixed-size hardware (camera shrouds, rail buttons, a launch lug's bore) keeps its size and just moves to its new station.

Solid parts keep their material, so their mass grows as the **cube** of the factor. Recovery fabric doesn't — a canopy scales with its area — so a scaled design is no longer exactly similar and its stability shifts slightly; re-check the parachute size and that the motor still fits its mount. The whole scale lands as a **single undo step** (`Ctrl/⌘+Z`).

## Selecting parts from a catalog

Instead of dialing in dimensions by hand, use the contextual **"Select a part…"** pickers to drop in **real manufacturer parts** (Estes / Apogee / LOC / …):

- A **nose cone** or **body tube** picker prefills geometry and material.
- A **parachute** picker (Recovery) prefills diameter and drag coefficient.

Applying a preset just fills in the component's fields — you can tweak it afterward. The catalog is bundled reference data (~2,900 parts); nothing is fetched at runtime.

### Sizing a parachute

Selecting a **parachute** shows a **descent-sizing** readout in its panel. From the design's descent mass (see *recovery weight*) and the air density at the launch site, it gives:

- the **descent rate** this canopy actually produces (m/s and ft/s), color-coded against the accepted **main** (15–20 ft/s) and **drogue** (50–75 ft/s) bands, and
- the **canopy diameter** you'd need to hit each band, at this canopy's own drag coefficient.

It needs a motor loaded (to know the descent mass). It's an on-screen aid only — nothing is written to the design.

## Materials

Every structural component has a **material**, which the engine uses (by its **density**) to compute mass and CG:

- **Built-in materials** — OpenRocket's full list (bulk / surface / line, with densities).
- **Custom materials** — define your own (name + density); they're saved in your browser and reusable across designs.

> Note: a material's **density** (and therefore all physics) is preserved through a `.ork` round-trip, but a non-default material's **name** may not yet survive save/reload — see the [FAQ](FAQ).

## Motor mount

To fly, a rocket needs a motor mount (an inner tube, or any body/inner tube with its **Motor mount** box checked) with a motor assigned. Picking and configuring motors is covered in **[Motors](Motors)**.

Mounts and motors stay in sync automatically: add a mount and it comes pre-loaded with a default motor; remove one and its motor is cleaned up. Because a design can't be simulated without one, deleting (or un-checking) your **only** motor mount asks for confirmation first.

## Stability at a glance

The bottom **stats strip** always shows the current design's length, max diameter, fineness ratio, empty/loaded mass and CG, CP, recovery weight (descent mass), stability (in calibers on the pad and as % of length), the Mach-0.3 drag coefficient and normal-force slope, and the loaded roll/pitch moments of inertia. More detail is in **[Views & Analysis](Views-and-Analysis)**.

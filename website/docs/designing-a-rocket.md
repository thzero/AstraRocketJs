---
title: "Designing a Rocket"
sidebar_position: 8
---
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

### Dual deployment

A parachute or streamer carries a **Drogue (dual deployment)** tick. Tick it on the device that opens at apogee and the flight is flown as dual deployment: a small drogue first to bring the rocket down under control, then the main lower down.

It is not only a label. The simulation judges a deployment differently depending on it, and warns on the main coming out too fast or too slow, and on a drogue too slow at apogee to inflate, against the thresholds in **[Settings ▸ Safety warnings](./settings.md#safety-warnings)**. Leave every device clear and the whole stage is single deployment, judged against the one threshold instead.

### What goes inside a mass component

A mass component is not only a lump of ballast — it can hold inner structure of its own, so an altimeter bay or a payload sled can be modeled as the sled plus the rings, bulkheads, hardware and recovery gear nested inside it. Add parts to it the same way as to a body tube.

## How dimensions are stated

**Every round dimension is a diameter.** That is how tubes are sold, how the parts catalog lists them, how the component tree labels them and how OpenRocket states them. `.ork` files store radii internally and always have; that is a detail of the file, and the number you type is never one of them.

**A tube also states its bore.** Body tubes, inner tubes, couplers, engine blocks, tube fins and launch lugs show an **inner diameter** between the outer diameter and the wall thickness. It is not a fourth independent number: a tube has an outside and a wall, and the bore is what the two leave. Typing a bore therefore changes the **wall**, and leaves the outer diameter alone, because the outside of a tube is usually decided by what it has to slide into. A bore wider than the tube itself is clamped to a wall of zero rather than a negative one.

That makes the fit questions direct ones. Does the motor go in? Compare the motor's diameter to the mount's inner diameter. Does the coupler fit the tube? Its outer diameter against the tube's inner diameter. Will the rod clear the lug? The lug's inner diameter, which until now was whatever the file happened to carry, since there was no field for a lug's wall at all.

**A shoulder can follow the tube it plugs into.** Beside each shoulder diameter, on a nose cone and on both ends of a transition, is a switch. With it on, the diameter is the bore of the part next door - the one below a nose cone, above and below a transition - and it stays that way: widen the tube's wall and the stub that goes into it follows in the same keystroke. The box is a readout while the switch is on, and turning the switch off pins whatever the number currently is.

Only the diameter follows. How far the shoulder reaches into the tube is yours, so a part with the switch on and no shoulder length still has no shoulder, which is the right place to start from.

The switch is on for parts you add here, and off for everything read from a file, because in a file an absent shoulder means the part has none. Nothing you import grows one. `.ork` has no way to record the switch, so a file written here carries the resolved number and a round trip through desktop OpenRocket freezes it at that value.

**A shoulder has a wall, and can be capped.** Each one carries its own thickness, and a **Capped** switch that closes its far end with a disc of the part's own material. The disc is as thick as the shoulder's wall, so it is what turns a nose cone into a closed bay you can put nose weight or an altimeter behind. Both count toward mass, CG and the moments of inertia. A transition has a set per side, fore and aft, and they are independent.

Leave a shoulder's thickness blank and OpenRocket fills it from the part's own wall the moment the shoulder gets a length, so an absent value is not a zero one.

## Required dimensions

Some dimensions define what a part *is*. A body tube with no diameter is not a narrow tube, it is nothing — so those fields are marked, and a design that is missing one cannot be flown.

A required field carries a small red **\*** after its label, always, whether or not it is filled. That is there so you can see what a part needs *before* you have left anything blank.

If a required dimension is **zero**, the field escalates: the label is boxed in red and the input gets a red outline. The tooltip says why.

**You cannot leave one empty by accident.** Clearing the box shows it empty while you type, but nothing is written — tab away and the previous value is still there. (Focus is never trapped; you can always leave the field.) Typing an explicit **0** *is* stored, because that is a deliberate statement rather than a slip, and it is flagged and refused rather than silently flown.

### Which dimensions are required

| Component | Required |
| --- | --- |
| Nose cone | length, diameter, thickness |
| Body tube | length, diameter, thickness |
| Transition | length, fore diameter, aft diameter, thickness |
| Trapezoidal / elliptical fin set | fin count, root chord, height, thickness |
| Free-form fin set | fin count, thickness |
| Tube fin set | tube count, length, tube diameter, thickness |
| Inner tube | length, diameter, thickness |
| Coupler, engine block | length, thickness |
| Centering ring | thickness |
| Bulkhead | thickness |
| Launch lug | length, diameter |
| Rail button | outer diameter |
| Parachute | diameter, drag coefficient |
| Streamer | length, width, drag coefficient |
| Mass component | mass |
| Pod set / parallel stage | instance count |

**Diameters that fill their parent are left blank.** A coupler, engine block, centering ring or bulkhead takes its outer diameter from whatever it sits in, and a centering ring takes its inner diameter from the motor mount running through it, so leaving those empty is a real answer rather than a gap — it is what `.ork` files call *auto*, and the value follows along when you resize the tube. In the editor it is the small checkbox beside the field, and a new coupler, engine block, centering ring or bulkhead arrives with it ticked, so the part is the right size for the airframe you dropped it into before you touch it. Untick it, or pick a part from the catalog, and the number you give is used instead. A centering ring with no motor mount beside it has an inner diameter of zero, which is a solid disc: that is what desktop OpenRocket gives too. An inner tube is the exception to all of it: it *is* the motor mount, so its size is the thing being stated.

Everything else may legitimately be zero, which is why it is not marked. A **tip chord** of 0 is a delta fin; **sweep** or **cant** of 0 is a straight one; a **shoulder** or **fin tab** of 0 is simply absent; **motor overhang** 0 is flush; a centering ring's **inner diameter** of 0 is a solid disc; a mass component's **length** of 0 is a point mass; and every **delay** and **angle offset** starts at 0. A stage has no required fields at all — its settings are triggers and delays.


## Fin fillets {#fin-fillets}

A fin set's **Fillet** section takes the radius of the glue bead along the fin root and the material the bead is made of. Both count: the fillet's volume is added to every fin's mass and its centroid pulls the CG aft, the same way desktop OpenRocket computes it.

The material matters because a fillet is rarely the fin's own. A 6 mm bead on three fins around a 26 mm tube is about 1.1 g in cardboard and 2.0 g in something epoxy-dense, and the CG moves a couple of millimeters with it. Leave the material unset and the bead is weighed as cardboard (680 kg/m³), which is what the kernel and the `.ork` writer both fall back to. Pick one of the [adhesives](#adhesives) instead, or add your own with the material picker.

**Tube fins have no fillet.** A tube fin set is a tube, not a fin, so the kernel has no fillet to give it and the section does not appear.

**A fillet's material list holds adhesives only**, and a structural part's list holds everything but. To use something unusual, add it with **＋ Add custom…** and file it under Adhesives. A material a part already uses stays in its list either way.


## Freeform fins {#freeform-fins}

A **freeform** fin set is shaped point by point instead of from a trapezoid's dimensions. Select one and the property panel shows a **Fin outline** editor.

- **Drag an amber point** to move it.
- **Tap a blue midpoint** on an edge to insert a point there.
- **Select a point** to delete it, or to type its exact coordinates.

The axes are the fin's own: **X runs along the body**, from the front of the root to the back, and **Y is height above the body surface**. The root edge closes the outline along Y = 0, so you shape the leading edge, the tip and the trailing edge, not the root.

The outline drives the real thing, not just the drawing: mass, CG and the aerodynamics all follow it, and [scaling the whole rocket](#scaling-the-whole-rocket) moves the points with everything else. It round-trips through `.ork` and RockSim files.

## Staging (multi-stage rockets)

A rocket can have more than one stage. **+ Stage** (in the Components panel header) appends a **booster** below the current bottom stage; its parts (body, fins, motor mount, recovery) are built and edited exactly like the sustainer's. Select a **stage** node to set how it leaves the stack:

- **Separation** — the event that releases the booster: at **ignition**, **burnout**, **ejection**, **apogee**, an **altitude** (ascending/descending), or **never**. A stage set to *never* stays attached and comes down with the stage above it. An optional **delay** or **altitude** refines the trigger.
- **Upper-stage ignition** — an upper stage's motor lights on the booster's **burnout** or **ejection charge** (or **never**); set this on the motor card (see **[Motors](./motors.md)**).

You can also add **pods** (podsets) and **parallel** (strap-on) boosters as assemblies. After a staged flight, the **[Flight charts](./views-and-analysis.md#flight-after-a-simulation)** plot each stage's own trajectory.

> Staged flights **simulate** as independent branches — each spent booster flies, deploys, and lands on its own — and static mass / CG / stability match desktop OpenRocket. The flown trajectory is checked against unmodified upstream OpenRocket as well: identical event sequences on every branch, and apogee agreeing to 1e-5 relative.

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

### Saving your own parts

A part you built belongs in that picker too. **Save as part**, under the picker in the component panel, stores the component as it stands and offers it back on every design in that browser. Your own parts are listed first, marked with a ★, and the ✕ beside one removes it.

It saves the **whole component**, not only the dimensions the picker's columns show: the material and finish, a nose cone's shoulder, a parachute's line count, a body tube's motor-mount flag, the color. Saving again under the same maker and part name replaces the earlier copy. Parts attached to the one you save (its fin set, its inner tube) are not saved with it.

Saved parts live in your browser alongside your custom materials and imported motors, so they follow you between designs but not between machines.

**Menu → My Parts** is the library itself: every saved part of every type, whatever the open design happens to contain. The list is on the left, grouped by type; selecting a part opens it on the right. It is offered wherever the Components panel is, and goes with it: a saved part is applied through a component, so a window that cannot add the component it belongs on would open the library onto a design it has no way to put anything into. The picker inside a part's own editor is a different thing and stays, since it re-sizes a part the design already has.

The editor uses the same fields the component panel does, in the same units, so a saved nose cone is edited as a nose cone: rename it, change its maker or notes, change its shape, length, diameter, shoulder, material or color. **Save** writes it in place and leaves it selected, so a rename does not leave the old copy behind and you can work down the list without reopening anything. **Discard** puts the part back as it was stored, and switching to another part with unsaved edits asks first. **Delete** is in the same row, at the other end, and also asks. What the editor leaves out is the half of the panel that describes a part's place in a rocket (position, move, the fit-ranked picker, the descent-rate readout), because a saved part has no parent and no design to be judged against until you apply it. The picker only opens when a component of a matching type is selected, so it is not the place to manage a saved bulkhead on a rocket that has no bulkhead in it. Deleting asks first, in both places, because the design a part came from may be long gone.

### Sizing a parachute

Selecting a **parachute** shows a **descent-sizing** readout in its panel. From the design's descent mass (see *recovery weight*) and the air density at the launch site, it gives:

- the **descent rate** this canopy actually produces, in your [velocity unit](./settings.md#units), color-coded against the accepted **main** (15–20 ft/s) and **drogue** (50–75 ft/s) bands, and
- the **canopy diameter** you'd need to hit each band, at this canopy's own drag coefficient.

It needs a motor loaded (to know the descent mass). It's an on-screen aid only — nothing is written to the design.

## Materials

Every structural component has a **material**, which the engine uses (by its **density**) to compute mass and CG. A part you add carries one from the moment it exists: whatever you set in [Settings ▸ Materials](./settings.md#materials), or else the stock material the engine would weigh it with anyway: **Cardboard** for a solid part, **Ripstop nylon** for a canopy, **Elastic cord** for shroud lines and shock cord. Those are OpenRocket's own defaults, the same ones it builds every new component with.

A part can still read **Not specified** if it came from a design saved before this app named them. It is not a weightless part: the engine falls back to the same three materials. Pick one from the list and the panel stops guessing.

- **Built-in materials** — OpenRocket's full list (bulk / surface / line, with densities). Each kind has its own [density unit](./settings.md#units) — bulk stock by volume, parachute fabric by area, cord by length — and a custom material's density is read in whichever unit is shown.
- **Custom materials** — define your own (name, density and which group it belongs in); they're saved in your browser and reusable across designs. A custom material sits **in that group**, marked with a ★, rather than in a group of its own: it is usually a variant of something already in the list, and it reads better beside it. Give one the **same name as a built-in** and it replaces that entry at your density instead of appearing twice.

> Note: a material's **name and density** both survive a `.ork` round-trip, including for a material this app has and desktop OpenRocket does not. What does not travel is its membership of your own custom list — see the [FAQ](./faq.md).

The material list is **OpenRocket's own**: all 32 bulk, 8 surface and 42 line materials, with the same names, densities and groups. The app adds the two things below.

### Two corrected elastic cords {#corrected-materials}

Flat elastic cord in 19 mm and 25 mm is listed a second time as **Elastic cord, corrected**, at 0.0123 and 0.016 kg/m. The original entries are unchanged, so a design that already names one keeps the density it was saved with. Pick the corrected one on a new design.

### Adhesives {#adhesives}

The app adds an **Adhesives** group, for fin fillets. Every density below is read off a manufacturer document, cited in the table and carried in the `source` and `note` fields of the entry itself.

| Material | kg/m³ | What the figure is | Source |
|---|---|---|---|
| West System 105/205 Fast | 1180 | cured specific gravity 1.18 | [TDS](https://www.westsystem.com/app/uploads/2022/09/105_205-207-Combined.pdf) |
| West System 105/206 Slow | 1180 | cured 1.18 | [TDS](https://www.westsystem.com/app/uploads/2022/09/105_205-207-Combined.pdf) |
| West System 105/207 Clear | 1150 | cured 1.15 | [TDS](https://www.westsystem.com/app/uploads/2022/09/105_205-207-Combined.pdf) |
| West System 105/209 Extra Slow | 1160 | cured 1.16 | [TDS](https://www.westsystem.com/app/uploads/2022/09/105_205-207-Combined.pdf) |
| West System Six10 | 1180 | cured 1.18 (resin 1.17, hardener 1.04) | [TDS](https://www.westsystem.com/app/uploads/2022/12/Six10-Technical-Data-Sheet.pdf) |
| West System G/5 Five-Minute | 1210 | cured 1.21 | [TDS](https://eu.westsystem.com/app/uploads/2022/12/G5-Five-Minute-Epoxy-Adhesive-2024.pdf) |
| AeroPoxy PR2032/PH3660 | 1110 | cured 1.11 | [PTM&W bulletin](https://web.archive.org/web/20220626225252/https://www.ptm-w.com/aeropoxy/AEROPOXY%20Product%20Bulletins/AEROPOXY%20PR2032%20Bulletin%20w-4%20Hardeners%2024Jun08.pdf) |
| AeroPoxy ES6209 | 1090 | cured 1.09 (resin 1.10, hardener 0.98) | [PTM&W bulletin](https://web.archive.org/web/20240712145738/https://www.ptm-w.com/aeropoxy/AEROPOXY%20Product%20Bulletins/AEROPOXY%20ES6209%20Bulletin.pdf) |
| RocketPoxy G5000 | 1500 | "specific gravity mixed 1.50" | [Glenmarc datasheet](https://www.glenmarc.com/datasheets/EPOXY/RP_G5000_DATASHEET.pdf) |
| TotalBoat High Performance | 1080 | **mixed liquid**: resin 1.11, hardener ~1.00, 2:1 by volume | [SDS](https://portal.sdsguru.com/SDS/Download/26223), [mix ratios](https://www.totalboat.com/products/high-performance-epoxy-resin) |
| BSI Quik / Mid / Slow-Cure | 1060 | **mixed liquid**: SDS pair 0.97 / 1.15, 1:1 by volume | [SDS](https://bsi-inc.com/sds_pdf/sds_slow_cure.pdf) |
| J-B Weld Original | 1840 | **mixed liquid**: Part A 1.78, Part B 1.902, 1:1 by volume | [Part A SDS](https://cecas.clemson.edu/cedar/wp-content/uploads/2016/10/J-B-Weld.pdf), [Part B SDS](https://media.napaonline.com/is/content/GenuinePartsCompany/2118182pdf) |
| Carpenter's glue (PVA, dried) | 1190 | dried film; see below | [Titebond III TDS](https://ardec.ca/media/catalog/specs/tds-titebond-III-ultimate-wood-glue.pdf) |

Notes on the figures:

- **Cured, not mixed.** West System, AeroPoxy and RocketPoxy give the cured solid. The rest give their liquid components at the maker's ratio; a cured bead runs 2 to 3 percent denser.
- **Carpenter's glue** is the dried figure. Model the bead after it dries, not as squeezed out.
- **A thickened fillet is a different material.** Microballoons drop a West System bead to roughly 600 to 800. Weigh your own mix and add it as a custom material.
- **ProLine 4500 is absent**: the maker publishes no density. To add it, weigh a known volume and divide.

## Motor mount

To fly, a rocket needs a motor mount (an inner tube, or any body/inner tube with its **Motor mount** box checked) with a motor assigned. Picking and configuring motors is covered in **[Motors](./motors.md)**.

Mounts and motors stay in sync automatically: add a mount and it comes pre-loaded with a default motor; remove one and its motor is cleaned up. Because a design can't be simulated without one, deleting (or un-checking) your **only** motor mount asks for confirmation first.

## Stability at a glance

The bottom **stats strip** always shows the current design's length, max diameter, fineness ratio, empty/loaded mass and CG, CP, recovery weight (descent mass), stability (in calibers on the pad and as % of length), the Mach-0.3 drag coefficient and normal-force slope, and the loaded roll/pitch moments of inertia. More detail is in **[Views & Analysis](./views-and-analysis.md)**.

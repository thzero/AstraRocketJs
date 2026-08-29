# Desktop OpenRocket parity

The **classic** aerodynamic model (labelled "OpenRocket – Extended Barrowman") has one job: reproduce
what **desktop OpenRocket** computes for the same design — *right or wrong*. That is the point of a
cross-check model. If desktop freezes the CP at the slender-body value above Mach 1 (which is
physically pessimistic), the classic model freezes it too, because a user comparing to their desktop
install expects the same number. Physics *improvements* do not go into the classic model; they go into
the **opt-in** models (`supersonicAero`, RASAero-style), which deliberately deviate and are **off by
default**. See also `flight-parity-determinism.md` (browser-vs-reference) and
`../engine-java/README.md` → "What matches OpenRocket means here".

This note records three places where "match desktop" required a specific choice.

## 1. Airfoil / nozzle drag stays out of the classic model

**OpenRocket fins have exactly three cross-sections — `SQUARE`, `ROUNDED`, `AIRFOIL` — and that is the
entire list the OpenRocket engine knows.** Anything else below belongs to the **RASAero extension**
(mmrocket-sim's original work, added to support the RASAero model — see
`../engine-java/ATTRIBUTION.md`), **not** OpenRocket:

- **Cross-section** (`SQUARE` / `ROUNDED` / `AIRFOIL`) — OpenRocket's own fin shape. It affects drag
  (`FinSetCalc.calculatePressureCD` branches on it), and the classic model computes it identically to
  desktop.
- **Airfoil *section*** (RASAero feature #4 — `hexagonal` / `naca` / `doublewedge` / `biconvex` / …) —
  a *separate extra field* (`airfoilSection`) that mmrocket added to the fin for RASAero, with its own
  thickness-wave drag model (`sectionPressureCD`). **OpenRocket has no such concept**; it is off by
  default and belongs only to the RASAero model.

The bug was **cross-pollination**: the RASAero fin definitions (and RASAero nozzle-exit base drag) were
feeding the **OpenRocket / classic** model instead of being confined to the RASAero model —

- Setting a detailed **airfoil section** changed classic drag through the RASAero `sectionPressureCD`
  (up to ~8× on the fin pressure term; on one supersonic test case that term was 54–62% of total
  drag) — even though OpenRocket has no section model and would just use the plain cross-section drag.
- **RASAero-style nozzle-exit base drag** changed classic power-on drag. OpenRocket has no such term.

Both are now confined to the opt-in models (the `RASAero{Stability,Drag}Calculator` strategy) and do
nothing in the classic model. **The classic model's score in the validation harness got *worse* as a
result** — because it had been quietly scoring on a different physics model instead of OpenRocket's.
That is the correct outcome: a model that scores better by running non-OpenRocket physics is not the
classic model. If you use the classic model as a desktop cross-check, it is now comparable to desktop.

*(Engine-side; done during the OpenRocket-unstable migration. The classic branch in `FinSetCalc` /
`SymmetricComponentCalc` is bit-identical to stock; the extensions only activate behind their flags.)*

## 2. Old `.ork` files: automatic ("auto") diameters

OpenRocket **15.03 and earlier** write an automatic diameter as a bare `auto` with **no number**.
This app used to fall back to a fixed 12 mm, so a 4-inch airframe imported as a 12 mm tube — which,
with a full-size nose cone on a shrunken body, charges a large diameter-step pressure/base drag and
imports **3–4× too much drag**. On one shared design that meant **5,939 ft** predicted where desktop
OpenRocket had stored **15,927 ft** in the same file.

Bare `auto` is now **resolved from the neighbouring component the way desktop does it** — a forward
pass inherits the previous component's aft radius, a backward pass covers a leading `auto` from the
next component's fore radius, and only a truly isolated `auto` falls back to 12 mm. The import surfaces
a note listing what was inferred. (`web/src/services/orkFile.ts` — `radiusField` / `resolveAutoRadii`;
modern files that write `auto 0.05` were always read correctly.)

> **If you have an archived design that always looked draggy, re-open it and save it again to update.**

## 3. Motor weights come from the data file

thrustcurve.org publishes **two** mass claims for the same motor: the **catalogue** record and the
header of the **data file** the thrust curve itself comes from — and they can disagree. Example,
AeroTech **K480W**: catalogue **2078 / 1292 g** (loaded / propellant) vs the file's **2059 / 1232 g**.
This app previously took the curve from the file but the weights from the catalogue. Desktop reads the
file, so now this app does too (`web/src/services/thrustcurve.ts` — `parseSimfileMasses` reads RASP
`.eng` and RockSim `.rse` headers; on any failure it falls back to the catalogue, so it is never a
regression).

> **This shifts motor weights slightly for every motor**, so altitudes move a little against older
> runs — **toward desktop, not away**. With a given design and motor, the classic model should now
> reproduce the numbers desktop OpenRocket saved into the file.

# FakeRocket — TODO / roadmap

## 3D flight-path view (Simulate tab)
Add a 3D visualization of the **flight trajectory**, not just the altitude chart.

- **Reference:** Vector Celeste's `web-ui/app/Flight3D.tsx` (raw three.js — no react-three-fiber) animates the rocket along its path. We already have `three` + `@react-three/fiber` + `@react-three/drei` from the 3D rocket view, so a fiber version fits our stack.
- **Data:** the sim already returns per-sample series (`time`, `altitude`, `velocity`, plus the position symbols `Px`/`Py` and flight events). Build the trajectory polyline from those; mark **apogee**, **burnout**, **recovery deployment**, and **ground hit** from `FlightResult.events`.
- **Scope:** a 3D arc (launch → apogee → descent) with the ground plane, the rocket model (reuse `Rocket3D` geometry) traveling along it, orbit controls, and a scrub/play control tied to `time`. Color the path by phase (boost/coast/descent).
- **Where:** Simulate tab, alongside or replacing the flat `AltitudeChart` (keep the chart as a 2D option).

## Other flagged roadmap items
- **Component-tree editor** — migrate the editor from the fixed `RocketSpec` to `buildTree(RocketTree)`. Unlocks transitions, staging, multiple sections, and *placing* the inner components already in the catalog (tube couplers, centering rings, bulkheads). mmrocket's `TreeSchematic` already supports the editing props we don't pass yet (`onPatchNode` drag-to-reposition, `selectedId`/`onSelect`) — pair with a `PropertyPanel`.
- **`.ork` export of launch/sim conditions** — geometry + motors round-trip; the `<simulation>` block is dropped on re-save. Wire it back through `exportOrk`.
- **Mass-override from component presets** — a `.orc` part's measured `Mass` isn't applied (no mass-override in the facade). Same for `.rse` per-sample masses.
- **`.rse` (RockSim) motor import** — currently `.eng` only.
- **Custom component presets** — user-added parts, mirroring custom motors/materials (a `PresetStore`).
- **Lazy-load the components catalog** — `components.generated.json` is ~880 KB bundled; candidate for dynamic import.

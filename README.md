# AstraRocketJs

A browser-based rocket design & flight-simulation app powered by the **OpenRocket engine**. Design a rocket, watch its CG/CP/stability update live, and run a full flight simulation — entirely in the browser. The UI is **responsive**: a three-pane workbench (editor · rocket view · motor/sim) on desktop that collapses to a single stacked, tabbed column on phones. The rocket view toggles between a **2D schematic** and a **3D model**.

## Layout

- `engine-java/` — the OpenRocket 24.12 physics core, extracted + minimally patched for TeaVM, compiled to a JS module.
  (GPL-3.0-or-later; see `engine-java/ATTRIBUTION.md` and `engine-java/patches/LEDGER.md`).
- `web/` — the responsive UI: Vite + React + TypeScript + Tailwind CSS. Consumes the engine through a typed wrapper (`web/src/engine/openRocketEngine.ts`).

## Architecture

AstraRocketJS runs the **OpenRocket physics kernel** in the browser compiled for Javscript.

### The extracted engine (`engine-java/src/java/`)

OpenRocket's full `core` module is ~700 Java files and pulls in Guice, JAXB, GraalVM-JS and classgraph — none of which TeaVM (the Java→JavaScript compiler) can handle. **Extraction** is a one-time copy of just the ~259 files the physics and simulation actually need, leaving behind all the reflection-heavy machinery (file loaders, plugin system, scripting, GUI hooks).

`src/java/` is therefore verbatim OpenRocket 24.12 source with a handful of tiny TeaVM-compatibility edits already applied (documented in `patches/LEDGER.md` — e.g. `UUID`→`LongUUID`, one concurrent map swapped for a plain one, a reflection-free aerodynamic calculator lookup). **This is the engine** — when the UI calls `staticInfo()` or `simulate()`,  this is the code that runs. Don't edit extracted files directly; changes go through a documented patch in `patches/LEDGER.md` (only when upgrading the upstream OpenRocket version).

Extracted sources by area:

| files | package | what it is |
|------:|---------|------------|
| 73 | `rocketcomponent` | rocket model: nose cone, body tube, fins, stages, motor mounts, flight configs |
| 59 | `util` | math/geometry helpers (Coordinate, quaternions, interpolation) |
| 38 | `simulation` | flight simulator: RK4 integrator, steppers, flight events/data |
| 16 | `unit` | unit system (SI internally) |
| 13 | `aerodynamics` | Extended Barrowman CP / drag / stability |
| 10 | `motor` | thrust-curve motor model |
| 10 | `models` | atmosphere (ISA), gravity, wind |
| 4 | `masscalc` | CG / mass / moment-of-inertia |
| … | rest | logging, i18n, materials, presets, appearance |

### Build → run pipeline

1. `engine-java/` (extracted core + `src/shims/` JVM-only replacements + `src/jdkstubs/` a JDK `Collator` stand-in + `src/api/OpenRocketEngine` @JSExport facade) is compiled by TeaVM into one JS module.
2. That module is committed at `web/src/engine/vendor/openrocket-engine.mjs`, so the web app builds without a JDK.
3. `web/` imports it through the typed `openRocketEngine.ts` wrapper; React never touches the raw module.

TeaVM requires `optimization = NONE` + `fastGlobalAnalysis = true` (see `engine-java/build.gradle`) — its default optimizer miscompiles the kernel (zeroes masses / collapses fin instances).

## Run

```bash
# 1. (optional) rebuild the engine JS — needs a JDK; output is committed so this is rarely needed
cd engine-java && node build-engine.mjs   # gradlew generateJavaScript + copy into web/ vendor

# 2. run the web app (needs Node 22+)
cd web && npm install && npm run dev
```

Open the printed local URL. **Build** tab: edit the rocket, see stability live on the ide-profile (CG ▲ blue, CP ● red). **Simulate** tab: run a C6 flight and see apogee + the altitude curve.

## Motor data & thrust-curve caching

Motors come from [thrustcurve.org](https://www.thrustcurve.org), in two tiers that keep recurring API load to essentially one scheduled job:

1. **Catalog (build-time).** `web/scripts/sync-motors.mjs` sweeps thrustcurve for every available, license-clean motor and writes the specs to `web/src/data/motors.generated.json` (~811 motors). This is a **build artifact** — refresh it by re-running the sweep on a schedule (e.g. a monthly CI job), committing, and redeploying:

   ```bash
   cd web && node scripts/sync-motors.mjs   # regenerate the bundled catalog
   ```

   The app loads the bundle and mirrors it to `localStorage` (`tc:catalog`), stamped with a content signature so a freshly re-synced bundle supersedes the mirror automatically — the catalog is never fetched from thrustcurve at runtime.

2. **Thrust curves (runtime, on demand).** The catalog carries specs but no curve. When a motor is picked, `web/src/services/thrustcurve.ts` resolves it (`search.json`) and pulls its curve  (`download.json`), then builds the engine `MotorSpec` (trapezoidal impulse → per-sample mass).
   Everything is cached in `localStorage`:

   | key | holds | refetched |
   |-----|-------|-----------|
   | `tc:catalog` | the bundled catalog | never (build-time; signature-invalidated) |
   | `tc:v1:meta:<mfr>:<desig>` | resolved metadata (motorId, dims, weights) | after the TTL |
   | `tc:v1:samples:<motorId>` | the thrust curve | after the TTL |
   | `tc:v1:motor:<mfr>:<desig>:<delay>` | the built `MotorSpec` | after the TTL |

   Curves are **not immutable** (contributors revise the sample files), so the per-motor caches carry a **90-day TTL** (`CACHE_TTL_MS` in `thrustcurve.ts`) and revalidate **lazily, stale-while-revalidate**: a re-fetch happens only for a motor the user picks *again* *after* its cache has aged out, and a failed refresh falls back to the stale curve (offline-safe). Bump `CACHE_VERSION` to invalidate every per-motor cache at once.

   **Imported motors.** A user can import a `.eng` (RASP) file — it carries its own thrust curve,  so it needs no thrustcurve lookup: `engParser.ts` parses it, the `MotorStore` persists it  (`motors:custom`), `loadCatalog()` merges it into the picker (flagged, deletable), and  `fetchMotorSpec` builds its `MotorSpec` from the stored samples. This is user content, symmetric to custom materials.

   The catalog mirror, per-motor entries, and imported motors all persist through the swappable  **`MotorStore`** (`web/src/services/motorStore.ts`; default `KeyValueMotorStore` over  `localStorage`), which owns the freshness policy (catalog signature, per-entry TTL). Replace it
   with `setMotorStore(...)` to move motor data elsewhere — see **Where user data lives** below.

## Materials

Unlike motors, materials are **not** an external feed — OpenRocket's built-in materials are a static list. They live in two places:

- **Built-ins** — `web/src/data/materials.ts` ports the full upstream list (~61 materials:
  bulk / surface / line, with densities and groups) from OpenRocket's `Databases.java`. The
  editor's material picker reads them; the engine reproduces OpenRocket's mass/CG because it
  applies a material by its **density**.
- **Custom materials** — user-defined (name + density), persisted under `materials:custom`,
  merged into the picker, and reusable across designs. The kernel accepts any density directly,
  so a custom material is just a named density. `materials.ts` owns the domain rules;
  `materialStore.ts` is a typed store that sits on top of the shared key-value store (below).

The material selection is applied to the kernel as a density override (`materialDensity`). The
one piece still to come is round-tripping material *names* through `.ork` — that needs the full
built-in list ported into the engine shim (`engine-java/src/shims/.../database/Databases.java`,
currently only the built-in *defaults*) plus an engine rebuild, and is folded into the `.ork`
task. Commercial **component presets** (real Estes/Apogee/LOC parts) are a separate, deferred
catalog — those are serialized databases that would need a motor-style build-time JSON export.

## Components

Real manufacturer parts (Estes/Apogee/LOC/BlueTube/…), extracted from the **OpenRocket-Components
DB** ([`dbcook/openrocket-database`](https://github.com/dbcook/openrocket-database)) — the
community-maintained `.orc` parts database OpenRocket's component data comes from — the third and
last reference catalog (after motors and materials). (OpenRocket calls these "component presets";
here it's just the components catalog, symmetric with motors.)

- **`web/scripts/sync-components.mjs`** reads the `.orc` XML, resolves each part's material to a
  density, normalizes units to SI, and writes **`web/src/data/components.generated.json`**
  (~2,940 parts, six types: body tubes, nose cones, parachutes, tube couplers, centering rings,
  bulkheads). Point `--src` at a checkout of the components DB's `orc/` dir (default is a local
  clone); it's local data, no network at app runtime.

  **To refresh the catalog** (pick up new parts from the community DB):

  ```bash
  git -C <path-to>/openrocket-database pull      # update the .orc source
  cd web && node scripts/sync-components.mjs      # regenerate components.generated.json
  #   …or:  node scripts/sync-components.mjs --src <path-to>/openrocket-database/orc
  ```
- **`web/src/services/componentDb.ts`** loads it (a discriminated union by `type`) and filters.
- **UI:** contextual **Select a part…”** pickers in the editor — nose cone and body tube
  prefill their geometry + material; a new **Recovery** group's parachute picker prefills diameter
  + Cd. Applying a part is pure app-side (it fills the `RocketSpec`); the engine is unchanged.

It's bundled reference data (no runtime fetch, no store). All six types are in the catalog, but
only the on-axis parts (body tube, nose cone, parachute) have pickers today; the inner/structural
parts (tube coupler, centering ring, bulkhead) — plus transitions and staging — are placed *inside*
a body tube, which needs the component-tree editor, so their pickers land with that work. (The
catalog adds ~880 KB to the bundle; a candidate for lazy-loading later.)

## Opening `.ork` files

**Open .ork** (header button) loads an existing OpenRocket design at **full fidelity** — any design
the engine's component-tree API supports (stages, transitions, couplers, rings, bulkheads…), not
just the fixed editor layout:

```
.ork (zip)  →  orkFile.importOrk()  →  RocketTree  →  OpenRocketDesign.buildTree()  →  staticInfo() / simulate()
```

- **`web/src/services/orkFile.ts`** unzips with  `fflate` and parses the OpenRocket XML with `DOMParser`.
-  No Java loader, no network — OpenRocket's own `.ork` loader lives in *core* (`core/.../file/openrocket`), 
-  but parsing in JS is far lighter than dragging it through TeaVM.
- **`web/src/services/loadOrk.ts`** orchestrates: `importOrk` → `buildTree` → resolve each mount's
  motor against our catalog (`findCatalogMotor` → `fetchMotorSpec`) → `staticInfo`. Unresolved
  motors / unsupported components surface as notes on the loaded-design banner.

**Save .ork** (header button) exports the current design — the editor's `RocketSpec` is converted to
a tree (`specToTree` in `engine/api.ts`), a loaded design re-exports its own tree — via
`orkFile.exportOrk` → zipped with `fflate` → downloaded (`web/src/services/saveOrk.ts`). Export →
re-import is verified **bit-identical** (same mass/CG/CP/stability), and the files re-open in desktop
OpenRocket.

A loaded design is **view + simulate + re-save** — its stability and flight run on the real tree, but
*editing* an arbitrary tree needs the component-tree editor (the `RocketSpec` editor only covers the
fixed layout).

## Where user data lives (swappable stores)

Client-side user data lives behind **two independently swappable, typed domain stores** — one for
motors, one for materials — so either can be replaced with a different implementation without
touching the services or the UI:

```
keyValueStore.ts    KeyValueStore (get/set/remove) + LocalStorageKeyValueStore  — the building block

motorStore.ts       MotorStore   — getMotorStore() / setMotorStore(store)
   readCatalog / writeCatalog (signature-guarded mirror) · readEntry / writeEntry (per-motor,
   TTL/freshness). Default KeyValueMotorStore persists via a KeyValueStore; used by motorDb.ts +
   thrustcurve.ts, which keep only key naming and the fetch/refresh logic.

materialStore.ts    MaterialStore — getMaterialStore() / setMaterialStore(store)
   list / add / remove Material. Default KeyValueMaterialStore persists via a KeyValueStore;
   materials.ts owns the domain rules (validation, merging built-ins with custom).
```

Both are **typed domain stores** that own their own persistence policy (the MotorStore owns the
catalog signature check and the per-entry TTL; the MaterialStore owns custom-material CRUD). Both
default to persisting through a `LocalStorageKeyValueStore`, and their interfaces are async so a
different implementation (IndexedDB, a backend, a shared store) fits without reshaping callers. To
replace one on the client, implement its interface and swap it:

- **Motors:** `setMotorStore(new MyMotorStore())`
- **Materials:** `setMaterialStore(new MyMaterialStore())`

…or keep the default domain logic over a different key-value backend:

- `setMotorStore(new KeyValueMotorStore(new MyKeyValueStore()))`
- `setMaterialStore(new KeyValueMaterialStore('materials:custom', new MyKeyValueStore()))`

Swapping one does not affect the other.

## Validation & fidelity tests

Two harnesses guard the engine (both need Node 22+; run from the repo root):

```bash
# 1. Parity test — proves the browser (TeaVM-JS) engine returns numbers identical to the
#    reference JVM. Self-contained: builds a parity engine variant (-Pparity), runs the same
#    scenarios on both, diffs them line-by-line.
node engine-java/test/parity/parity.mjs

# 2. Aero validation — scores the engine against wind-tunnel anchors (ARCAS / Basic Finner / HB-2).
node engine-java/validation/score.mjs               # classic Extended Barrowman (supersonic flag OFF)
node engine-java/validation/score.mjs --supersonic  # with the supersonic-aero model ON
node engine-java/validation/score.mjs --strict      # exit 1 on any gate-point failure
```

The **parity test** proves the browser engine matches the reference JVM (only sub-1e-9 ULP noise
from JS `Math` differs). `score.mjs` quantifies the opt-in supersonic-aero model: classic
Barrowman scores ~5% of gate points above Mach 1 (CP frozen), the supersonic model ~47% — the
reason the feature exists. The parity harness compiles **only** under `-Pparity`, so the shipped
engine carries no test code.

## Re-extraction / upgrading OpenRocket

The extracted sources are a committed snapshot, so you only touch this when adopting a newer
OpenRocket. `engine-java/extract/extract.mjs` regenerates `src/java/` from an OpenRocket source
tree (a repo checkout, a plain source tree, or an extracted `-sources.jar` — the layout is
auto-detected) and overlays the patches in `patches/`.

```bash
cd engine-java
node extract/extract.mjs --check --src /path/to/openrocket   # verify only: reports drift & missing files
node extract/extract.mjs --src /path/to/openrocket           # regenerate src/java/
# (or set OPENROCKET_SRC instead of --src)
```

`--check` writes nothing; it reports any manifest file missing upstream (version mismatch) and
any extracted file that differs from `upstream (+patch)`. On a version bump, re-diff each file in
`patches/` against the new upstream per `patches/LEDGER.md`, then re-extract and rebuild.

## Status

Engine: working (validated bit-identical JVM↔JS upstream). UI: MVP — live component editor
(nose/body/fins), stability, 2D profile, C6 flight sim + altitude chart. Roadmap (motor
picker, `.ork` import/export, full component tree, richer charts) in
`.claude/plans/sparkling-cuddling-hoare.md`.

## Attribution & license

The engine derives from OpenRocket 24.12, and the opt-in supersonic-aero extensions are the original
work of the mmrocket-sim project. Full credits and license lineage: **`engine-java/ATTRIBUTION.md`**
(and `docs/rasaero/` for the extensions' physics + diffs).
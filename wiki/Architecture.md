# Architecture & internals

> Developer/architecture reference — the deep dive behind the [Developer Guide](Developer-Guide). The repo's [README](https://github.com/thzero/AstraRocketJs/blob/HEAD/README.md) is the short overview; [Contributing](Contributing) covers how to work on the project.

AstraRocketJs runs the **OpenRocket physics kernel** in the browser, compiled to **WebAssembly** (with a **JavaScript fallback**). It's a monorepo:

- `engine-java/` — the OpenRocket physics core (a post-24.12 development build), extracted + minimally patched for TeaVM, compiled to **two** targets: a WebAssembly (WASM-GC) module and a JavaScript module (GPL-3.0; see `engine-java/ATTRIBUTION.md`).
- `web/` — the responsive UI: Vite + React + TypeScript + Tailwind CSS. Consumes the engine through a typed wrapper (`web/src/engine/openRocketEngine.ts`), which picks the backend at load and shows which one is active in the header.

## The extracted engine (`engine-java/src/java/`)

OpenRocket's full `core` module is ~700 Java files and pulls in Guice, JAXB, GraalVM-JS and classgraph — none of which TeaVM (the Java→JavaScript/WASM compiler) can handle. **Extraction** is a one-time copy of just the ~270 files the physics and simulation actually need, leaving behind all the reflection-heavy machinery (file loaders, plugin system, scripting, GUI hooks).

`src/java/` is therefore verbatim OpenRocket core source (a post-24.12 development build) with a handful of tiny TeaVM-compatibility edits already applied (the `patches/` overrides — e.g. `UUID`→`LongUUID`, one concurrent map swapped for a plain one, a reflection-free aerodynamic calculator lookup, and a copy-constructor `ArrayList.clone()` that WASM-GC's strict casts require). **This is the engine** — when the UI calls `staticInfo()` or `simulate()`, this is the code that runs. Don't edit extracted files directly; changes go through a documented override in `patches/` (only when upgrading the upstream OpenRocket version).

Extracted sources by area:

| files | package | what it is |
|------:|---------|------------|
| 73 | `rocketcomponent` | rocket model: nose cone, body tube, fins, stages, motor mounts, flight configs |
| 60 | `util` | math/geometry helpers (Coordinate, quaternions, interpolation) |
| 41 | `simulation` | flight simulator: RK4/RK6 integrators, steppers, tumble detection, flight events/data |
| 18 | `aerodynamics` | Extended Barrowman + RASAero CP / drag / stability (force breakdown) |
| 16 | `unit` | unit system (SI internally) |
| 12 | `models` | atmosphere (ISA), gravity models, wind |
| 10 | `motor` | thrust-curve motor model |
| 4 | `masscalc` | CG / mass / moment-of-inertia |
| … | rest | logging, i18n, materials, presets, appearance |

(~270 kernel files under `src/java/`, plus `src/shims/`, `src/jdkstubs/` and the `src/api/` facade — 286 Java files total.)

## Build → run pipeline

1. `engine-java/` (extracted core + `src/shims/` JVM-only replacements + `src/jdkstubs/` a JDK `Collator` stand-in + `src/api/OpenRocketEngine` @JSExport facade) is compiled by TeaVM to **two targets**: a **WASM-GC** module and a **JavaScript** module. Both come from the same sources via `node engine-java/build-engine.mjs` (JS) / `--wasm` (WASM-GC).
2. The built artifacts are committed so the web app builds without a JDK:
   - JS → `web/src/engine/vendor/openrocket-engine.mjs`
   - WASM → `web/public/engine/openrocket-engine.wasm` (+ its `*.wasm-runtime.js`)
3. `web/` imports them through the typed `openRocketEngine.ts` wrapper; React never touches the raw modules.

**Backend selection.** `initEngine()` loads **WASM-GC by default** (faster) and falls back to the **JS** build when the browser lacks WASM support or a load fails. Both are loaded **dynamically** (a separate chunk / fetch), so only one is ever downloaded, never both. Override with `?engine=js` / `?engine=wasm` (or `localStorage.setItem('engine', …)`); the header badge shows which is live. The two backends are verified **bit-identical**.

TeaVM requires `optimization = NONE` + `fastGlobalAnalysis = true` (see `engine-java/build.gradle`) — its default optimizer miscompiles the kernel (zeroes masses / collapses fin instances). WASM-GC additionally needs the copy-constructor `ArrayList.clone()` patch (its strict casts reject the JVM's `(ArrayList) super.clone()`).

**Threading.** The **interactive** engine calls — live CG/CP/stability on every edit (`staticInfo`), the drag sweep (`getDragSweep`), component info — run **synchronously on the main thread** (they're fast, ~ms, and want to be instant). The **flight simulation** (`simulate`, ~500 ms) runs in a **Web Worker** with its own engine instance, so a run never freezes the UI (`engine/simClient.ts` + `engine/simWorker.ts`; the worker builds the identical rocket via the shared `services/buildRocket.ts`). This is Phase 1 of an incremental plan to move more engine work off-thread — two options and the full roadmap are in [engine-worker-proposal.md](https://github.com/thzero/AstraRocketJs/blob/HEAD/docs/engine-worker-proposal.md).

## Motor data & thrust-curve caching

Motors come from [thrustcurve.org](https://www.thrustcurve.org), in two tiers that keep recurring API load to essentially one scheduled job:

1. **Catalog (build-time).** `web/scripts/sync-motors.mjs` sweeps thrustcurve for every available, license-clean motor and writes the specs to `web/src/data/motors.generated.json` (~811 motors). This is a **build artifact** — refresh it by re-running the sweep on a schedule (e.g. a monthly CI job), committing, and redeploying:

   ```bash
   cd web && node scripts/sync-motors.mjs   # regenerate the bundled catalog
   ```

   The app loads the bundle and mirrors it to `localStorage` (`tc:catalog`), stamped with a content signature so a freshly re-synced bundle supersedes the mirror automatically — the catalog is never fetched from thrustcurve at runtime.

2. **Thrust curves (runtime, on demand).** The catalog carries specs but no curve. When a motor is picked, `web/src/services/thrustcurve.ts` resolves it (`search.json`) and pulls its curve (`download.json`), then builds the engine `MotorSpec` (trapezoidal impulse → per-sample mass). Everything is cached in `localStorage`:

   | key | holds | refetched |
   |-----|-------|-----------|
   | `tc:catalog` | the bundled catalog | never (build-time; signature-invalidated) |
   | `tc:v1:meta:<mfr>:<desig>` | resolved metadata (motorId, dims, weights) | after the TTL |
   | `tc:v1:samples:<motorId>` | the thrust curve | after the TTL |
   | `tc:v1:motor:<mfr>:<desig>:<delay>` | the built `MotorSpec` | after the TTL |

   Curves are **not immutable** (contributors revise the sample files), so the per-motor caches carry a **90-day TTL** (`CACHE_TTL_MS` in `thrustcurve.ts`) and revalidate **lazily, stale-while-revalidate**: a re-fetch happens only for a motor the user picks *again* *after* its cache has aged out, and a failed refresh falls back to the stale curve (offline-safe). Bump `CACHE_VERSION` to invalidate every per-motor cache at once.

   **Imported motors.** A user can import a `.eng` (RASP) file — it carries its own thrust curve, so it needs no thrustcurve lookup: `engParser.ts` parses it, the `MotorStore` persists it (`motors:custom`), `loadCatalog()` merges it into the picker (flagged, deletable), and `fetchMotorSpec` builds its `MotorSpec` from the stored samples. This is user content, symmetric to custom materials.

   The catalog mirror, per-motor entries, and imported motors all persist through the swappable **`MotorStore`** (`web/src/services/motorStore.ts`; default `KeyValueMotorStore` over `localStorage`), which owns the freshness policy (catalog signature, per-entry TTL). Replace it with `setMotorStore(...)` to move motor data elsewhere — see **Where user data lives** below.

## Materials

Unlike motors, materials are **not** an external feed — OpenRocket's built-in materials are a static list. They live in two places:

- **Built-ins** — `web/src/data/materials.ts` ports the full upstream list (~61 materials: bulk / surface / line, with densities and groups) from OpenRocket's `Databases.java`. The editor's material picker reads them; the engine reproduces OpenRocket's mass/CG because it applies a material by its **density**.
- **Custom materials** — user-defined (name + density), persisted under `materials:custom`, merged into the picker, and reusable across designs. The kernel accepts any density directly, so a custom material is just a named density. `materials.ts` owns the domain rules; `materialStore.ts` is a typed store that sits on top of the shared key-value store (below).

The material selection is applied to the kernel as a density override (`materialDensity`), so the **physics is exact** — mass/CG match OpenRocket regardless. The one piece still to come is round-tripping material *names* through `.ork`: on save/reload a custom or non-default material can lose its human-readable **label** (the density, and thus the physics, is preserved). Closing that gap needs the full built-in material list ported into the engine shim (`engine-java/src/shims/.../database/Databases.java`, currently only the built-in *defaults*) plus an engine rebuild, and is folded into the `.ork` task. (Real manufacturer **component** catalogs are a separate feature and *are* implemented — see **Components** below.)

## Components

Real manufacturer parts (Estes/Apogee/LOC/BlueTube/…), extracted from the **OpenRocket-Components DB** ([`dbcook/openrocket-database`](https://github.com/dbcook/openrocket-database)) — the community-maintained `.orc` parts database OpenRocket's component data comes from — the third and last reference catalog (after motors and materials). (OpenRocket calls these "component presets"; here it's just the components catalog, symmetric with motors.)

- **`web/scripts/sync-components.mjs`** reads the `.orc` XML, resolves each part's material to a density, normalizes units to SI, and writes **`web/src/data/components.generated.json`** (~2,940 parts, six types: body tubes, nose cones, parachutes, tube couplers, centering rings, bulkheads). Point `--src` at a checkout of the components DB's `orc/` dir (default is a local clone); it's local data, no network at app runtime.

  **To refresh the catalog** (pick up new parts from the community DB):

  ```bash
  git -C <path-to>/openrocket-database pull      # update the .orc source
  cd web && node scripts/sync-components.mjs      # regenerate components.generated.json
  #   …or:  node scripts/sync-components.mjs --src <path-to>/openrocket-database/orc
  ```
- **`web/src/services/componentDb.ts`** loads it (a discriminated union by `type`) and filters.
- **UI:** contextual **"Select a part…"** pickers in the editor — nose cone and body tube prefill their geometry + material; a **Recovery** group's parachute picker prefills diameter + Cd. Applying a part is pure app-side (it fills the `RocketSpec`); the engine is unchanged.

It's bundled reference data (no runtime fetch, no store). (The catalog adds ~880 KB to the bundle; a candidate for lazy-loading later.)

## Opening `.ork` files

**Open .ork** loads an existing OpenRocket design at **full fidelity** — any design the engine's component-tree API supports (stages, transitions, couplers, rings, bulkheads…), not just the fixed editor layout:

```
.ork (zip)  →  orkFile.importOrk()  →  RocketTree  →  OpenRocketDesign.buildTree()  →  staticInfo() / simulate()
```

- **`web/src/services/orkFile.ts`** unzips with `fflate` and parses the OpenRocket XML with `DOMParser`. No Java loader, no network — OpenRocket's own `.ork` loader lives in *core* (`core/.../file/openrocket`), but parsing in JS is far lighter than dragging it through TeaVM.
- **`web/src/services/loadOrk.ts`** orchestrates: `importOrk` → `buildTree` → resolve each mount's motor against our catalog (`findCatalogMotor` → `fetchMotorSpec`) → `staticInfo`. Unresolved motors / unsupported components surface as notes on the loaded-design banner.

**Save .ork** exports the current design (`orkFile.exportOrk` → zipped with `fflate` → downloaded via `web/src/services/saveOrk.ts`). Export → re-import is verified **bit-identical** (same mass/CG/CP/stability), and the files re-open in desktop OpenRocket.

## Where user data lives (swappable stores)

Client-side user data lives behind **two independently swappable, typed domain stores** — one for motors, one for materials — so either can be replaced with a different implementation without touching the services or the UI:

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

Both default to persisting through a `LocalStorageKeyValueStore`, and their interfaces are async so a different implementation (IndexedDB, a backend, a shared store) fits without reshaping callers. To replace one on the client, implement its interface and swap it:

- **Motors:** `setMotorStore(new MyMotorStore())`
- **Materials:** `setMaterialStore(new MyMaterialStore())`

…or keep the default domain logic over a different key-value backend:

- `setMotorStore(new KeyValueMotorStore(new MyKeyValueStore()))`
- `setMaterialStore(new KeyValueMaterialStore('materials:custom', new MyKeyValueStore()))`

Swapping one does not affect the other.

## Attribution & license

The engine derives from the OpenRocket core (a post-24.12 development build), and the opt-in supersonic-aero (RASAero) extensions are the original work of the mmrocket-sim project. Full credits and license lineage: [`engine-java/ATTRIBUTION.md`](https://github.com/thzero/AstraRocketJs/blob/HEAD/engine-java/ATTRIBUTION.md) (and `docs/rasaero/` for the extensions' physics + diffs).

---
title: "Architecture & internals"
sidebar_position: 16
---
> Developer/architecture reference — the deep dive behind the [Developer Guide](./developer-guide.md). The repo's [README](https://github.com/thzero/AstraRocketJs/blob/HEAD/README.md) is the short overview; [Contributing](./contributing.md) covers how to work on the project.

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

1. `engine-java/` (extracted core + `src/shims/` JVM-only replacements + `src/jdkstubs/` a JDK `Collator` stand-in + `src/api/OpenRocketEngine` @JSExport facade) is compiled by TeaVM to **two targets**: a **WASM-GC** module and a **JavaScript** module. Both come from the same sources, and `node engine-java/build-engine.mjs` builds and vendors both of them.
2. The built artifacts are committed so the web app builds without a JDK:
   - JS → `web/src/engine/vendor/openrocket-engine.mjs`
   - WASM → `web/public/engine/openrocket-engine.wasm` (+ its `*.wasm-runtime.js`)
3. `web/` imports them through the typed `openRocketEngine.ts` wrapper; React never touches the raw modules.

**Backend selection.** `initEngine()` loads **WASM-GC by default** (faster) and falls back to the **JS** build when the browser lacks WASM support or a load fails. Both are loaded **dynamically** (a separate chunk / fetch), so only one is ever downloaded, never both. Override with `?engine=js` / `?engine=wasm` (or `localStorage.setItem('engine', …)`); the header badge shows which is live. The two backends are verified **bit-identical**.

TeaVM requires `optimization = NONE` + `fastGlobalAnalysis = true` (see `engine-java/build.gradle`) — its default optimizer miscompiles the kernel (zeroes masses / collapses fin instances). WASM-GC additionally needs the copy-constructor `ArrayList.clone()` patch (its strict casts reject the JVM's `(ArrayList) super.clone()`).

**Threading.** The **interactive** engine calls — live CG/CP/stability on every edit (`staticInfo`), the aero sweep (`getAeroSweep`), component info — run **synchronously on the main thread** (they're fast, ~ms, and want to be instant). The **flight simulation** (`simulate`, ~500 ms) runs in a **Web Worker** with its own engine instance, so a run never freezes the UI (`engine/simClient.ts` + `engine/simWorker.ts`; the worker builds the identical rocket via the shared `services/buildRocket.ts`). Running several simulations is a **pool** of those workers, up to one per core less one and capped at four, so a batch flies several at a time rather than one after another; the rest queue, and idle workers are reaped. `simulate()` inside a worker is a synchronous engine call, so one request per worker is what lets a hung simulation be killed on its own without disturbing the others. This is Phase 1 of an incremental plan to move more engine work off-thread — two options and the full roadmap are in [engine-worker-proposal.md](https://github.com/thzero/AstraRocketJs/blob/HEAD/docs/engine-worker-proposal.md).

## Offline & installability (PWA)

Everything the app needs is static — the WASM kernel runs the physics in-browser and there is no backend — so it can work with no connection at all. `vite-plugin-pwa` (configured in `web/vite.config.ts`) emits a service worker that precaches the app shell, the WASM engine and both catalogs (~7.8 MB), plus a web app manifest that makes it installable. Page loads themselves go network-first with the precached shell as the offline fallback, so a plain reload picks up a new deploy as soon as the CDN serves it, without waiting for the update prompt; the GitHub Pages CDN caches every file for ten minutes, so that is the floor on how fast a deploy can reach anyone.

Two deliberate exclusions and additions:

- The **JS fallback engine** (~970 kB, emitted twice — main thread and sim worker) is kept *out* of the precache and runtime-cached on first use instead. WASM-GC is the path essentially every current browser takes, so precaching ~1.9 MB of unused fallback on every install is a bad trade.
- The **`data`-branch catalogs** get a `StaleWhileRevalidate` rule, so they render instantly from cache and refresh in the background — which is how a weekly catalog refresh reaches an installed copy.

The worker is registered with `registerType: 'prompt'`, not `autoUpdate`: a silent activation reloads the page, which would interrupt an edit in progress. `components/layout/UpdateToast.tsx` asks instead, and dismissing keeps the running version until the next natural reload.

Icons are generated from `web/public/favicon.svg` by `npm run gen:icons` (rerun after changing the favicon). The maskable variant is inset to the ~80% safe zone because launchers crop to a circle or squircle and would otherwise clip the fins.

## Motor data & thrust-curve caching

Motors come from [thrustcurve.org](https://www.thrustcurve.org), in two tiers that keep recurring API load to essentially one scheduled job:

1. **Catalog (generated, fetched at runtime).** `web/scripts/sync-motors.mjs` sweeps thrustcurve for every available, license-clean motor and writes the specs — and their bundled thrust curves — to `web/public/data/motors.generated.json` (~815 motors). `public/data` is copied verbatim into the build rather than compiled into the JS bundle, and `services/remoteData.ts` fetches it on first use. `.github/workflows/sync-catalogs.yml` runs the sweep weekly and publishes the result to the orphan `data` branch, which the deployed app reads over jsDelivr (`VITE_DATA_BASE`), so a refresh needs no rebuild; the committed copy is the fallback when that host is unreachable. To regenerate locally:

   ```bash
   cd web && npm run sync:motors            # regenerate the committed fallback catalog
   ```

   The catalog is **not** mirrored to `localStorage` — it now ships its thrust curves, which is far too large for that — but it is memoized for the session and cache-busted by the content hash in `public/data/manifest.json`. thrustcurve.org itself is never called for the catalog at runtime.

2. **Thrust curves.** The sweep bundles each motor's curve samples into the catalog (781 of 815; the rest are flagged `noCurve`, having none published), so a picked motor builds its `MotorSpec` with **no runtime call**. Only a `noCurve` motor falls through to `web/src/services/thrustcurve.ts`, which resolves it (`search.json`), pulls its curve (`download.json`) and builds the spec (trapezoidal impulse → per-sample mass). Those fetches are cached through the `MotorStore` (IndexedDB):

   | key | holds | refetched |
   |-----|-------|-----------|
   | `tc:v1:meta:<mfr>:<desig>` | resolved metadata (motorId, dims, weights) | after the TTL |
   | `tc:v1:samples:<motorId>` | the thrust curve | after the TTL |
   | `tc:v1:motor:<mfr>:<desig>:<delay>` | the built `MotorSpec` | after the TTL |

   Curves are **not immutable** (contributors revise the sample files), so the per-motor caches carry a **90-day TTL** (`CACHE_TTL_MS` in `thrustcurve.ts`) and revalidate **lazily, stale-while-revalidate**: a re-fetch happens only for a motor the user picks *again* *after* its cache has aged out, and a failed refresh falls back to the stale curve (offline-safe). Bump `CACHE_VERSION` to invalidate every per-motor cache at once.

   **Imported motors.** A user can import a `.eng` (RASP) file — it carries its own thrust curve, so it needs no thrustcurve lookup: `engParser.ts` parses it, the `MotorStore` persists it (`motors:custom`), `loadCatalog()` merges it into the picker (flagged, deletable), and `fetchMotorSpec` builds its `MotorSpec` from the stored samples. This is user content, symmetric to custom materials.

   The catalog mirror, per-motor entries, and imported motors all persist through the swappable **`MotorStore`** (`web/src/services/motorStore.ts`; default `KeyValueMotorStore` over IndexedDB), which owns the freshness policy (catalog signature, per-entry TTL). Replace it with `setMotorStore(...)` to move motor data elsewhere — see **Where user data lives** below.

## Materials

Unlike motors, materials are **not** an external feed — OpenRocket's built-in materials are a static list. They live in two places:

- **Built-ins** — `web/src/data/materials.ts` ports the full upstream list (~61 materials: bulk / surface / line, with densities and groups) from OpenRocket's `Databases.java`. The editor's material picker reads them; the engine reproduces OpenRocket's mass/CG because it applies a material by its **density**.
- **Custom materials** — user-defined (name + density), persisted under `materials:custom`, merged into the picker, and reusable across designs. The kernel accepts any density directly, so a custom material is just a named density. `materials.ts` owns the domain rules; `materialStore.ts` is a typed store that sits on top of the shared key-value store (below).

The material selection is applied to the kernel as a density override (`materialDensity`), so the **physics is exact** — mass/CG match OpenRocket regardless. The one piece still to come is round-tripping material *names* through `.ork`: on save/reload a custom or non-default material can lose its human-readable **label** (the density, and thus the physics, is preserved). Closing that gap needs the full built-in material list ported into the engine shim (`engine-java/src/shims/.../database/Databases.java`, currently only the built-in *defaults*) plus an engine rebuild, and is folded into the `.ork` task. (Real manufacturer **component** catalogs are a separate feature and *are* implemented — see **Components** below.)

## Components

Real manufacturer parts (Estes/Apogee/LOC/BlueTube/…), extracted from the **OpenRocket-Components DB** ([`dbcook/openrocket-database`](https://github.com/dbcook/openrocket-database)) — the community-maintained `.orc` parts database OpenRocket's component data comes from — the third and last reference catalog (after motors and materials). (OpenRocket calls these "component presets"; here it's just the components catalog, symmetric with motors.)

- **`web/scripts/sync-components.mjs`** reads the `.orc` XML, resolves each part's material to a density, normalizes units to SI, and writes **`web/public/data/components.generated.json`** (~2,940 parts, six types: body tubes, nose cones, parachutes, tube couplers, centering rings, bulkheads). Point `OPENROCKET_PRESETS` (or `--src`) at a checkout of the components DB's `orc/` dir; the default is a local clone. Generating it needs no network, and neither does the CI job beyond cloning that database.

  **To refresh the catalog** (pick up new parts from the community DB):

  ```bash
  git -C <path-to>/openrocket-database pull      # update the .orc source
  cd web && node scripts/sync-components.mjs      # regenerate components.generated.json
  #   …or:  node scripts/sync-components.mjs --src <path-to>/openrocket-database/orc
  ```
- **`web/src/services/componentDb.ts`** loads it (a discriminated union by `type`) and filters.
- **UI:** contextual **"Select a part…"** pickers in the editor — nose cone and body tube prefill their geometry + material; a **Recovery** group's parachute picker prefills diameter + Cd. Applying a part is pure app-side (it fills the `RocketSpec`); the engine is unchanged.

Like the motor catalog, it is a generated file under `public/data/` fetched on first use (see above) rather than compiled into the bundle, so it costs nothing until a picker is opened — and it is published to the `data` branch on the same weekly schedule.

## RockSim (`.rkt`) I/O

Read by `services/rktImport.ts` and written by `services/rktExport.ts` — a TypeScript PORT of OpenRocket's `file/rocksim/` package, not an extraction of it. That package is SAX-based and pulls in the desktop's document, appearance and warning machinery; the schema it encodes is small enough to read directly, and reading it here keeps both directions on the same side of the engine boundary as the `.ork` pair: plain DOM, unit-testable, no kernel round trip. The element vocabulary, the unit factors and the four enums are transcribed from `RockSimCommonConstants.java` and its siblings, so an upstream bump can be diffed against those files.

Three conversions run through everything, and getting one wrong yields a design that is silently 2x or 1000x off rather than one that fails to load: RockSim is **millimeters** and **grams**, and every circular dimension in the file is a **diameter**. The exceptions are documented at their call sites — a parachute's `Dia` really is a diameter on both sides, and `ShroudLineMassPerMM` is kg/m despite its name.

`services/designFile.ts` picks the reader from the file's BYTES (a zip is a `.ork`; otherwise the root element decides), so `loadOrk` has one path for both formats and everything downstream — the notes banner, the safety-limit check, the unsaved-copy semantics — is shared rather than duplicated per format. The header carries one hidden file input per format, differing only in `accept`.

Neither side is lossless in general, and both say so: RockSim has ring tails, detachable pods and subassemblies we do not, and we have rail buttons and parallel stages it does not. The importer collects those into the loaded-design notes; the exporter returns the skipped types to the caller, which surfaces them rather than letting a user discover the gap when somebody else opens the file.

## Example rockets

The seventeen designs OpenRocket ships and opens from *File → Open Example*, bundled with the app under `web/public/examples/` and listed by a generated `examples.generated.json`.

`web/scripts/sync-examples.mjs` (`npm run sync:examples`) pulls them from the **same commit `engine-java/extract/UPSTREAM` pins for the engine**, so an example can never demonstrate a feature the bundled kernel does not have. It also **strips each file's stored `<flightdata>`**: 96% of the bytes — 3.5 MB of the 3.6 MB across the set — and dead weight here, because `orkImport` never reads it (the app runs its own simulations). Stripped, the set is ~340 kB. Designs, appearances, decals and embedded thrust curves are untouched.

Deliberately **`public/examples/`, not `public/data/`**. The catalogs under `public/data` are refreshed weekly by `sync-catalogs.yml` and served from the `data` branch, because they change without the app; examples change only when the app is rebuilt against a newer OpenRocket. They are precached instead (`ork` is in the PWA's `globPatterns`), so an example opens on a first offline load.

`services/exampleLibrary.ts` fetches the index and one file's bytes; `store.openExample` hands those bytes to **`openOrkFile`**, so an example takes the identical path a picked file does — the same notes banner, the same safety-limit check, the same unsaved-copy semantics, the same question when its name is already in the library, and no second code path. Reached from **Import → Examples**, and from the second tab of the design library.

`src/services/exampleLibrary.test.ts` imports and builds **every** example through the real kernel and resolves its motors against the committed catalog, so neither the strip nor an upstream bump can quietly ship a broken one.

## Geometry export (3D print / CAD / cut files)

Every printable output starts at `services/solidMesh.ts`, which builds a **watertight solid** per component and is the choke point that refuses one it cannot make manifold (`solidForNode` returns null rather than writing a file no slicer accepts). From there:

- `services/meshExport.ts` wraps three.js's STL / OBJ / glTF exporters, scaling meters → **millimeters** (`M_TO_MM`) because that is the unit every slicer and CAD tool assumes.
- `services/threeMf.ts` writes **3MF** directly — it is a zip of three XML members (OPC content types, a relationship, and the model), not a three.js exporter, so it reads the geometry's vertex and index buffers itself. 3MF is the only one of the four that carries the part's **name**, a **color** and the **declared unit**, which is what makes a whole-rocket export useful rather than a pile of anonymous solids.
- `services/dxfExport.ts` writes the flat outline of a plate-cut part.
- `services/componentFormats.ts` says which formats a component type offers (the tree's ⬇ button asks it, and it is deliberately free of heavy imports); `services/componentExport.ts` is the on-demand chunk that actually builds and downloads one part.
- `services/rocketPrintExport.ts` is the whole-rocket path: it walks the design for printable parts, builds each solid by the same two routes `componentExport` uses (a disc/ring needs its parent tube's bore resolved), and writes either one 3MF of named objects or a zip of one file per part.

**Orientation is never changed.** Solids are lathed about Y and rotated into X (`solidMesh.ts`), so the rocket's axis runs along X and bodies export lying down. The print export's "place on the build plate" is a pure TRANSLATION for that reason: standing parts up would be right for tubes and wrong for every fin and ring, and it would make the 3MF differ from the STL of the same part.

## Opening `.ork` files

**Open .ork** loads an existing OpenRocket design at **full fidelity** — any design the engine's component-tree API supports (stages, transitions, couplers, rings, bulkheads…), not just the fixed editor layout:

```
.ork (zip)  →  orkFile.importOrk()  →  RocketTree  →  OpenRocketDesign.buildTree()  →  staticInfo() / simulate()
```

- **`web/src/services/orkFile.ts`** unzips with `fflate` and parses the OpenRocket XML with `DOMParser`. No Java loader, no network — OpenRocket's own `.ork` loader lives in *core* (`core/.../file/openrocket`), but parsing in JS is far lighter than dragging it through TeaVM.
- **`web/src/services/loadOrk.ts`** orchestrates: `importOrk` → `buildTree` → resolve each mount's motor against our catalog (`findCatalogMotor` → `fetchMotorSpec`) → `staticInfo`. Unresolved motors / unsupported components surface as notes on the loaded-design banner.

**Save .ork** exports the current design (`orkFile.exportOrk` → zipped with `fflate` → downloaded via `web/src/services/saveOrk.ts`). Export → re-import is verified **bit-identical** (same mass/CG/CP/stability), and the files re-open in desktop OpenRocket.

## Saved launch locations

`services/launchLocationStore.ts` is the fourth store in the family (motors, materials, export templates, locations): a typed `LaunchLocationStore` over a `KeyValueStore` under `pads:custom` — the stored key keeps the feature's old name on purpose, because it is what somebody's browser already has their fields saved under and renaming it would strand that entry with nothing reading it — swappable via `setLaunchLocationStore`. A `LaunchLocation` is a name plus the three site fields — `latitudeDeg`, `longitudeDeg`, `launchAltitudeM` — stored in SI like everything else, and validated on save against the same ranges `LaunchPanel` clamps its fields to, so a hand-edited blob cannot put a latitude past ±90 into the kernel's gravity and Coriolis terms or into a KML origin.

It deliberately holds NOTHING else. The rod, the wind and the atmosphere are conditions on the day rather than properties of a field.

`components/sim/LocationEditDialog.tsx` edits a location in full — name, latitude, longitude and elevation — and creates one from nothing, which is the only way to add a location from the menu. Its `min`/`max` are the store's own ranges, so `NumberInput`'s clamp makes a value `launchLocationStore.isLocation` would reject unreachable rather than refused after the fact, and its elevation field binds to the launch panel's own unit scope so both read in the same unit.

`components/sim/LocationsDialog.tsx` is the list, and is self-contained — it loads from the store and applies a location through `patchLaunch` — so the same component serves both the launch panel's ⚙ and **menu → Launch locations**, where no site field is on screen to write into. `components/sim/LocationPicker.tsx` mounts at the top of the launch panel's Site group and writes through the panel's own `onChange` / `onCommit`, so applying a location is an ordinary undoable edit subject to the same multi-selection rules as typing the numbers. Which location is "current" is derived by COMPARING THE NUMBERS rather than remembering a selected id: the fields can be changed by an import, by geolocation or by hand, and a remembered id would keep claiming a location that is no longer what is on screen. Both read the list through `components/sim/useLocationList.ts`, which numbers its reads and drops a superseded answer: IndexedDB's initial open makes the FIRST `list()` of a session the slowest, so a location saved in the meantime would refresh, resolve first, and then be overwritten by the empty list that first read took before the save — leaving a dropdown with no locations over a database that has them, with nothing to retry because nothing knows it is wrong.

`components/sim/SiteMap.tsx` draws the launch site, with `services/slippyMap.ts` holding the Web Mercator projection, the two tile sources and the viewport math. There is no mapping library: showing one point, dragging it, panning and zooming is the entire requirement, and Leaflet or MapLibre would bring a layer system, a plugin surface and a stylesheet for the parts we do not use, so tiles are `<img>` tags at computed offsets. Keeping the projection pure is what lets it be tested against hand-computed Mercator figures rather than by eye. Both layers come from Esri (`World_Imagery` and `World_Street_Map`, whose paths are `{z}/{y}/{x}` rather than the usual `{z}/{x}/{y}`), and a Workbox `CacheFirst` rule in `vite.config.ts` keeps up to 600 of them: a tile is a picture of the ground, so a stale one is still right, and a location checked at home has to draw at a field with no signal. Three consecutive tile errors with none loaded swaps in a coordinate graticule rather than an empty gray box — deliberately not a drawn coastline, since inventing a rough one would put the pin in a shape that is nearly a country, which is worse than no shape when the job is telling you whether the numbers are where you meant. The street layer was `tile.openstreetmap.org` at first, which was wrong on two counts: those servers are donated, volunteer-funded infrastructure that the OSM Tile Usage Policy reserves for OpenStreetMap's own use, and they enforce it, so the layer 403'd in the browser as soon as it shipped. The app also asked for tiles with `referrerPolicy="no-referrer"`, which strips the one header a provider has to identify who is calling - the polite half of using someone else's tiles, and the signature they block on. Esri's street map carries OSM data and credits it in the attribution, so the surveyors are still credited over a CDN that is provisioned for being used. A unit test asserts no tile URL points at `openstreetmap.org` and an end-to-end test asserts nothing reaches it on the wire, because the easy way to "fix" a blocked tile layer is to point it back. `components/sim/SiteMapDialog.tsx` is the same map opened over the launch panel, whose own column is too narrow to show a field and its surroundings; `LocationEditDialog` has the room to keep one inline. Both write coordinates through the caller's change path, so a click on the map is one undoable edit. The pan and click-to-place handlers live on the box that also holds the layer, zoom and recenter buttons, so they ignore any pointer event that starts on a control: without that, clicking one bubbled through and read as a click on the ground, and switching layers silently moved the site to the map's top-left corner where those buttons sit. The drag capture is taken on the box rather than on `e.target`, which is usually a tile and unmounts as soon as a pan scrolls past it.

## Where user data lives (swappable stores)

Client-side user data lives behind **two independently swappable, typed domain stores** — one for motors, one for materials — so either can be replaced with a different implementation without touching the services or the UI:

```
keyValueStore.ts    KeyValueStore (get/set/remove) + LocalStorageKeyValueStore  — the interface
idbKeyValueStore.ts IndexedDbKeyValueStore — the DEFAULT backend for every store

designLibrary.ts    DesignLibrary — getDesignLibrary() / setDesignLibrary(lib)
   list / read / write / create / rename / remove, plus the active-design pointer. One
   key per design (astrarrocketjs:designs:<id>) and a small separate index of
   {id, name, updatedAt} — autosave rewrites ONE design on a 500 ms debounce, so a single
   document holding every design would be rewritten on every keystroke and grow with the
   library. workspaceStore.ts is a narrow façade over "the design being edited".

motorStore.ts       MotorStore   — getMotorStore() / setMotorStore(store)
   readCatalog / writeCatalog (signature-guarded mirror) · readEntry / writeEntry (per-motor,
   TTL/freshness). Default KeyValueMotorStore persists via a KeyValueStore; used by motorDb.ts +
   thrustcurve.ts, which keep only key naming and the fetch/refresh logic.

materialStore.ts    MaterialStore — getMaterialStore() / setMaterialStore(store)
   list / add / remove Material. Default KeyValueMaterialStore persists via a KeyValueStore;
   materials.ts owns the domain rules (validation, merging built-ins with custom).
```

All of them default to persisting through an **`IndexedDbKeyValueStore`**, and their interfaces are async so a different implementation (a backend, a shared store) fits without reshaping callers. To replace one on the client, implement its interface and swap it:

- **Motors:** `setMotorStore(new MyMotorStore())`
- **Materials:** `setMaterialStore(new MyMaterialStore())`

…or keep the default domain logic over a different key-value backend:

- `setMotorStore(new KeyValueMotorStore(new MyKeyValueStore()))`
- `setMaterialStore(new KeyValueMaterialStore('materials:custom', new MyKeyValueStore()))`

Swapping one does not affect the other.

### Why IndexedDB, and the two places localStorage remains

localStorage is synchronous — every read and write blocks the main thread — and capped near **5 MB per origin**, shared across designs, custom motors and materials, imported templates and the thrust-curve caches. `workspaceStore.save()` throwing `storage-full` is that cap showing through. IndexedDB is async and effectively uncapped.

Existing data migrates **lazily, per key, on first read**: a key absent from IndexedDB but present in localStorage is copied across, and the original is deleted only once the write is confirmed — an interrupted migration retries next load rather than destroying the only copy. If IndexedDB is unavailable (blocked by policy, some private modes), every operation transparently falls back to localStorage, so the app degrades to its previous behavior rather than losing storage.

The app held exactly ONE design before this — a single blob replaced whenever you opened another. `designLibrary.ts` makes designs addressable instead, and folds that pre-library workspace in as the first entry on first use (named after its imported `.ork` if it had one). Because switching designs is now possible, the unload journal records **which** design it belongs to: replaying it into whatever happens to be open would overwrite an unrelated rocket.

### One design in, one entry out

Two rules keep the library from filling up with copies of the same rocket, because both failures look identical from the File > Open list and neither is recoverable by the user.

**An import is detached, and named before it lands.** `openOrkFile` calls `setActiveId(null)`, so the next autosave CREATES an entry: an imported rocket is its own design, not an edit to whatever was on screen. What that missed is the name. Re-importing a `.ork` you have been editing in OpenRocket, or reopening an example, produced another entry called the same thing every time. `store.ts`'s `homeForImport` now resolves the clash **before** `replaceWorkspace` — overwrite the existing entry, or name this one (the next free `… (2)` is suggested). It has to happen before the swap, or the 500 ms debounce fires while the dialog is open and creates the entry being asked about. The answer reaches the autosave through `WorkspaceStore.setPendingName`, so there is still exactly one `create`, made by the autosave, rather than the caller racing it with a second one. The dialog is `state/promptStore.ts` + `components/common/PromptDialog.tsx`, the promise-based sibling of `confirmStore` — the store needs an answer mid-action and cannot render.

**Only one create can be in flight.** `LibraryWorkspaceStore.save` checked `!this.activeId` and then awaited `lib.create()` before assigning the id, so two saves that overlapped in that window each made an entry and all but the last were orphaned — nothing was ever active in them. It is not a narrow window: the debounce is 500 ms and the first IndexedDB create is the slowest write the app makes, and the `visibilitychange` flush saves outside the debounce entirely. Overlapping saves now share one create, and a create that resolves after the workspace has been replaced does not adopt its id. `DesignLibrary.create` also rolls back when its active-pointer write is refused, since a half-done create left its design indexed while the caller still had no active id — one identical row every 500 ms for as long as storage kept refusing.

There is no **File > Save**. Editing autosaves on the debounce, unload writes the journal, and the item only ever flushed a write that was already coming or sent a never-named design to Save As. `components/layout/SaveStatus.tsx` reports the last write instead, from `lastSavedAt`, which `useWorkspaceEffects` sets on the save's own success path — not where one was requested, so a refused write cannot claim a save.

Two things stay on localStorage deliberately:

- **Settings** (`settings.ts`) are read **synchronously** so the very first render already has the user's units and preferences — an async read would flash defaults.
- **The unload journal.** An IndexedDB write cannot complete while the page is tearing down, so `WorkspaceStore.saveSync()` writes the workspace to localStorage on `pagehide`/`beforeunload` and the next `load()` folds it back in (it is by definition the newest copy) and clears it. Without this, an edit made inside the 500 ms autosave debounce would be lost on a quick refresh. A `visibilitychange → hidden` handler also fires the ordinary async save, which on mobile is often the last chance before the tab is discarded.

Small UI preferences (dashboard columns, picker filters) also stay on localStorage — they are tiny, and a synchronous read keeps the first paint correct.

## Units

The engine, the component tree and every saved file are **pure SI / radians**. Units are a display-and-entry concern that lives only at the UI edge — a unit that leaks inward is how upstream OpenRocket got bugs like #2475, and `.ork` round-trips have to stay byte-stable.

- **`web/src/prefs/units.ts`** — the unit groups (mirroring the desktop's `UnitGroup`), their SI factors, and the pure conversion functions. The convention matches the desktop: `si = (ui + offset) * toSI`, with `offset` used only by temperature. `siToUiDelta` converts a *difference* rather than a reading, so a 1 K spinner step is 1 °C and not −272.15.
- **`web/src/prefs/useUnits.ts`** — the React hook everything that puts a number on screen goes through: `sym / toUi / fromUi / fmt / step / factor` for the preference-level units, plus `at(scope, quantity)` for one field's own. `at` is a plain function rather than its own hook because fields are rendered in loops. `fmt` is locale-aware (it routes through `i18n/format`); `units.ts`'s own `fmtSi` stays plain ASCII for export code, which runs outside React and must not depend on the active language.
- **`web/src/components/common/UnitChip.tsx`** — the unit printed beside a value, as a picker for that field.

Two layers, both persisted in `settings.ts`, resolved by `unitFor(units, unitOverrides, quantity, scope)`:

| field | keyed by | written by | reach |
| --- | --- | --- | --- |
| `units` | quantity | the Units tab only | everything without an override of its own |
| `unitOverrides` | field (`unitScope(…)`) | `UnitChip` only | that one field |

**A chip changes its own field and stops there** — the owner's call (2026-09-13): re-basing every length in the app is too big an effect to hang off a small control next to one number. Component fields are scoped by component TYPE, not per instance, so selecting another body tube does not forget the unit just set on that card.

Stored symbols are validated at READ time, in `unitFor`, against the quantity the field turns out to be. A scope key does not name its quantity, so an `in` left behind on a field that is now a mass would otherwise reach `unitDef` and quietly become grams.

Three rules keep the two layers from getting stuck: picking the preference back from a chip **removes** the override rather than storing a matching one (so the field resumes following the preference); the Metric / Imperial presets **clear every override**, or they would leave stranded fields on top of the preset; and the Units tab surfaces a **Reset N fields** button whenever any exist, since a per-field choice is otherwise hard to find again.

Orphaned keys are **not** pruned. A scope only exists while its field renders, so nothing can enumerate the live set at load time, and a renamed field key simply leaves an entry nothing reads (`unitFor` falls back for it). That is a deliberate non-feature: the map tops out in the low tens of entries at a few dozen bytes each, so a reaper would cost more code than the bytes it reclaims. `PropertyPanel.scopes.test.ts` guards the failure that would actually matter — two fields of one component type colliding on a key, which would silently make them share a unit.

Exports deliberately do NOT see the per-field layer — a document half in inches and half in centimeters because of where someone clicked is not one anyone wants. The report dialog picks `current` (the preferences), `metric` or `imperial` through `resolveUnitChoice`.

Values stored in a non-SI convention convert at their own boundary and nowhere else — `LaunchConditions` (degrees, °C, hPa) in `LaunchPanel`, and the motor catalog (mm, g) in the motor components.

## Attribution & license

The engine derives from the OpenRocket core (a post-24.12 development build), and the opt-in supersonic-aero (RASAero) extensions are the original work of the mmrocket-sim project. Full credits and license lineage: [`engine-java/ATTRIBUTION.md`](https://github.com/thzero/AstraRocketJs/blob/HEAD/engine-java/ATTRIBUTION.md) (and `docs/rasaero/` for the extensions' physics + diffs).

---
title: "Architecture & internals"
sidebar_position: 16
---
> Developer/architecture reference — the deep dive behind the [Developer Guide](./developer-guide.md), which covers building, running and submitting. The repo's [README](https://github.com/thzero/AstraRocketJs/blob/HEAD/README.md) is the short overview; [Contributing](./contributing.md) covers reporting bugs, translating and the maintainer tasks.

AstraRocketJs runs the **OpenRocket physics kernel** in the browser, compiled to **WebAssembly** (with a **JavaScript fallback**). It's a monorepo:

- `engine-java/` — the OpenRocket physics core (from its **unstable** branch), extracted + minimally patched for TeaVM, compiled to **two** targets: a WebAssembly (WASM-GC) module and a JavaScript module (GPL-3.0; see `engine-java/ATTRIBUTION.md`).
- `web/` — the responsive UI: Vite + React + TypeScript + Tailwind CSS. Consumes the engine through a typed wrapper (`web/src/engine/openRocketEngine.ts`), which picks the backend at load and shows which one is active in the header.

## The extracted engine (`engine-java/src/java/`)

OpenRocket's full `core` module is ~700 Java files and pulls in Guice, JAXB, GraalVM-JS and classgraph — none of which TeaVM (the Java→JavaScript/WASM compiler) can handle. **Extraction** is a one-time copy of just the ~270 files the physics and simulation actually need, leaving behind all the reflection-heavy machinery (file loaders, plugin system, scripting, GUI hooks).

`src/java/` tracks OpenRocket's **unstable** branch, with the TeaVM-compatibility overrides in `patches/` applied on top (`UUID`→`LongUUID`, one concurrent map swapped for a plain one, a reflection-free aerodynamic calculator lookup, and a copy-constructor `ArrayList.clone()` that WASM-GC's strict casts require). **This is the engine** — when the UI calls `staticInfo()` or `simulate()`, this is the code that runs. Don't edit extracted files directly; changes go through a documented override in `patches/` (only when upgrading the upstream OpenRocket version).

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

The worker is registered with `registerType: 'prompt'`, not `autoUpdate`: a silent activation reloads the page, which would interrupt an edit in progress. `components/layout/UpdateToast.tsx` asks instead. A waiting worker activates only when the page posts `SKIP_WAITING`, so an offer that is never answered would hold the tab on the old build for the life of the tab; the toast therefore applies the update itself once the tab has been hidden for `UPDATE_APPLY_HIDDEN_MS` with no simulation in flight.

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

   **Imported motors.** A user can import a `.eng` (RASP) or `.rse` (RockSim) file — each carries its own thrust curve, so neither needs a thrustcurve lookup: `engParser.ts` / `rseParser.ts` parse them, the `MotorStore` persists the result (`motors:custom`), `loadCatalog()` merges it into the picker (flagged, deletable), and `fetchMotorSpec` builds its `MotorSpec` from the stored samples. `motorDb.importCustomMotors` picks the parser from the file's bytes rather than its extension, the way `designFile.ts` does for `.ork`/`.rkt`. This is user content, symmetric to custom materials.

   **`.rse` is the richer of the two**, and `rseParser.ts` is a TypeScript PORT of `file/motor/RockSimMotorLoader.java`, not an extraction of it, for the reason the `.rkt` reader is one: that class is SAX-based and pulls in SimpleSAX, WarningSet, MotorDigest, Manufacturer and ThrustCurveMotor.Builder, which is the file-loading machinery the extraction leaves behind. What the format adds over RASP is the motor TYPE (a hybrid imports as a hybrid), a delay list that can say *plugged*, the real launch CG, and a per-sample mass column — so `samplesToMotorSpec` flies the measured mass curve instead of reconstructing one from cumulative impulse. Three upstream pieces are deliberately not ported, each documented at the top of the file: `MotorDigest` (nothing here de-duplicates motors across files), manufacturer-based type inference (no `Manufacturer` table on this side), and `AbstractMotorLoader.calculateMass` — that last one because `samplesToMotorSpec` already does the identical arithmetic for every motor without a mass column, which `rseParser.test.ts` holds the two to.

   The catalog mirror, per-motor entries, and imported motors all persist through the swappable **`MotorStore`** (`web/src/services/motorStore.ts`; default `KeyValueMotorStore` over IndexedDB), which owns the freshness policy (catalog signature, per-entry TTL). Replace it with `setMotorStore(...)` to move motor data elsewhere — see **Where user data lives** below.

## Materials

Unlike motors, materials are **not** an external feed, but they are shipped the same way: a generated file under `public/data/`, fetched at run time rather than compiled into the bundle. Nothing in `src/` holds a material.

- **Built-ins** — `public/data/materials.generated.json` (97 entries: bulk / surface / line, with densities and groups), written by `web/scripts/sync-materials.mjs` from two inputs. Rows marked `upstream` are OpenRocket's own list, read straight out of its `Databases.java` and held to it by `engine-java/extract/extract.mjs --check`; the rest come from the hand-maintained `web/scripts/data/materials.app.json`, which carries the adhesives (upstream has none, and a fin fillet is made of nothing else) and corrections to upstream values that are wrong. Each of ours cites the document its density came from. The editor's material picker fetches the merged file; the engine reproduces OpenRocket's mass/CG because it applies a material by its **density**.
- **Custom materials** — user-defined (name + density + group), persisted under `materials:custom`, merged into the picker by `services/materials.mergeCustom` (a custom material replaces a built-in of the same name in place, and otherwise joins the group it names), and reusable across designs. The kernel accepts any density directly, so a custom material is just a named density. `services/materials.ts` owns the domain rules; `materialStore.ts` is a typed store that sits on top of the shared key-value store (below).

The material selection is applied to the kernel as a density override (`materialDensity`), so the **physics is exact** — mass/CG match OpenRocket regardless. Material **names** round-trip through `.ork` as well, including names upstream does not have, so a design still says what it is built out of when it is reopened here or on the desktop (`services/ork/materialRoundTrip.test.ts` is what holds that). A material's density is carried in the file, so the engine shim never needs the table.

Because the catalog is a download it can fail to arrive. The picker says so rather than rendering an empty list, and keeps naming the material the part already has: an empty list and a lost name both read as "this part has no material", and neither is true.

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
- **Saved parts** — a component the user built, persisted under `parts:custom` through the swappable **`PresetStore`** (`services/presetStore.ts`), the fourth store of the same shape as motors, materials and templates. Unlike a catalog row, which publishes a handful of dimensions, a saved part holds the **whole node**: `services/customParts.ts` strips only what identifies the node it came from (`id`, `type`, `name`, `position`, `children`) and keeps the rest, so a cone's shoulder, a chute's lines, a tube's motor mount and the part's color all come back. `customParts` also projects each saved part down to a `Component` row (the inverse of `treeEdit.catalogPatch`, held to the catalog's own `isComponentRow`), so the picker searches, facets, fit-ranks and sorts one list rather than two; `catalogPatch` then applies the carried node instead of the per-type map. Saved parts sort ahead of the catalog under every column, because the picker draws a capped 200-row window and a part you saved must never fall off the end of it. Flagged with a ★ and deletable, like an imported motor.
- **The manage view** — `components/design/SavedPartsDialog.tsx`, reached from the menu beside the motor dashboard and the saved launch locations, for the reason those two exist: the picker only renders for a selected node of a matching type (`treeEdit.hasCatalog`), so it cannot show a saved bulkhead on a design that has none. It reads `customParts.listSavedParts`, which differs from `customRowsForType` in one way: a part that no longer projects to a row is kept, with a null row, because the only list you can delete from must not hide the parts the picker already drops.
- **Editing** — the dialog is master-detail (`layout="fill"`, list left at 300px, detail right), the shape the motor picker already uses, including its phone rule: one pane at a time under `md`, with a back control in the detail. `SavedPartEditor.tsx` composes the property panel's OWN pieces (`visibleFields` / `FieldRow`, `MaterialSection`, `AppearanceSection`), which is possible because all of them take a node and an `onChange` and nothing else; `RecoverySizingReadout` is the single store-coupled section and is the one it leaves out. A saved part's `id` is therefore opaque and stable (`custom:<base36 time>:<random>`) rather than the `custom:<type>:<mfr>:<partNo>` it started as: an id that encoded the label made a rename inexpressible, since it produced a different id and so copied the part instead of moving it. The label is what `saveCustomPart` now matches on for "saving again under the same maker and name replaces it", and `updateCustomPart` keeps the id, refusing a label another part of the same type already holds.

Like the motor catalog, it is a generated file under `public/data/` fetched on first use (see above) rather than compiled into the bundle, so it costs nothing until a picker is opened — and it is published to the `data` branch on the same weekly schedule.

## RockSim (`.rkt`) I/O

Read by `services/rktImport.ts` and written by `services/rktExport.ts` — a TypeScript PORT of OpenRocket's `file/rocksim/` package, not an extraction of it. That package is SAX-based and pulls in the desktop's document, appearance and warning machinery; the schema it encodes is small enough to read directly, and reading it here keeps both directions on the same side of the engine boundary as the `.ork` pair: plain DOM, unit-testable, no kernel round trip. The element vocabulary, the unit factors and the four enums are transcribed from `RockSimCommonConstants.java` and its siblings, so an upstream bump can be diffed against those files.

Three conversions run through everything, and getting one wrong yields a design that is silently 2x or 1000x off rather than one that fails to load: RockSim is **millimeters** and **grams**, and every circular dimension in the file is a **diameter**. The exceptions are documented at their call sites — a parachute's `Dia` really is a diameter on both sides, and `ShroudLineMassPerMM` is kg/m despite its name.

`services/designFile.ts` picks the reader from the file's bytes (a zip is a `.ork`; otherwise the root element decides), so `loadOrk` has one path for both formats and everything downstream — the notes banner, the safety-limit check, the unsaved-copy semantics — is shared rather than duplicated per format. The header carries one hidden file input per format, differing only in `accept`.

Neither side is lossless in general, and both say so: RockSim has ring tails, detachable pods and subassemblies we do not, and we have rail buttons and parallel stages it does not. The importer collects those into the loaded-design notes; the exporter returns the skipped types to the caller, which surfaces them rather than letting a user discover the gap when somebody else opens the file.

## Example rockets

The sixteen designs OpenRocket ships and opens from *File → Open Example*, bundled with the app under `web/public/examples/` and listed by a generated `examples.generated.json`.

`web/scripts/sync-examples.mjs` (`npm run sync:examples`) pulls them from the **same commit `engine-java/extract/UPSTREAM` pins for the engine**, so an example can never demonstrate a feature the bundled kernel does not have. It also **strips each file's stored `<flightdata>`**: 90% of the bytes — 2.9 MB of the 3.3 MB across the set — and dead weight here, because `orkImport` never reads it (the app runs its own simulations). Stripped, the set is ~330 kB. Designs, appearances, decals and embedded thrust curves are untouched.

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

A launch location is a named site: `latitudeDeg`, `longitudeDeg` and `launchAltitudeM`, stored in SI like everything else. It holds nothing else. The rod, the wind and the atmosphere are conditions on the day, not properties of a field.

`services/launchLocationStore.ts` is a typed `LaunchLocationStore` over the shared key-value store, swappable via `setLaunchLocationStore`. Its key is `pads:custom`, the feature's older name, kept because existing browsers hold saved sites under it. Saves are validated against the same ranges `LaunchPanel` clamps its fields to, so a hand-edited blob cannot put a latitude past ±90 into the kernel's gravity and Coriolis terms or into a KML origin.

- `components/sim/LocationPicker.tsx` sits at the top of the launch panel's Site group and writes through the panel's own `onChange` / `onCommit`, so applying a location is an ordinary undoable edit under the same multi-selection rules as typing the numbers.
- `components/sim/LocationsDialog.tsx` is the list. It loads from the store and applies through `patchLaunch`, so one component serves both the launch panel's ⚙ and **menu → Launch locations**, where no site field is on screen to write into.
- `components/sim/LocationEditDialog.tsx` edits a location in full and creates one from nothing, which is the only way to add one from the menu. Its `min` / `max` are the store's ranges, so `NumberInput` clamps a value `isLocation` would reject instead of refusing it after the fact. Its elevation field binds to the launch panel's unit scope.
- `components/sim/useLocationList.ts` numbers its reads and drops a superseded answer. IndexedDB's first `list()` of a session is the slowest, so a location saved in the meantime resolves first and is then overwritten by the older, empty result.

Which location is current is derived by comparing the numbers, not by remembering a selected id: the fields can change by import, by geolocation or by hand, and an id would keep naming a site that is no longer on screen.

### Maps

`components/sim/SiteMap.tsx` draws the site; `services/slippyMap.ts` holds the Web Mercator projection, the tile sources and the viewport math. There is no mapping library: one point, drag, pan and zoom is the whole requirement, so tiles are `<img>` tags at computed offsets. A pure projection is what lets it be tested against hand-computed Mercator figures.

- Tiles come from Esri (`World_Imagery`, `World_Street_Map`), whose paths are `{z}/{y}/{x}` rather than the usual `{z}/{x}/{y}`. A Workbox `CacheFirst` rule in `vite.config.ts` keeps up to 1200 of them, so a site checked at home still draws at a field with no signal.
- **Never point a tile layer at `openstreetmap.org`.** Those servers are volunteer-funded and the OSM Tile Usage Policy reserves them for OpenStreetMap's own use; the requests are blocked. Esri's street map carries OSM data and credits it in the attribution. A unit test asserts no tile URL names that host and an end-to-end test asserts nothing reaches it on the wire.
- Tiles must send a referrer. `referrerPolicy="no-referrer"` strips the one header a provider has to identify who is calling.
- Tiles are requested with CORS, and so are their service-worker entries: an opaque response cannot answer a CORS request. The 3D canvas is created with `preserveDrawingBuffer` so image export can read it back, and one texture loaded without CORS taints the canvas and breaks that export silently. The cache is `astra-map-tiles-v2`.
- Three consecutive tile errors with none loaded swap in a coordinate graticule rather than a gray box. Deliberately not a drawn coastline: a rough one puts the pin in a shape that is nearly a country, which is worse than no shape when the job is telling you whether the numbers are where you meant.
- The pan and click-to-place handlers live on the box that also holds the layer, zoom and recenter buttons, and ignore any pointer event starting on a control. The drag capture is taken on the box, not on `e.target`, which is usually a tile and unmounts as soon as a pan scrolls past it.

`components/sim/SiteMapDialog.tsx` is the same map opened over the launch panel, whose column is too narrow to show a field and its surroundings; `LocationEditDialog` has the room to keep one inline. Both write coordinates through the caller's change path, so a click on the map is one undoable edit.

### The same tiles under the results views

`components/canvas/GroundTrack.tsx` lays tiles under the plan view and `components/canvas/FlightGroundMap.tsx` textures them onto the 3D path's ground plane. `services/tileLayer.ts` holds the satellite/street choice and the on/off state for the session, so the answer is the same wherever it is switched.

- Both results views start **off** and fetch nothing until asked: the range rings and the trajectory are the measurement. `SiteMap` is the other way round and draws imagery by default, because there the picture is the answer rather than the context.
- Neither uses `SiteMap`'s fixed `SITE_ZOOM`; both size themselves to the flight. `zoomForMetersPerPixel` picks the tile zoom nearest the resolution being drawn, rounding in log space. Rounding up leaves a scale factor in (0.5, 1] and lays the layer out at up to twice the box in each direction, which is four times the tiles.
- The plan view scales its tile layer by the leftover fraction, so the imagery bends to the range rings rather than the rings to the imagery. `trackExtent` floors at `MIN_EXTENT_M` (50 m, so 100 m across): a still-air flight lands a tenth of a meter from the pad, and a view scaled to that is a picture of grass.
- The 3D layer sizes its ground to the track's own reach plus a margin rather than the fixed 60-unit plane.
- The 3D texture sets `flipY` to `false`. A plane laid flat by rotating -90° about x sends its own +y to -z, so the default flip mirrors the ground north for south. `groundMapLayout` is pure and tested for northern tiles landing north, because a screenshot does not catch a mirrored aerial photograph.
- The `<img>` tiles carry `max-w-none` and an explicit CSS size. The reset's `img { max-width: 100% }` is relative to the containing block, and the plan view's tile layer is deliberately narrower than its box when imagery is magnified; below 256px the tiles drew shrunk while still spaced a full tile apart.

## Where user data lives (swappable stores)

Client-side user data lives behind **independently swappable, typed domain stores** — one each for motors, materials and saved parts — so any of them can be replaced with a different implementation without touching the services or the UI:

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

presetStore.ts      PresetStore  — getPresetStore() / setPresetStore(store)
   list / add / remove CustomPart — the components the user saved for reuse, each holding a
   whole node rather than a catalog row's dimensions. Default KeyValuePresetStore persists via
   a KeyValueStore; customParts.ts owns the domain rules (what is saved, the projection to a
   picker row, the change signal the picker subscribes to).
```

All of them default to persisting through an **`IndexedDbKeyValueStore`**, and their interfaces are async so a different implementation (a backend, a shared store) fits without reshaping callers. To replace one on the client, implement its interface and swap it:

- **Motors:** `setMotorStore(new MyMotorStore())`
- **Materials:** `setMaterialStore(new MyMaterialStore())`
- **Saved parts:** `setPresetStore(new MyPresetStore())`

…or keep the default domain logic over a different key-value backend:

- `setMotorStore(new KeyValueMotorStore(new MyKeyValueStore()))`
- `setMaterialStore(new KeyValueMaterialStore('materials:custom', new MyKeyValueStore()))`
- `setPresetStore(new KeyValuePresetStore('parts:custom', new MyKeyValueStore()))`

Swapping one does not affect the others.

### Why IndexedDB, and the two places localStorage remains

localStorage is synchronous — every read and write blocks the main thread — and capped near **5 MB per origin**, shared across designs, custom motors and materials, imported templates and the thrust-curve caches. `workspaceStore.save()` throwing `storage-full` is that cap showing through. IndexedDB is async and effectively uncapped.

Existing data migrates **lazily, per key, on first read**: a key absent from IndexedDB but present in localStorage is copied across, and the original is deleted only once the write is confirmed — an interrupted migration retries next load rather than destroying the only copy. If IndexedDB is unavailable (blocked by policy, some private modes), every operation transparently falls back to localStorage, so the app degrades to its previous behavior rather than losing storage.

`designLibrary.ts` makes designs addressable, and folds a pre-library single-blob workspace in as the first entry on first use, named after its imported `.ork` if it had one. The unload journal records **which** design it belongs to, because replaying it into whatever happens to be open would overwrite an unrelated rocket.

### One design in, one entry out

Two rules keep the library from filling up with copies of the same rocket. Both failures look identical from the File > Open list, and neither is recoverable by the user.

**An import is detached, and named before it lands.** `openOrkFile` calls `setActiveId(null)`, so the next autosave creates an entry: an imported rocket is its own design, not an edit to whatever was on screen. `store.ts`'s `homeForImport` resolves a name clash **before** `replaceWorkspace`, offering either to overwrite the existing entry or to name this one (the next free `… (2)` is suggested). It has to run before the swap, or the 500 ms debounce fires while the dialog is open and creates the very entry being asked about. The answer reaches the autosave through `WorkspaceStore.setPendingName`, so there is exactly one `create`, made by the autosave, rather than the caller racing it with a second. The dialog is `state/promptStore.ts` plus `components/common/PromptDialog.tsx`, the promise-based sibling of `confirmStore`, for a store that needs an answer mid-action and cannot render.

**Only one create can be in flight.** Overlapping saves share a single `create` in `LibraryWorkspaceStore.save`, and a create that resolves after the workspace has been replaced does not adopt its id. The window is wide enough to matter: the debounce is 500 ms, the first IndexedDB create is the slowest write the app makes, and the `visibilitychange` flush saves outside the debounce entirely. `DesignLibrary.create` also rolls back when its active-pointer write is refused, since a half-done create leaves the design indexed while the caller still has no active id.

There is no **File > Save**: editing autosaves on the debounce, and unload writes the journal. `components/layout/SaveStatus.tsx` reports the last write from `lastSavedAt`, which `useWorkspaceEffects` sets on the save's own success path rather than where a save was requested, so a refused write cannot claim one.

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

**A chip changes its own field and stops there.** Re-basing every length in the app is too big an effect to hang off a small control beside one number. Component fields are scoped by component TYPE, not per instance, so selecting another body tube does not forget the unit just set on that card.

Stored symbols are validated at read time, in `unitFor`, against the quantity the field turns out to be. A scope key does not name its quantity, so an `in` left behind on a field that is now a mass would otherwise reach `unitDef` and quietly become grams.

Three rules keep the two layers from getting stuck: picking the preference back from a chip **removes** the override rather than storing a matching one (so the field resumes following the preference); the Metric / Imperial presets **clear every override**, or they would leave stranded fields on top of the preset; and the Units tab surfaces a **Reset N fields** button whenever any exist, since a per-field choice is otherwise hard to find again.

Orphaned keys are **not** pruned. A scope only exists while its field renders, so nothing can enumerate the live set at load time, and a renamed field key simply leaves an entry nothing reads (`unitFor` falls back for it). That is a deliberate non-feature: the map tops out in the low tens of entries at a few dozen bytes each, so a reaper would cost more code than the bytes it reclaims. `PropertyPanel.scopes.test.ts` guards the failure that would actually matter — two fields of one component type colliding on a key, which would silently make them share a unit.

Exports deliberately do not see the per-field layer — a document half in inches and half in centimeters because of where someone clicked is not one anyone wants. The report dialog picks `current` (the preferences), `metric` or `imperial` through `resolveUnitChoice`.

Values stored in a non-SI convention convert at their own boundary and nowhere else — `LaunchConditions` (degrees, °C, hPa) in `LaunchPanel`, and the motor catalog (mm, g) in the motor components.

## Attribution & license

The engine derives from the OpenRocket core (its **unstable** branch). Full credits and license lineage: [`engine-java/ATTRIBUTION.md`](https://github.com/thzero/AstraRocketJs/blob/HEAD/engine-java/ATTRIBUTION.md) (and `docs/rasaero/` for the extensions' physics + diffs).

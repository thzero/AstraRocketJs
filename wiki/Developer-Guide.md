# Developer Guide

AstraRocketJs is a monorepo: a **web app** (`web/`) and the **OpenRocket engine** (`engine-java/`) compiled to WebAssembly + JavaScript by TeaVM. Full developer docs live in the repo:

- **[Architecture & internals](Architecture)** — how it all fits together: the extracted engine, the WASM/JS build pipeline and backend selection, threading (the simulation Web Worker), and the motor / material / component / `.ork` data flows.
- **[Contributing](Contributing)** — requirements, install, running the app, rebuilding the engine, the catalog tools, tests, and how to report bugs, translate, and submit changes.

## The short version

- **Requirements** — Node 22+ for the app; a JDK only if you rebuild the engine (Gradle is bundled).
- **Run the app** — `cd web && npm install && npm run dev`.
- **Rebuild the engine** (rarely needed; the build is committed) — `cd engine-java && node build-engine.mjs` (JS) and `node build-engine.mjs --wasm` (WASM).
- **Engine** — extracted OpenRocket core, minimally patched for TeaVM (`engine-java/`), exposed to the app through a typed wrapper (`web/src/engine/openRocketEngine.ts`).

## Attribution

The engine derives from OpenRocket (GPL-3.0); the opt-in supersonic-aero (RASAero-style) extensions are the original work of the mmrocket-sim project. Full credits and license lineage are in [`engine-java/ATTRIBUTION.md`](https://github.com/thzero/AstraRocketJs/blob/HEAD/engine-java/ATTRIBUTION.md).

---
title: "Developer Guide"
sidebar_position: 15
---
AstraRocketJs is a monorepo: a **web app** (`web/`) and the **OpenRocket engine** (`engine-java/`) compiled to WebAssembly + JavaScript by TeaVM. Full developer docs live in the repo:

- **[Architecture & internals](./architecture.md)** — how it all fits together: the extracted engine, the WASM/JS build pipeline and backend selection, threading (the simulation Web Worker), and the motor / material / component / `.ork` data flows.
- **[Contributing](./contributing.md)** — requirements, install, running the app, rebuilding the engine, the catalog tools, tests, and how to report bugs, translate, and submit changes.
- **[Dependencies](./dependencies.md)** — the npm version policy, and why a package is deliberately held back from its latest (read this before "fixing" anything `npm outdated` flags).

## The short version

- **Requirements** — Node 22+ for the app; a JDK only if you rebuild the engine (Gradle is bundled).
- **Run the app** — `cd web && npm install && npm run dev`.
- **Rebuild the engine** (rarely needed; the build is committed) — `cd engine-java && node build-engine.mjs`, which builds and vendors both the WASM-GC and JS targets.
- **Engine** — extracted OpenRocket core, minimally patched for TeaVM (`engine-java/`), exposed to the app through a typed wrapper (`web/src/engine/openRocketEngine.ts`).

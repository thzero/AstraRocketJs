---
title: "FAQ"
sidebar_position: 4
---
### Is this OpenRocket?
No — it's an independent app that **runs OpenRocket's physics engine** in the browser. It covers the essentials with a lightweight, mobile-friendly UI, and reads/writes the same `.ork` files. It is not affiliated with the OpenRocket project.

### Do I need to install anything?
No. It's a web app — open the URL in a modern browser. No JDK, no download.

### Are my designs uploaded anywhere?
No. Everything runs on your device. Your design is a `.ork` file on your disk; the app keeps a working copy plus your custom motors/materials/settings in your browser's local storage. Nothing is sent to a server.

### Will my `.ork` files work in desktop OpenRocket?
Yes — open and save are full-fidelity round-trips, and a saved file re-opens in desktop OpenRocket.

### Can I open a RockSim file?
Yes — **menu → Import → RockSim** reads a `.rkt`, and **Export → RockSim** writes one. The design comes across; the **motors and launch conditions do not**, because RockSim keeps those with its simulations rather than its designs, so pick a motor after importing. [Files & Exports](./files-and-exports.md#rocksim-rkt) lists exactly what each direction carries and what it leaves behind.

### Can I 3D print the parts?
Yes. Any part with a real solid body carries a **⬇** button in the component tree offering STL, OBJ, GLB and 3MF, and **menu → Export → 3D print (.3mf)** writes the whole rocket at once as a single file with one named object per part. See [Files & Exports](./files-and-exports.md#exporting-the-whole-rocket-for-3d-printing-3mf).

### Do my unit choices show up in desktop OpenRocket?
No. Units live in your browser's settings, not in the `.ork` — the file has nowhere to record them, and desktop OpenRocket keeps its own in its preferences. Your file opens there in OpenRocket's units and back here in yours; the rocket is the same either way. For the same reason your units don't follow you to another computer or browser. See **[Settings](./settings.md#units)**.

### Why is the stability different "on the pad" vs "at rail exit"?
By the time the rocket leaves the launch rod/rail it's a little lighter (some propellant burned) and its CG has shifted, so its stability margin differs from the fully-loaded on-pad value. Rail-exit is usually the more meaningful number.

### Can I use inches / imperial units?
Yes. **Settings ▸ Units** has an **Imperial defaults** button, and you can set each quantity separately (lengths in inches, altitude in feet, mass in ounces, wind in mph, and so on). The unit printed next to any value is also a picker — click it to change that one field, leaving everything else on your defaults.

Units only affect what's shown and typed: your design is always stored in SI, so switching units never changes a rocket or how a `.ork` file is written. See **[Settings](./settings.md#units)**.

### Does it work offline?
Yes. After your first visit the app keeps itself, the physics engine and both catalogs on your device, so it opens and runs a full simulation with no connection — useful at a launch site with no signal. Your browser will also offer to **install** it. See **[Offline & Installing](./offline-and-installing.md)**.

### What's the `WASM` / `JS` badge in the header?
Which engine backend loaded: **WASM** (WebAssembly — the fast default) or **JS** (JavaScript — the fallback for browsers without WASM support). Both produce identical results.

### A material name changed after I saved and reopened a `.ork`. Is my rocket wrong?
No — the **physics is preserved** (materials are applied by density, so mass/CG/stability are exact). Only the human-readable **name** of a non-default material may not survive a round-trip yet; the density is intact.

### The simulation didn't freeze the app while running — is that normal?
Yes. Flight simulations run in a background Web Worker, so the UI stays responsive while a flight computes.

### How do I report a bug or request a feature?
See the **[Contributing](./contributing.md)** page — bug reports, feature ideas, translations, and code are all welcome.

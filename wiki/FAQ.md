# FAQ

### Is this OpenRocket?
No — it's an independent app that **runs OpenRocket's physics engine** in the browser. It covers the essentials with a lightweight, mobile-friendly UI, and reads/writes the same `.ork` files. It is not affiliated with the OpenRocket project.

### Do I need to install anything?
No. It's a web app — open the URL in a modern browser. No JDK, no download.

### Are my designs uploaded anywhere?
No. Everything runs on your device. Your design is a `.ork` file on your disk; the app keeps a working copy plus your custom motors/materials/settings in your browser's local storage. Nothing is sent to a server.

### Will my `.ork` files work in desktop OpenRocket?
Yes — open and save are full-fidelity round-trips, and a saved file re-opens in desktop OpenRocket.

### Why is the stability different "on the pad" vs "at rail exit"?
By the time the rocket leaves the launch rod/rail it's a little lighter (some propellant burned) and its CG has shifted, so its stability margin differs from the fully-loaded on-pad value. Rail-exit is usually the more meaningful number.

### Can I use inches / imperial units?
Not yet — the app is **metric/SI only** for now.

### Does it work offline?
There's no installable offline (PWA) mode yet. Once a motor's thrust curve has been fetched it's cached, so re-picking it works without a connection, but the app itself still loads over the web.

### What's the `WASM` / `JS` badge in the header?
Which engine backend loaded: **WASM** (WebAssembly — the fast default) or **JS** (JavaScript — the fallback for browsers without WASM support). Both produce identical results.

### A material name changed after I saved and reopened a `.ork`. Is my rocket wrong?
No — the **physics is preserved** (materials are applied by density, so mass/CG/stability are exact). Only the human-readable **name** of a non-default material may not survive a round-trip yet; the density is intact.

### The simulation didn't freeze the app while running — is that normal?
Yes. Flight simulations run in a background Web Worker, so the UI stays responsive while a flight computes.

### How do I report a bug or request a feature?
See the **[Contributing](Contributing)** page — bug reports, feature ideas, translations, and code are all welcome.

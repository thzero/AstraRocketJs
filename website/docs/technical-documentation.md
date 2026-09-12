---
title: "Technical Documentation"
sidebar_position: 3
---
AstraRocketJs runs **OpenRocket's own physics kernel** — the aerodynamics, mass/CG and flight integration are OpenRocket's code, not a reimplementation (see [Architecture & internals](./architecture.md)). So for *how the physics works*, OpenRocket's own technical documentation is the reference, and nothing here restates it.

## OpenRocket technical documentation

OpenRocket began as the Master's thesis of **Sampo Niskanen** at Helsinki University of Technology. The thesis was later extended and updated into the OpenRocket technical documentation, which is the authoritative description of the models the simulator uses — Barrowman and Extended Barrowman aerodynamics, drag build-up, mass and moment-of-inertia calculation, the flight simulation and its integrators, and recovery.

- **[OpenRocket technical documentation](https://github.com/openrocket/openrocket/releases/download/OpenRocket_technical_documentation-v13.05/OpenRocket_technical_documentation-v13.05.pdf)** (2013-05-10, PDF ~1.2 MB) — the current document; start here.
- **[Development of an Open Source model rocket simulation software](https://github.com/openrocket/openrocket/releases/download/Development_of_an_Open_Source_model_rocket_simulation-thesis-v20090520/Development_of_an_Open_Source_model_rocket_simulation-thesis-v20090520.pdf)** (Master's thesis, 2009-05-20, PDF ~1.3 MB) — the original work the documentation grew out of.

Both are linked from OpenRocket's [documentation page](https://openrocket.info/documentation.html).

> **Licensing.** The technical documentation is under a **Creative Commons Attribution-ShareAlike** licence; the Master's thesis is under **Attribution-NonCommercial-NoDerivs**. They are OpenRocket's documents, not ours.

## User documentation

- **[OpenRocket user guide](https://openrocket.readthedocs.io)** — the desktop application's manual. Much of it describes desktop features AstraRocketJs does not have, but the sections on rocket design, stability and simulation parameters apply to the same underlying engine.

## Rocketry resources

OpenRocket's **[Resources wiki page](https://github.com/openrocket/openrocket/wiki/Resources)** collects the primary literature — Barrowman's original report and thesis, extensions to the Barrowman method, experimental rocket data, and related references.

## What is specific to AstraRocketJs

Two things are ours rather than OpenRocket's, and are documented here:

- **[Architecture & internals](./architecture.md)** — which parts of the OpenRocket core were extracted, the TeaVM compilation to WebAssembly and JavaScript, and the handful of compatibility patches applied to the kernel.
- **The supersonic aerodynamics extension** — the opt-in RASAero-style corrections (see [Settings](./settings.md)) are the original work of the mmrocket-sim project, not part of OpenRocket. Their physics, source diffs and validation are in [`docs/rasaero/`](https://github.com/thzero/AstraRocketJs/tree/HEAD/docs/rasaero) and [`engine-java/ATTRIBUTION.md`](https://github.com/thzero/AstraRocketJs/blob/HEAD/engine-java/ATTRIBUTION.md).

AstraRocketJs is an independent project and is not affiliated with OpenRocket.

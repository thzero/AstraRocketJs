---
title: "Compared with OpenRocket"
sidebar_position: 18
---

import AppVersion from '@site/src/components/AppVersion';
import UpstreamPin from '@site/src/components/UpstreamPin';

:::info Snapshot, and how to read it

Written **2026-09-22**, comparing **AstraRocketJs <AppVersion />** (engine built from OpenRocket <UpstreamPin />) against **desktop OpenRocket**: release **24.12**, the current numbered release, and the `unstable` development line the engine pin sits on.

:::

## The one thing that is not a difference

[Overview](./overview.md) says AstraRocketJs covers "the essentials rather than every desktop feature".

The aerodynamics, the mass and CG build-up, and the flight integration are **OpenRocket's own code**, extracted from the commit above and compiled to WebAssembly and JavaScript. They are not a reimplementation and not an approximation, and they are checked bit-identical against the same kernel running on a JVM. So there is no row below that reads "OpenRocket computes drag more accurately": for the same design, the same motor and the same conditions, the same numbers come out.

Everything that follows is therefore about **the program around the engine**: what you can author, what you can look at, and what you can get out.

## What desktop OpenRocket has, and this does not

| Desktop feature | Where it stands here, and why |
| --- | --- |
| **Rocket optimization** (search a design parameter for the best apogee, altitude or velocity) | Not available.  |
| **Custom expressions** (define your own flight variable from the simulated ones and plot it) | Not available. |
| **Simulation extensions and scripting** (air-start, roll control, the JavaScript scripting extension) | Not available. |
| **Flight configurations in the interface** (several named motor setups per design, switched from a dropdown) | Partly. A `.ork` carrying several configurations **round-trips** them, and an import warns when a configuration you did not open uses a motor missing from the catalog. But the app opens **one** as a single simulation, and there is no way to author or switch between them. |
| **Appearance, decals and Photo Studio** (textures on components, rendered photos) | Not available, no plans at this time. |
| **Fin marking guide** (the wrap-around paper template that says where around the tube each fin goes) | Not available yet. |
| **Saving your own component to a preset library** | Not available. |
| **`.rse` (RockSim) motor files** | Not available: `.eng` only. Wanted most for hybrids, whose data often ships as `.rse`. |
| **Packed recovery-device dimensions** | Not available. |
| **Languages** | OpenRocket ships more locales. |
| **Validated staged flight** | Multi-stage rockets are authorable here and simulate as independent branches, and their static mass, CG and stability match desktop OpenRocket. The flown staged trajectory (separation and upper-stage ignition timing, booster descent) has **not** been checked end-to-end against the desktop yet. Treat staged flight results as preliminary. See [Safety](./safety.md). |

## What this has, and desktop OpenRocket does not

| Feature | Notes |
| --- | --- |
| **Runs in a browser, installs, and works offline** | No JDK and no download. After the first visit the app, the engine and both catalogs stay on your device, so a full simulation runs at a field with no signal. See [Offline & Installing](./offline-and-installing.md). |
| **A layout that fits a phone** | The desktop workbench becomes tabs along the bottom, with the rocket views turned a quarter turn so the airframe runs down the long edge of the screen. |
| **RASAero-style supersonic aerodynamics** | Opt-in corrections to Extended Barrowman above roughly Mach 1.5, where the stock model's body CP is frozen at its Mach-1 value. They are **not** part of OpenRocket: they are the work of the mmrocket-sim project, carried here under GPL-3.0. See [Compared with mmrocket-sim](./comparison-mmrocket-sim.md). |
| **Ground-track view** | The flight seen from directly above, north up, pad at the center, with range rings and the landing distance and bearing for each stage. |
| **Flight-path export to KML / GPX / waypoint CSV** | Opens the flight in Google Earth or a GPS app, with per-stage track colors, a mission name, summary balloons carrying the flight's numbers, and importable custom Mustache templates. |
| **Whole-rocket 3MF, and per-part STL / GLB / 3MF** | One file with a named object per part, ready for a slicer. OpenRocket exports OBJ, which this does too; the rest is extra. |
| **DXF cut sheets** | Flat parts (fins, rings, bulkheads) as 2D cut files. |
| **Saved launch locations, on a map** | Name the field you fly from and recall its coordinates and elevation, with a satellite or street map to check them against the ground, and click-to-set for a field with no published numbers. Something close to this is [open upstream as a pull request](https://github.com/openrocket/openrocket/pull/3211) and has not shipped. |
| **Parachute descent sizing** | Pick a canopy and see the descent rate it gives against the main and drogue bands, and the diameter needed to hit each. |
| **NAR / Tripoli limits, enforced** | The rod is held within 20 degrees of vertical and surface wind at or below 20 mph, and a run outside those is **refused** rather than flown. Every set of results carries a "Before you fly" card. See [Safety](./safety.md). |
| **Nothing to save, and nothing uploaded** | Editing autosaves, the header says when the last write landed, and there is no server and no account. |

## What to use which for

If you need optimization, custom expressions, simulation extensions, photo-realistic renders, use the desktop program. If you want the same numbers on a phone at the field, with no install and no network, use this. Files move both ways, so it is not a choice you have to make once.

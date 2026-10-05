---
title: "Compared with OpenRocket"
sidebar_position: 18
---

import AppVersion from '@site/src/components/AppVersion';
import UpstreamPin from '@site/src/components/UpstreamPin';

:::info Snapshot, and how to read it

Written **2026-09-29**, comparing **AstraRocketJs <AppVersion />** (engine built from OpenRocket <UpstreamPin />) against **desktop OpenRocket**: release **24.12**, the current numbered release, and the `unstable` development line the engine pin sits on.

:::

## The one thing that is not a difference

[Overview](./overview.md) says AstraRocketJs covers "the essentials rather than every desktop feature".

The aerodynamics, the mass and CG build-up, and the flight integration are **OpenRocket's own code**, extracted from the commit above and compiled to WebAssembly and JavaScript. They are not a reimplementation and not an approximation, and they are checked bit-identical against the same kernel running on a JVM. So there is no row below that reads "OpenRocket computes drag more accurately": for the same design, the same motor and the same conditions, the same numbers come out.

Everything that follows is therefore about **the program around the engine**: what you can author, what you can look at, and what you can get out.

## What desktop OpenRocket has, and this does not

| Desktop feature | Where it stands here, and why |
| --- | --- |
| **Rocket optimization** (search a design parameter for the best apogee, altitude or velocity) | Not available. OpenRocket's `optimization` package is not part of the extraction (`engine-java/extract/manifest.txt`), so the search machinery is not even in the bundled core. It would have to be rebuilt on the JavaScript side. |
| **Custom expressions** (define your own flight variable from the simulated ones and plot it) | Not available, for the same reason: the `customexpression` package is not extracted. The flight CSV export hands you the raw series to compute from yourself. |
| **Simulation extensions and scripting** (air-start, roll control, the JavaScript scripting extension) | Not available. The `simulation/extension` package is not extracted, so an extension cannot run. It shows in the bundled examples: the two "simulation extension" designs open and fly as ordinary airframes, which is exactly what their own descriptions say. |
| **Appearance, decals and Photo Studio** (textures on components, rendered photos) | Not available. The core's `appearance` classes *are* extracted, so a file's appearance survives a round-trip, but nothing in the interface edits or draws it. The 3D view is a solid model. |
| **Saving your own component to a preset library** | Partly. **Save as part** stores a component you built and offers it back in the picker on every design, whole: geometry, material, finish and color, not just the dimensions a catalog row publishes. **Menu → My Parts** lists, edits and removes them. What is missing is the file half: OpenRocket's presets are `.orc` files you can share and load, and a saved part here lives in your browser only. Assemblies are out too — a body tube saves without its fins. |
| **Camera shrouds and other protuberances** | Not available. They are not first-class components in OpenRocket's own model either, so even there they contribute mass and a drawing rather than aerodynamics. |
| **Printing** | A different shape. OpenRocket prints from a print dialog; here the design report is written as a **PDF** you then print, and its templates are 1:1. |
| **Languages** | OpenRocket ships in more languages than this app does. |

## What this has, and desktop OpenRocket does not

| Feature | Notes |
| --- | --- |
| **Runs in a browser, installs, and works offline** | No JDK and no download. After the first visit the app, the engine and both catalogs stay on your device, so a full simulation runs at a field with no signal. See [Offline & Installing](./offline-and-installing.md). |
| **A layout that fits a phone** | The desktop workbench becomes tabs along the bottom, with the rocket views turned a quarter turn so the airframe runs down the long edge of the screen. |
| **Flight configurations** (several named setups per design, each with its own motors, recovery, staging and active stages) | A **Configurations** tab of its own: rows are configurations, columns are the mounts, chutes or stages they configure, and every simulation names the one it flies. A `.ork`'s configurations all come in, keeping the file's own ids, each with a simulation to fly it. See [Flight Configurations](./flight-configurations.md). |
| **Ground-track view** | The flight seen from directly above, north up, pad at the center, with range rings and the landing distance and bearing for each stage. |
| **Flight-path export to KML / GPX / waypoint CSV** | Opens the flight in Google Earth or a GPS app, with per-stage track colors, a mission name, summary balloons carrying the flight's numbers, and importable custom Mustache templates. |
| **Whole-rocket 3MF, and per-part STL / GLB / 3MF** | One file with a named object per part, ready for a slicer. OpenRocket exports OBJ, which this does too; the rest is extra. |
| **DXF cut sheets** | Flat parts (fins, rings, bulkheads) as 2D cut files. |
| **RASAero II (`.CDX1`) export** | Hands the design to RASAero II for its own aerodynamic analysis. |
| **RockSim `.rkt` export** | OpenRocket opens RockSim files; it does not write them. Both directions work here, and each one names what it leaves behind. See [Files & Exports](./files-and-exports.md#rocksim-rkt). |
| **Saved launch locations, on a map** | Name the field you fly from and recall its coordinates and elevation, with a satellite or street map to check them against the ground, and click-to-set for a field with no published numbers. Something close to this is [open upstream as a pull request](https://github.com/openrocket/openrocket/pull/3211) and has not shipped. |
| **Weather from a forecast, for a chosen date** | Fills temperature, pressure, humidity, a wind profile and the atmosphere aloft from [Open-Meteo](./running-a-simulation.md#weather), with a record of which forecast was used. Desktop's version (PR #3211) is not merged yet, and fetches current conditions only. |
| **A forecast atmosphere aloft** | Temperature, pressure and humidity by altitude, flown in place of the standard atmosphere above the site. Desktop has only the standard atmosphere; issue #2737 proposes this. A `.ork` carries it as an extension desktop skips. |
| **Environment view** | The air the flight actually met, read from the recorded flight: the conditions at launch and four profiles against altitude. See [Views & Analysis](./views-and-analysis.md#environment-after-a-simulation). |
| **Landing across the forecast hours** | After a run under a forecast, the Environment view flies the same design under each hour from two before to two after and maps where each one landed, with a 2σ ellipse around them. See [Views & Analysis](./views-and-analysis.md#where-it-landed). |
| **Landing estimator** | A tool that needs no design: a site, a forecast hour, an apogee and descent rates give a landing on the real ground and a 2σ landing zone. See [Tools](./tools.md#landing-estimator). |
| **Rail exit check** | A tool that needs no design: a catalog motor, the rocket's mass and the rail length give the thrust to weight, the rail exit speed and the weathercock angle in a typed or forecast wind. See [Tools](./tools.md#off-the-rail). |
| **Parachute descent sizing** | Pick a canopy and see the descent rate it gives against the main and drogue bands, and the diameter needed to hit each, or a rate of your own, with a button to apply it. Also on the Tools tab with no design. |
| **NAR / Tripoli limits, enforced** | The rod is held within 20 degrees of vertical and surface wind at or below 20 mph, and a run outside those is **refused** rather than flown. Every set of results carries a "Before you fly" card. See [Safety](./safety.md). |
| **Undo that covers simulations too** | Component edits and simulation changes (motor, ignition, launch conditions, adding or deleting a simulation) sit on one timeline. |
| **A unit picker on every value** | The unit printed beside any number is also a control for that particular field, on top of the metric and imperial profiles. See [Settings](./settings.md#units). |
| **Nothing to save, and nothing uploaded** | Editing autosaves, the header says when the last write landed, and there is no server and no account. |

## What to use which for

If you need optimization, custom expressions, simulation extensions, photo-realistic renders, use the desktop program. If you want the same numbers on a phone at the field, with no install and no network, use this. Files move both ways, so it is not a choice you have to make once.

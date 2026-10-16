---
title: "Compared with ZenRockets"
sidebar_position: 19
---

import AppVersion from '@site/src/components/AppVersion';
import UpstreamPin from '@site/src/components/UpstreamPin';

:::info Snapshot, and how to read it

Written **2026-09-23**, comparing **AstraRocketJs <AppVersion />** (engine built from OpenRocket <UpstreamPin />) against **[ZenRockets](https://zenrockets.com)** at **v0.2.0**, the latest entry in [their changelog](https://zenrockets.com/docs/changelog) on that date (dated 2026-09-15).

:::

## They are not the same kind of tool

The first thing to know is that the two do not share a physics engine.

AstraRocketJs runs **OpenRocket's own kernel**, compiled to WebAssembly and JavaScript, and checked against the same code on a JVM. ZenRockets [credits](https://zenrockets.com/docs/acknowledgements) **RocketPy** as "the flight simulation foundation used by ZenRockets' trajectory service", **openMotor** for its internal-ballistics work, and OpenRocket for file-format compatibility and validation references.

So the same rocket, the same motor and the same conditions will not necessarily give the same apogee in both. Neither result is automatically the right one. If you care which, fly it, and compare both against the altimeter.

The second thing is the shape of the product. ZenRockets is an account-backed service: designs are "private by default with public share links and cloning", with dashboards for rockets, motors, flights, presets and materials, and live weather forecasts pulled per flight. AstraRocketJs is client-only: no account, no server, nothing uploaded, and it keeps working with the network off.

## What ZenRockets has, and this does not

Each row says where the feature stands here and, where there is one, the reason.

| ZenRockets feature | Where it stands here, and why |
| --- | --- |
| **Designing the motor itself**: custom cases, five grain geometries, converging-diverging nozzles, custom propellants with pressure-dependent burn-rate regimes, and an internal-ballistics simulation producing thrust, chamber pressure, Kn and mass flow | Nothing comparable, and none planned. This app **picks** motors from published thrust curves; it does not design them. That is a different program with a different physics core, and ZenRockets is a long way ahead on it. |
| **Static-fire data**: import a test-stand thrust trace and overlay it on a simulated curve, or fly the measured one | Not available. We import `.eng` and `.rse` thrust curves and let you pick among a motor's published curves, but there is no measured-versus-predicted overlay. |
| **Flight-log import**: read a flight computer's CSV as a recorded flight, with Kalman-filter trajectory reconstruction and automatic event detection | Not available, and the single biggest gap. It is [on the roadmap as a "maybe"](https://github.com/thzero/AstraRocketJs/blob/master/TODO.md) for a specific reason: there is no standard altimeter CSV. Every vendor writes its own columns, units and headers, so the only version worth building is a generic reader plus a saved column-mapping profile per altimeter. The back half already exists here: the charts, the 3D trajectory and the ground track already draw several flights at once. |
| **Comparing up to five flights with tenth-of-a-second time alignment** | Partly. Several simulations already overlay on the charts, the ground track and the 3D view, one color per series. What is missing is the **per-flight time offset**: a recorded log starts when the altimeter woke up, so without one the overlay is unreadable. It arrives with log import, not before. |
| **Linked dimensions**: a field can reference another part's dimension rather than being typed, so a coupler's outside diameter follows the tube's inside diameter | Partly. A field cannot reference any other part's field, but a part on **Auto** follows its tube as in desktop OpenRocket: rings, bulkheads, couplers and engine blocks fit the bore where they sit, a body tube follows the tube next to it, and a tube fin set resizes with its body tube. Only a size you typed stays put, and so does a launch lug, which has no automatic size. `.ork` stores the automatic setting, which desktop reads too; it has nowhere to store any other link. |
| **Section cutaway view**: a cut through the 3D model so the internals show (motor mount, rings, bulkheads, couplers, the chute bay) | Yes. The **Cutaway** button on the 3D view opens the airframe along the centerline, so the motor mount, rings, bulkheads and couplers inside it show. |
| **An event timeline you can read down**, each event carrying the state at that instant (rail departure with velocity, stability, angle of attack and thrust-to-weight; per-motor burnout; separations; deployments with the velocity they fired at; touchdown velocity) | Yes. The **Flight events** table beside the charts gives every event its time, altitude and speed, with the numbers each moment is read for on the rows that have them: static margin, thrust-to-weight and angle of attack at rail departure, Mach at burnout. A deployment names the parachute that fired, so a dual-deploy drogue is told from the main, and a clustered stage gets one row per motor. Every stage is in the one table, interleaved on the single launch clock. It exports to CSV, where each of those extras becomes its own column. |
| **Max-Q** | Yes, as a summary tile and a row in the events table. The engine does not record dynamic pressure, but it records both halves of it, so q = ½ρv² is derived in the app from the air density and speed of sound every run already carries. The speed used is the **airspeed**, not the speed over the ground: the two differ on a windy launch, and q is a property of the air the rocket is flying through. |
| **Resolved atmosphere profiles**: what the simulation actually flew, as wind, pressure and temperature against altitude, plus the conditions at the pad | Yes. After a simulation, the **Environment** view shows the air the flight met: the conditions at launch, and wind speed, wind direction, temperature and pressure against altitude for the way up and the way down. See [Views & Analysis](./views-and-analysis.md#environment-after-a-simulation). |
| **Live weather forecasts from multiple models, and real launch sites with elevation lookup** | Mostly. **Get weather…** fills a simulation's launch conditions from an [Open-Meteo](./running-a-simulation.md#weather) forecast for a chosen date and hour: temperature, pressure, humidity, a wind profile and the atmosphere aloft, and offers Open-Meteo's terrain elevation when it differs from the site's. It uses Open-Meteo's own blend of models for the location rather than letting you compare models side by side. Saved locations with satellite imagery and click-to-set coordinates cover the launch sites. |
| **Map imagery under the trajectory** | Yes, on request. The ground track can be drawn over satellite or street imagery of the launch site, and the 3D path's ground plane takes the same imagery under the trajectory. Both start bare and fetch nothing until you ask for the ground. |
| **Mass rollup and stage isolation in the parts tree**: a toggle flipping each row between its own mass and its whole subtree's, and recomputing mass, CG, CP and stability for one stage alone | Not available. Stage isolation is how you check whether a spent booster is stable on its own way down, which matters on any multi-stage design. Both are read-only views over data the app already has. |
| **Share links, cloning and dashboards** | Not available, by design. There is no account and no server to host a link. Designs are kept in your browser, so sharing one means exporting and sending the `.ork`. |
| **Pricing plan** | Free. The source is open under the GPL 3.0 license. |

## What this has, and ZenRockets does not

Read against their documentation on the date above.

| Feature | Notes |
| --- | --- |
| **OpenRocket's own engine** | Not a model built on the same ideas: the actual code, compiled for the browser and checked against the same code running on a JVM. If matching desktop OpenRocket is the point, that is the difference. |
| **Writing `.ork` and `.rkt`, not just reading them** | Their import wizard reads OpenRocket and RockSim designs; their documented export is 3MF for printing. Here both formats round-trip **out** as well as in, at full fidelity. See [Files & Exports](./files-and-exports.md). |
| **Tube fins and nested pods on RockSim import** | Their import documentation lists those as skipped. Both import here and simulate. |
| **Working fully offline, with nothing uploaded** | The app, the engine and both catalogs are kept on your device after the first visit, and there is no account. |
| **Component Analysis** | Per-component drag split into pressure, base and friction, each part's stability contribution and its own CP, and every fin set's roll forcing and damping, over a Mach sweep at a chosen angle of attack, wind direction and roll rate, with a **Worst** setting that finds the wind angle where the CP sits furthest forward. |
| **Everything you can get out of it** | A full design report as PDF with 1:1 fin, nose and transition templates; DXF cut sheets; per-part STL, OBJ, GLB and 3MF plus whole-rocket 3MF; RASAero II `.CDX1`; flight data and drag tables as CSV; the flight path as KML, GPX or waypoint CSV with custom templates; the schematic as SVG, PNG or JPG. Their documented export is 3MF. |
| **NAR / Tripoli limits, enforced** | A run with the rail or rod past 30 degrees from vertical for a model rocket or 20 degrees for a high power rocket, or with surface wind above 20 mph is refused rather than flown. Their pre-flight validation produces errors, warnings and alerts; it is not the same thing as declining to fly. |
| **Multilingual** | |
| **Free** | |

## What to use which for

If you want to design the motor as well as the rocket, or to bring your altimeter's log in beside the prediction, ZenRockets does things this app does not do at all. If you want OpenRocket's numbers specifically, files that come out in the format they went in as, or an app that works with the network off, use this one.

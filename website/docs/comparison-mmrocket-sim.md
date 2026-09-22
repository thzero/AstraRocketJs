---
title: "Compared with mmrocket-sim"
sidebar_position: 20
---

import AppVersion from '@site/src/components/AppVersion';
import UpstreamPin from '@site/src/components/UpstreamPin';
import MmrocketPin from '@site/src/components/MmrocketPin';

:::info Snapshot, and how to read it

Written **2026-09-22**, comparing **AstraRocketJs <AppVersion />** (engine built from OpenRocket <UpstreamPin />) against **[mmrocket-sim](https://github.com/mtnmanak/mmrocket-sim)** at <MmrocketPin />, the release recorded in `engine-java/extract/MMROCKET-SIM` as the last one reviewed here.

:::

## This is not an arm's-length comparison

mmrocket-sim, by Mountain Man Rockets, is the closest relative AstraRocketJs has. Both are browser apps that run the real OpenRocket kernel, compiled out of Java with TeaVM, with no install and offline support. They arrived at that shape independently, and they overlap far more than either overlaps with a desktop program.

mmrocket-sim's subject is **RASAero-style supersonic aerodynamics**: the corrections OpenRocket's Extended Barrowman model needs above roughly Mach 1.5, calibrated against published wind-tunnel and free-flight data. That is what the project works on, and this app carries the result of it under GPL-3.0 with attribution:

- the supersonic aerodynamics model (`supersonicAero`), which is the large one: it corrects body CP and CNα above roughly Mach 1.5, where stock Extended Barrowman freezes them at their Mach-1 values, and repairs a supersonic fin normal-force slope that otherwise comes out about half of linear theory;
- the Rogers modified-Barrowman body-fin carryover (`rogersKbf`);
- the stubby-nose subsonic pressure-drag floor (`stubbyNoseFloor`);
- the power-on base-drag term driven by nozzle exit diameter;
- the RASAero fin cross-sections (`airfoilSection`);
- the wind-tunnel validation harness the extensions are scored against;
- and outside the engine, the **fairing** component and its `.ork` extension element.

## What can be compared

| | AstraRocketJs | mmrocket-sim |
| --- | --- | --- |
| **Shape** | Browser app, installable, works offline | Browser app, installable, works offline (per their README) |
| **Engine** | OpenRocket core compiled with TeaVM | OpenRocket core compiled with TeaVM |
| **OpenRocket pin** | <UpstreamPin />, a post-24.12 development build | OpenRocket 24.12, per their README |
| **Compile target** | **WebAssembly (WASM-GC)** with a JavaScript fallback; a badge in the header says which loaded | JavaScript, per their README |
| **Flight integrator** | RK4 | RK4 with adaptive time stepping, per their README |
| **Supersonic extensions** | Not available. | Their own work |
| **Languages** | Multilingual | Not stated |

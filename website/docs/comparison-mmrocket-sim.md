---
title: "Compared with mmrocket-sim"
sidebar_position: 20
---

import AppVersion from '@site/src/components/AppVersion';
import UpstreamPin from '@site/src/components/UpstreamPin';

:::info Snapshot, and how to read it

Written **2026-09-22**, comparing **AstraRocketJs <AppVersion />** (engine built from OpenRocket <UpstreamPin />) against **[mmrocket-sim](https://github.com/mtnmanak/mmrocket-sim)** at v0.137 (2026-09-21), the release reviewed here when this page was written. `engine-java/extract/MMROCKET-SIM` records that review and the ones after it.

This page is deliberately shorter than the other two: mmrocket-sim’s public documentation covers its build and its layout, not its interface, and a feature table assembled by guessing at somebody else’s app is worse than no table.

:::

## This is not an arm's-length comparison

mmrocket-sim, by Mountain Man Rockets, is the closest relative AstraRocketJs has. Both are browser apps that run the real OpenRocket kernel, compiled out of Java with TeaVM, with no install and offline support. They arrived at that shape independently, and they overlap far more than either overlaps with a desktop program.

mmrocket-sim's subject is **RASAero-style supersonic aerodynamics**: the corrections OpenRocket's Extended Barrowman model needs above roughly Mach 1.5, calibrated against published wind-tunnel and free-flight data.

## What can be compared

| | AstraRocketJs | mmrocket-sim |
| --- | --- | --- |
| **Shape** | Browser app, installable, works offline | Browser app, installable, works offline (per their README) |
| **Engine** | OpenRocket core compiled with TeaVM | OpenRocket core compiled with TeaVM |
| **OpenRocket pin** | The **unstable** branch | OpenRocket 24.12, per their README |
| **Compile target** | **WebAssembly (WASM-GC)** with a JavaScript fallback; a badge in the header says which loaded | JavaScript, per their README |
| **Flight integrator** | The pinned build carries `RK4SimulationStepper` and `RK6SimulationStepper`, both listed in the extraction manifest | RK4 with adaptive time stepping, per their README |
| **Languages** | Multilingual | Not stated |

The pin is the difference with practical consequences: a newer core is a different set of fixes from the upstream project, and two apps built on different OpenRocket commits can legitimately disagree about a number without either being broken.

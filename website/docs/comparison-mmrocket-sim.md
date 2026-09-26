---
title: "Compared with mmrocket-sim"
sidebar_position: 20
---

import AppVersion from '@site/src/components/AppVersion';
import UpstreamPin from '@site/src/components/UpstreamPin';
import MmrocketPin from '@site/src/components/MmrocketPin';

:::info Snapshot, and how to read it

Written **2026-09-22**, comparing **AstraRocketJs <AppVersion />** (engine built from OpenRocket <UpstreamPin />) against **[mmrocket-sim](https://github.com/mtnmanak/mmrocket-sim)** at <MmrocketPin />, the release recorded in `engine-java/extract/MMROCKET-SIM` as the last one reviewed here.

This page is deliberately shorter than the other two, and the section on [what it does not compare](#what-this-page-does-not-tabulate) says why. In short: mmrocket-sim’s public documentation covers its build and its layout, not its interface, and a feature table assembled by guessing at somebody else’s app is worse than no table.

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
| **Flight integrator** | The pinned build carries `RK4SimulationStepper` and `RK6SimulationStepper`, both listed in the extraction manifest | RK4 with adaptive time stepping, per their README |
| **Supersonic extensions** | Carried from mmrocket-sim, off by default, opt-in per simulation | Their own work, developed there |
| **Languages** | Multilingual | Not stated |

The pin is the difference with practical consequences: a newer core is a different set of fixes from the upstream project, and two apps built on different OpenRocket commits can legitimately disagree about a number without either being broken.

## What this page does not tabulate

There is no "they have it and we do not" table here, and the reason matters more than the gap it leaves.

In the OpenRocket and ZenRockets comparisons the other side publishes a feature reference, so a row can be cited and checked. mmrocket-sim's README documents its repository layout, its build and its engine invariants; it does not enumerate its interface. Writing rows from a running app nobody here has sat down and audited would produce exactly the kind of confident, uncheckable claim this appendix exists to avoid, and it would be a claim about a project whose work we are already carrying.

So go and use it. It is at **[mmrsim.mountainmanrockets.com](https://mmrsim.mountainmanrockets.com)**, and the code is [on GitHub](https://github.com/mtnmanak/mmrocket-sim). If you know both well enough to fill this section in, [your correction is welcome](./contributing.md).

## How the relationship is kept current

`engine-java/extract/MMROCKET-SIM` records the commit their extensions were last reviewed against, so "what have they changed since we last looked?" is a question with a computable answer rather than one that depends on an old copy still sitting on somebody's disk. Reviewing means fetching their repository, diffing that commit against their current head, reading only what reaches the shared Java, and then writing down what was taken and what was passed over.

The <MmrocketPin /> review is a fair sample of the usual traffic: sixteen commits, five shared Java files touched, and every edit comment-only. One correction was taken (their fix to a note that described a rearward CP shift as a more conservative static margin, when moving the CP aft *increases* the margin shown). Two changes were passed over as not applicable here, each with its reason written down. Worth saying plainly: today this is a one-way channel. Extensions flow from them to here, and nothing flows back automatically.

The same file is careful about what it is not. It gates nothing, no tool clones from it, and `extract --check` neither knows nor cares about it. The only commit that gates anything here is the OpenRocket one, in the [Overview](./overview.md).

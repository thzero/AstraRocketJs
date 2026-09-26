---
title: "Motors"
sidebar_position: 9
---
A motor is assigned to a rocket's **motor mount** (inner tube). The right-hand Simulations panel shows the current motor for the selected simulation and a **Change…** button to pick a different one.

## The motor picker

The picker searches a bundled catalog of **~800 real motors** from [thrustcurve.org](https://www.thrustcurve.org) — filter by manufacturer, diameter, impulse class, and designation. Selecting a motor shows its dimensions and total impulse.

- The **catalog** (specs for every motor) ships with the app — no lookup needed to browse.
- The **thrust curve** comes bundled with the catalog for 781 of the 815 motors, so picking one resolves instantly and works offline. The 34 motors with no published curve are marked in the picker; their curve is fetched from thrustcurve.org on first pick and then cached (revalidating occasionally, and falling back to the cached copy if a fetch fails).

## Ejection delay

Where a motor offers multiple ejection delays, pick the one you're flying (or a **plugged** option for motors used without an ejection charge). The delay feeds the recovery-deployment timing in the simulation.

## Importing your own motors

### `.eng` files (RASP)
Import a standard **`.eng`** thrust-curve file — it carries its own curve, so no lookup is needed. Imported motors appear in the picker (flagged, and deletable) and are saved in your browser.

### `.rse` files (RockSim)
The same button takes **`.rse`**, which is the format to use for a **hybrid**: RASP has no way to record what a motor IS, so an `.eng` import is a motor of unknown type, while a `.rse` import reads as a hybrid (or reloadable, or single-use) in the motor detail panel. It is also the only one that can say a motor is sold **plugged**, which is what the picker's plugged filter looks for.

It is the richer format in one more way that changes what you fly. `.eng` gives a single propellant weight and leaves the mass curve to be reconstructed from the thrust curve; `.rse` records the mass at every sample, and the simulation uses those measured figures directly when the file supplies them. It carries the motor's real launch CG too, instead of the mid-length approximation a RASP file forces. A file that asks for its mass or CG to be recalculated (`auto-calc-mass`, `auto-calc-cg`) gets the same reconstruction as `.eng`, which is what OpenRocket does with it.

A `.rse` can hold one motor or a manufacturer's whole range; every motor in the file is imported, and the picker says how many landed. The format is detected from the file's contents rather than its name, so a `.rse` saved as `.eng` still reads correctly.

### Custom motors
Custom/imported motors persist locally alongside your custom materials, so they're available across your designs on that browser.

## Multiple mounts

A design can have more than one motor mount (e.g. clustered or staged). The **primary** mount (the first, nose-to-tail) takes the motor shown at the top of the Simulations panel; every additional mount gets its own card below it. Additional mounts keep the motors they were imported/opened with, and a newly added mount starts with a **default motor** so the design is always ready to fly — just hit **Change…** on its card to pick the real one. Remove a mount and its motor is dropped automatically. See [Running a Simulation](./running-a-simulation.md) for staging and ignition.

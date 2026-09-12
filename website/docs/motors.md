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

### Custom motors
Custom/imported motors persist locally alongside your custom materials, so they're available across your designs on that browser.

## Multiple mounts

A design can have more than one motor mount (e.g. clustered or staged). The **primary** mount (the first, nose-to-tail) takes the motor shown at the top of the Simulations panel; every additional mount gets its own card below it. Additional mounts keep the motors they were imported/opened with, and a newly added mount starts with a **default motor** so the design is always ready to fly — just hit **Change…** on its card to pick the real one. Remove a mount and its motor is dropped automatically. See [Running a Simulation](./running-a-simulation.md) for staging and ignition.

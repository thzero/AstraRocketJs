# Motors

A motor is assigned to a rocket's **motor mount** (inner tube). The right-hand Simulations panel shows the current motor for the selected simulation and a **Change…** button to pick a different one.

## The motor picker

The picker searches a bundled catalog of **~800 real motors** from [thrustcurve.org](https://www.thrustcurve.org) — filter by manufacturer, diameter, impulse class, and designation. Selecting a motor shows its dimensions and total impulse.

- The **catalog** (specs for every motor) ships with the app — no lookup needed to browse.
- The **thrust curve** for a chosen motor is fetched on demand the first time you pick it and then cached in your browser (so it works offline afterward, and revalidates occasionally). If a fetch fails, the last cached curve is used.

## Ejection delay

Where a motor offers multiple ejection delays, pick the one you're flying (or a **plugged** option for motors used without an ejection charge). The delay feeds the recovery-deployment timing in the simulation.

## Importing your own motors

### `.eng` files (RASP)
Import a standard **`.eng`** thrust-curve file — it carries its own curve, so no lookup is needed. Imported motors appear in the picker (flagged, and deletable) and are saved in your browser.

### Custom motors
Custom/imported motors persist locally alongside your custom materials, so they're available across your designs on that browser.

## Multiple mounts

A design can have more than one motor mount (e.g. clustered or staged). The **primary** mount takes the motor shown in the Simulations panel; additional mounts keep the motors they were imported/opened with. See [Running a Simulation](Running-a-Simulation) for staging and ignition.

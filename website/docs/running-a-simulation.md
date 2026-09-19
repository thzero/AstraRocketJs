---
title: "Running a Simulation"
sidebar_position: 11
---
Simulations live in the right-hand panel. You can keep **several named simulations** for one design (e.g. different motors or launch sites), **duplicate** one as a starting point, and delete them. The red **Delete simulation** button (next to the current simulation's name) removes it after a confirmation; the workspace always keeps at least one, so it's disabled when only one remains.

## Set up the launch

Each simulation has its own launch configuration, grouped into cards:

- **Launch rod / rail** — length, angle from vertical, and direction (or "launch into the wind").
- **Launch site** — altitude, latitude, and longitude.
- **Atmosphere** — ISA standard, or override temperature and pressure.
- **Wind** — average speed, gusts (standard deviation), and direction; or a **multi-level** wind profile that varies with altitude.
- **Earth model** — flat, spherical, or WGS84 (affects long/high flights).

New simulations start from your global [Settings](./settings.md) defaults.

## Run it

Press **Run flight simulation**. The flight runs in a background **Web Worker**, so the interface stays responsive — a spinner shows while it computes (typically well under a second). When it finishes, the **Flight** and **3D path** views unlock and the results appear.

### When a run is refused

AstraRocketJs would rather give you no number than a plausible-looking wrong one, so a flight that cannot be computed honestly is not flown. The Run button says why, naming the part, field or simulation at fault.

Two kinds of problem, which behave differently:

**Faults in the design** stop everything, because every simulation shares one rocket:

- **No motor mount** — nowhere to seat a motor. Add one (see [Designing a Rocket](./designing-a-rocket.md#motor-mount)).
- **A required dimension is zero** — the part is named, along with which of its dimensions. See [Required dimensions](./designing-a-rocket.md#required-dimensions).

**Faults in one simulation** only skip that row. Select six and run them: the good ones fly, and the button tells you which are being left out and why.

- **No usable motor** — nothing loaded on the primary mount, or an imported `.ork` whose motor could not be matched to a thrust curve.
- **A required launch field is blank** — rod length, rod angle, wind speed, wind standard deviation, site altitude or latitude. These have no sensible default, so a blank one is named rather than guessed at.
- **Launch conditions outside the safety codes** — rod more than 20° from vertical, or surface wind above 20 mph. See [Safety limits](#safety-limits) below.

The button only goes dead when *nothing* selected can fly. Otherwise it stays live, counts the rows that will actually run, and names the ones it is skipping — one bad row never costs you the other eleven.

### Safety limits

Launch conditions are checked against the **NAR** and **Tripoli** safety codes, which is why two fields refuse to go past them:

- **Launch rod angle** — within **20°** of vertical.
- **Wind speed** — at or below **20 mph** (32 km/h).

Both codes state these in imperial, so the metric figures the app shows are exact conversions rather than round numbers. The fields clamp as you type, and a `.ork` file that arrives outside them is listed in the import banner rather than quietly flown.

Only the wind **at the pad** is judged. On a multi-level profile that is the ground layer; winds aloft are not something a launch is called on, because they are not something anyone at the field measures. Gust standard deviation is deliberately not checked either — the codes speak about wind speed, and a mean inside the limit with gusts above it is a judgment call the app is not equipped to make.

These are flying limits, not modeling limits. They are about whether the launch should happen, so unlike your rocket's geometry they are not preserved as authored: a file's out-of-limits conditions are flagged, and the run is refused until they are brought inside.



## Read the results

Running opens the **Results** tab on the flight you just ran — one simulation or a batch, since running is asking to see the answer.

Results are shown as tiles, in roughly chronological flight order, including:

- **Rail-exit velocity** (flagged if below your safety minimum)
- **Optimum delay** and **time to apogee**
- **Apogee** (max altitude) and **max velocity / acceleration / Mach**
- **Deployment speed** (flagged if above your warning threshold; green when safely low). On a [dual-deployment](./designing-a-rocket.md#dual-deployment) design the flight engine judges the main and the drogue against their own thresholds instead, and reports a warning for each.
- **Landing speed**, **flight time**, and **downrange** distance

For the full time-history, open the **[Flight and 3D-path views](./views-and-analysis.md)**. To save the numbers, see **[Files & Exports](./files-and-exports.md)**.

## Editing invalidates results

Changing the design clears each simulation's cached result (the physics no longer matches) — just press **Run** again. The same applies to **undo/redo**: it restores your design and simulation *inputs*, but not cached flight results, so re-run to see the flight.

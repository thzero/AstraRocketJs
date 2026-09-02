# Running a Simulation

Simulations live in the right-hand panel. You can keep **several named simulations** for one design (e.g. different motors or launch sites), **duplicate** one as a starting point, and delete them.

## Set up the launch

Each simulation has its own launch configuration, grouped into cards:

- **Launch rod / rail** — length, angle from vertical, and direction (or "launch into the wind").
- **Launch site** — altitude, latitude, and longitude.
- **Atmosphere** — ISA standard, or override temperature and pressure.
- **Wind** — average speed, gusts (standard deviation), and direction; or a **multi-level** wind profile that varies with altitude.
- **Earth model** — flat, spherical, or WGS84 (affects long/high flights).

New simulations start from your global [Settings](Settings) defaults.

## Run it

Press **Run flight simulation**. The flight runs in a background **Web Worker**, so the interface stays responsive — a spinner shows while it computes (typically well under a second). When it finishes, the **Flight** and **3D path** views unlock and the results appear.

If the design can't fly — **no motor mount** or **no motor loaded** — the Run button is disabled and shows why, so add a motor mount (see [Designing a Rocket](Designing-a-Rocket)) or pick a motor first.

## Read the results

Results are shown as tiles, in roughly chronological flight order, including:

- **Rail-exit velocity** (flagged if below your safety minimum)
- **Optimum delay** and **time to apogee**
- **Apogee** (max altitude) and **max velocity / acceleration / Mach**
- **Deployment speed** (flagged if above your warning threshold; green when safely low)
- **Landing speed**, **flight time**, and **downrange** distance

For the full time-history, open the **[Flight and 3D-path views](Views-and-Analysis)**. To save the numbers, see **[Files & Exports](Files-and-Exports)**.

## Editing invalidates results

Changing the design clears each simulation's cached result (the physics no longer matches) — just press **Run** again. The same applies to **undo/redo**: it restores your design and simulation *inputs*, but not cached flight results, so re-run to see the flight.

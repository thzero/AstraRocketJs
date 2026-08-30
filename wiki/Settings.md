# Settings

Open **Settings** from the app menu (top-right ☰). Settings are **global** — they apply to every design and simulation, and are remembered in your browser.

## Units

AstraRocketJs currently uses **metric / SI units only** — lengths in mm/cm/m, masses in g/kg, and so on. An imperial / unit-preference option isn't available yet.

## Simulation defaults

These seed each new simulation's run (you can still tune per-simulation launch conditions — see [Running a Simulation](Running-a-Simulation)):

- **Time step** — the integrator step size. Smaller is more accurate but slower.
- **Max time** — a safety cap on simulated flight time.
- **Random seed** — fixes the wind/turbulence randomness so a run is reproducible; leave it unset for varied runs.
- **Calculation method** — the aerodynamic model (classic Extended Barrowman, and the opt-in supersonic/RASAero-style corrections).

## Safety warnings

Thresholds that color-code the simulation result tiles so problems stand out:

- **Rail-exit velocity minimum** — the rod/rail departure speed below which the rocket may not be going fast enough to fly straight; results under it are flagged.
- **Deployment-speed warning** — if recovery deploys above this speed the tile is flagged (fast deployment can damage a chute); a safely low deploy speed shows green.

## Reset

**Reset all** returns every setting to its default.

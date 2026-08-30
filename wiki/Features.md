# Features

## Physics
- Runs OpenRocket's **real physics core** — Extended Barrowman (+ RASAero-style supersonic) aerodynamics, mass/CG, and RK4/RK6 flight — compiled to **WebAssembly** (JavaScript fallback), validated bit-identical to upstream OpenRocket.
- Flight simulations run in a **Web Worker**, off the main thread, so the interface stays responsive during a run.

## Design & analysis
- **Component-tree editor** with live **CG / CP / stability** as you edit — calibers, % of length, **on-pad and rail-exit** margins, and fineness ratio.
- **2D schematic** with drag-to-measure **calipers**, length + cross-section rulers, zoom/pan, roll (spin), and an aft (head-on) view.
- **3D model** view, and a **3D flight path** after a simulation.
- **Aerodynamics view**: Cd vs Mach, drag breakdown (friction / pressure / base), CP vs Mach.
- **Flight charts**: altitude, velocity, acceleration, Mach, thrust, mass, drag, and stability over time.

## Data & I/O
- **Full `.ork` support** — open and save round-trip at full fidelity (files re-open in desktop OpenRocket).
- Real motor **thrust curves** from [thrustcurve.org](https://www.thrustcurve.org) (~800 motors), plus **`.eng` import** and custom motors.
- OpenRocket **materials** (built-in + your own) and a **component-preset** catalog (~2,900 real Estes / Apogee / LOC / … parts).
- **Exports**: flight data & drag tables to **CSV**, and the 2D schematic to **SVG / PNG / JPG**.
- Multiple named **simulations**, each with a full launch setup (rod, site, atmosphere, multi-level wind, earth model).

## Platform
- **Client-only** — no server, no accounts, nothing uploaded. A working copy of your design persists in the browser (so a refresh won't lose it); the design itself is a `.ork` file on your disk.
- **Responsive** — a three-pane desktop workbench that collapses to a tabbed single column on phones.
- Available in **English and Spanish**.

## Not (yet) supported
- **Metric/SI units only** — no imperial / unit-preference option yet.
- No offline install (PWA) and a single (dark) theme.

See the [FAQ](FAQ) for more on the current limits.

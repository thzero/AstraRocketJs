---
title: "Safety"
sidebar_position: 13
---
AstraRocketJs is a design and simulation tool. It is not a safety authority, and a simulation is not a flight card. This page says plainly what the numbers are worth, what the model does not know, and what to check before you fly.

## What a simulation result is

Every figure the app produces is **educational and speculative**. It answers "what would this model do under these assumptions". It is not a prediction, not a safety assessment, and not a flight-worthiness certification.

Treat apogee, stability margin, deployment speed, descent rate and landing distance as estimates to design *against*, then verify them against the rocket you actually built and the field you are actually standing on. A margin computed from a drawing is a drawing's margin.

## What the model does

The physics is OpenRocket's own core, compiled to run in your browser and validated bit-identical against the desktop program. It computes:

- **Aerodynamics** by the Extended Barrowman method (with supersonic extensions), giving CP, drag and stability.
- **Mass and CG** from each part's geometry times its material density, plus any [overrides](#before-you-fly) you enter.
- **Flight** as rigid-body motion integrated with RK4/RK6, driven by the real thrust curve of the motor you picked.
- **Atmosphere** as the ISA standard model, or your own temperature and pressure, with a WGS or constant gravity model and a flat, spherical or WGS84 earth.
- **Wind** as either a single average with a gust standard deviation, or a multi-level profile that changes with altitude, both carrying pink-noise turbulence.

The app also raises the kernel's own flight warnings: high-speed deployment, a main that opens too fast or too slow, a drogue with no main, no recovery device at all, a deployment while still on the rod, a large angle of attack, and supersonic flight where the aerodynamic method becomes approximate. Read them. They are the model telling you it is uncomfortable.

## What the model does not know

Being explicit about the gaps is more useful than a blanket disclaimer:

- **Fin flutter.** There is no aeroelastic model anywhere in the engine. A fin can be perfectly stable in simulation and shed itself at Mach 0.8 in reality. Fin stiffness, attachment and flutter margin are entirely your call.
- **Structural strength.** The rocket is a rigid body. Nothing checks whether the airframe survives max-Q, a hard deployment, or a zipper.
- **Parachute inflation.** A recovery device's drag switches on at its deployment event, after the delay you set. The canopy's inflation transient and the opening shock load are not computed. The app warns you about a fast deployment instead of telling you what it does to the tube.
- **Motor variation.** The thrust curve is one certification curve, not your motor on the day. Lot-to-lot spread, propellant temperature, age and storage all move the real number.
- **The difference between the model and what you built.** Glue fillets, paint, a heavier nose cone than the material table assumes, a fin set two degrees out of true, a chute packed tighter than the bay allows. The simulation flies the drawing.
- **The ground.** No terrain, no obstacles, no trees, no thermals, no ground effect, and no launcher friction or a rocket that hangs on the rod.

## Before you fly

The single most valuable thing you can do is stop simulating a drawing and start simulating the rocket on the bench:

1. **Weigh the finished rocket**, ready to fly but without the motor. Select its stage in the component editor (on a single-stage rocket that is the whole thing), enable the **mass override**, and enter the measured figure with "apply to all subcomponents" on.
2. **Find the balance point.** Balance the rocket on a ruler edge, measure from the nose tip, and enter it as the **CG override**.
3. **Re-read the stability margin** with those numbers in place. This is the margin that matters. If it moved, your model was wrong about something, and it is worth finding out what.
4. **Check the rail exit velocity** in the flight results. A rocket that leaves the rail slowly weathercocks into the wind, and the simulation is at its least trustworthy there.
5. **Check the descent rate and the landing speed**, and the ground track for how far downwind it puts you. Then look at the actual size of the field.
6. **Re-run after any change**, including a motor swap. Results are only about the design and conditions they were run with.

The override section carries mass, CG and drag coefficient, each with an "apply to all subcomponents" toggle, matching OpenRocket's semantics. See [Designing a Rocket](./designing-a-rocket.md).

## The limits the app enforces

Two launch conditions are checked against the **NAR** and **Tripoli** safety codes, and the app refuses to fly a simulation outside them rather than hand you a number it will not stand behind:

- **Launch rod angle** within **20 degrees** of vertical.
- **Surface wind** at or below **20 mph** (32 km/h).

Only the wind at the pad is judged, and gusts are deliberately not checked. The reasoning, and what happens to a `.ork` file that arrives outside the limits, is in [Running a Simulation](./running-a-simulation.md#safety-limits).

These are the only two rules the app enforces. They are not a substitute for the codes, which cover far more than the app can see: minimum field dimensions, recovery systems, motor certification, ignition, spectator distances and much else.

## Your responsibilities

The app knows nothing about where you are or what you are allowed to do there. You are responsible for:

- Knowing and following the **safety code** you fly under. In the US that is the [NAR safety codes](https://www.nar.org/safety-codes/) (model and high power) or the [Tripoli Unified Safety Code](https://www.tripoli.org/safetycode). Elsewhere, your national body's equivalent.
- **Airspace rules and waivers** for the altitude you intend to reach. An apogee figure from this app is not a waiver.
- **Motor purchase, certification, transport and storage law** where you live, and holding the certification level the motor requires.
- **Permission to launch** on the land you are using.
- The **range rules** and the **Range Safety Officer**. The RSO's call outranks anything on your screen.

## Experimental and research motors

The app models motors from published thrust curves, and can import a curve you measured yourself. It is not a guide to designing, manufacturing, or firing a motor, and nothing in it evaluates whether a motor is safe to build or light. Experimental motor work is hazardous and, in most places, tightly regulated. It belongs with a research organization and the people qualified to supervise it.

## If a number looks wrong

If the app disagrees with desktop OpenRocket, or with a flight you actually flew, that is worth reporting: differences against the desktop program are treated as bugs, because the engine is meant to match it. See [Contributing](./contributing.md).

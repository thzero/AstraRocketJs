# Overview

## What is AstraRocketJs?

**AstraRocketJs** is a browser-based app for designing model rockets and simulating their flights. It's a lightweight, mobile-friendly interface built on top of the **real OpenRocket physics engine** — the same trusted simulation core used by the OpenRocket desktop program, compiled to run directly in your web browser.

There are two things you do with it:

- **Design** — build a rocket from components (nose cone, body tubes, fins, motor mount, recovery, …) and watch its **center of gravity, center of pressure, and stability** update live as you edit.
- **Simulate** — pick a motor, set your launch conditions, and run a full flight simulation. See apogee, max velocity/acceleration, and the whole flight profile as charts and a 3D trajectory.

Everything runs **on your device**. There's no server, no account, and nothing is uploaded — your `.ork` designs are files on your own disk.

## How it relates to OpenRocket

AstraRocketJs is **not** a re-creation of OpenRocket's desktop app. It's a streamlined web interface over the **same physics core**:

- The aerodynamics (Extended Barrowman), mass/CG, and flight integration (RK4/RK6) are OpenRocket's own code, compiled to WebAssembly (with a JavaScript fallback).
- It opens and saves standard **`.ork`** files, so designs move both ways between AstraRocketJs and desktop OpenRocket.
- It deliberately covers **the essentials** — live stability, 2D/3D views, motors, materials, parts, and flight simulation — rather than every desktop feature.

For the underlying physics models, the [OpenRocket documentation](https://openrocket.readthedocs.io) is the reference. AstraRocketJs is an independent project and is not affiliated with OpenRocket.

## How this wiki is organized

- **Introduction** — this page, [Features](Features), and the [FAQ](FAQ).
- **Getting Started** — [open the app and make your first rocket](Getting-Started), and the [Settings](Settings).
- **User Guide** — designing, motors, the views, simulating, and files/exports.
- **Developing** — the [Developer Guide](Developer-Guide) for building and contributing.

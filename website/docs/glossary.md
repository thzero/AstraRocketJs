---
title: 'Glossary'
sidebar_position: 17
---

Every term the app puts on screen, and the symbols in its plots and downloads. Each entry gives a plain definition, then where you meet it (*In the app*). A bold word after **See** is another entry here.

Use the search box at the top of this site, or the search in the app's **Help** dialog, to jump to a term from anywhere.

## A

**Acceleration** — How quickly velocity is changing. *In the app:* the **Max accel** tile, the acceleration plot, and the `Az`, `Al`, `Ax`, `Ay`, `Abx`, `Aby` columns of a flight-data export. An onboard accelerometer reads about 1 G on the pad where this reads zero, because this is acceleration relative to the ground with gravity already accounted for.

**Aerodynamic length** — The nose-to-tail span of the rocket's *external* parts. *In the app:* it is the denominator behind stability shown as a percentage of length, and behind the **% length** reading of CP vs Mach and the **CP (% length)** column of the stability table. It differs from the **Length** tile whenever an internal part, such as a motor tube, reaches past the airframe.

**Aft / fore** — Toward the tail / toward the nose, whichever way the rocket points. *In the app:* field labels such as **Fore radius**, **Aft shoulder** and **Motor overhang**. Moving the CP aft raises the stability margin; moving the CG aft lowers it.

**Aft view** — The rocket seen end-on from behind, so a fin count, a clock angle or a motor cluster shows as it really sits. *In the app:* the **Aft** button beside **2D** and **3D**.

**Air density** — The mass of air per cubic meter. It falls as air warms or pressure drops, and it scales every aerodynamic force and every descent rate, so the same rocket flies differently at two sites. *In the app:* set by **Temperature** and **Pressure** in the launch conditions; the `ρ` column follows it through a flight. See **ISA**.

**Air pressure** — Pressure at the launch site, not at sea level. *In the app:* **Pressure** in the launch conditions; leave it blank for standard air at your site altitude.

**Airframe** — The rocket's external body: the tubes, nose and transitions air actually flows over, as opposed to what is inside them.

**Airspeed** — The rocket's speed through the air, which in wind is not its speed over the ground. *In the app:* the dynamic-pressure and Mach figures use airspeed; `Vz` and `Vl` are ground-relative.

**Airfoil** — A fin cross-section rounded at the leading edge and tapered at the trailing edge, cheaper in drag than a square edge. *In the app:* **Cross-section** on a fin set, alongside square and rounded. See **Cross-section**.

**Angle of attack (AoA, α)** — The angle between where the rocket points and where it is going. *In the app:* the `α` column, and the large-angle-of-attack warning, which fires when a flight leaves the range the aerodynamics are valid over.

**Apogee** — The highest point of a flight. *In the app:* the **Apogee** tile and the `APOGEE` flight event.

**Aspect ratio** — A fin's span against its chord: high is long and narrow, low is short and stubby. *In the app:* a derived field on a fin set.

**Axial / radial** — Along the rocket's axis / out from it. *In the app:* axial placement is **Position from** and **Offset**; radial placement is **Radial position** and **Radial direction**.

**Azimuth / zenith** — Compass heading / angle from straight up. *In the app:* the `Φ` and `Θ` columns; the rod's aim uses the same pair.

## B

**Ballast** — Mass added on purpose, usually in the nose, to move the CG forward and raise the stability margin. *In the app:* a **Mass component**.

**Ballistic descent** — Coming down with no recovery device deployed. *In the app:* a flight with no device, or one where deployment never fired, lands at a ballistic speed; the ground-hit velocity says how hard.

**Boattail** — A transition at the tail that narrows toward the rear, reducing base drag. *In the app:* a **Transition** whose aft radius is smaller than its fore radius.

**Body tube** — A straight tube of constant diameter: the main airframe section. *In the app:* **Body tube** in the component tree.

**Booster / sustainer** — In a staged rocket, the stage that lights first and drops away / the stage that carries on. *In the app:* stage names, and each booster's own flight branch after it separates. See **Simulation branch**.

**Bore** — The inside diameter of a tube. *In the app:* the **Bore** field, which is the pair of the outer diameter and the wall: typing a bore writes the wall back and leaves the outside where it is.

**Bulkhead** — A solid disc closing off a tube, used to take an ejection load or seal a bay.

**Burn time / burnout** — How long the motor produces thrust / the moment it stops. *In the app:* the `BURNOUT` flight event, and the motor's own burn time in the browser.

**Burnout mass** — The rocket's mass at burnout, with the propellant gone. See **Recovery weight**.

## C

**Caliber** — One body diameter, used as the unit for stability margin. Two calibers of margin means the CP sits two body diameters behind the CG. *In the app:* the stability readouts, which also offer a percentage of length.

**Canopy** — The fabric part of a parachute, as opposed to its lines. *In the app:* the parachute's **Diameter** is its canopy diameter.

**Cant angle** — A fin tilted about its own root, which spins the rocket up in flight. *In the app:* **Cant** on a fin set.

**Cd (drag coefficient)** — Drag expressed independently of size and speed, so shapes can be compared. *In the app:* the `Cd` column, the drag-coefficient tile, and each recovery device's own **Cd**.

**Cd override** — Replacing a part's computed drag coefficient with one you supply. *In the app:* the **Overrides** section. See **Override**.

**Centering ring** — A ring that holds an inner tube centered inside a larger tube.

**Center of gravity (CG)** — Where the rocket balances. *In the app:* the CG marker on the views, the CG tile, and the `cgLocation` series. It moves forward as propellant burns.

**Center of pressure (CP)** — Where the aerodynamic forces act. *In the app:* the CP marker, the CP tile, and the `cpLocation` series. It moves with angle of attack and Mach number. On the Aero view it can be read as a length or as a percentage of either the overall or the **Aerodynamic length**.

**Chord / root chord / tip chord** — A fin's width along the airflow / at the body / at its tip. *In the app:* fields on a trapezoidal fin set.

**Cluster** — More than one motor in one stage, firing together. *In the app:* a motor mount with an instance count above one.

**Coast** — The unpowered part of the climb, from burnout to apogee.

**Component** — One part of the rocket. The **component tree** is the nested list of them, and a part's **parent**, **children** and **subtree** are its position in that nesting. *In the app:* the tree down the left of the design workspace.

**Component preset** — A catalog entry for a real commercial part, so picking it fills in the dimensions and material. *In the app:* the component picker.

**Coriolis acceleration** — The apparent sideways acceleration of anything moving over a rotating Earth. Tiny for model flights; it exists in the data because the engine models it. *In the app:* the `Ac` column, and the **Geodetic** launch option that switches the model.

**Cross-section** — The shape of a fin seen edge-on: square, rounded or airfoil. It changes drag, and it changes mass. *In the app:* **Cross-section** on a fin set.

## D

**Delay** — A pause between one event and what it triggers. *In the app:* **Ejection delay** on a motor, **Ignition delay** on a stage, **Separation delay** between stages, and **Deploy delay** on a recovery device.

**Deployment** — A recovery device opening. Its **trigger** is what opens it: apogee, an altitude on the way down, a motor's ejection charge, or a stage event. *In the app:* the **Deployment** section, and the `RECOVERY_DEVICE_DEPLOYMENT` flight event, which names the device that opened.

**Deployment velocity (opening speed)** — How fast the rocket was moving when a device opened. Too fast risks a zippered tube or a torn canopy. *In the app:* the **Deploy speed** tile and the deployment-speed warnings. See **Zippering**.

**Descent rate** — How fast the rocket comes down under a device. *In the app:* the descent-sizing block, measured from the flight once one has flown. See **Terminal velocity**.

**Drag** — The force opposing motion through air. **Power-on** drag is drag while the motor runs, **power-off** after it stops; they differ because a burning motor fills the base of the rocket. *In the app:* the `Cd` family of columns and the drag analysis panel.

**Drift** — How far downwind the rocket lands from the pad. *In the app:* the ground track, the drift readout, and the **Drift sweep**.

**Drift ellipse** — The area repeated runs land in, drawn on the ground track, which is a more honest answer than a single point when wind is random.

**Drift sweep** — Flying the same design across a band of wind speeds to see how landing distance grows. *In the app:* the **Drift sweep** panel.

**Drogue** — A small chute deployed at apogee to bring the rocket down fast but stable, before the main opens lower. *In the app:* tick **Drogue** on the device that opens at apogee; without it the stage is judged as single deployment. See **Dual deployment**.

**Dry mass (empty mass)** — The rocket with no motor at all. *In the app:* the **Mass (empty)** tile.

**Dual deployment** — Two-stage recovery: a drogue at apogee, a main lower down, to cut drift without landing hard. *In the app:* mark one device as the drogue; the main is then judged against its own speed limits.

**Dynamic pressure (q, max Q)** — The pressure of the airflow, ½ρV². It is what decides whether an airframe holds together, and its peak is max Q.

## E

**Ejection charge** — The powder charge that pressurizes the airframe to push a recovery device out. Usually the motor's; sometimes electronic.

**Ejection delay** — The motor's built-in delay between burnout and its ejection charge. *In the app:* the motor's **Delay**, with **Plugged** for a motor with no charge. See **Optimum delay**.

**Engine block (thrust ring)** — A ring inside a motor tube that stops the motor sliding forward under thrust.

**Estimate** — A figure the app works out from the design rather than reading from a flight. The app says so where it shows one, and replaces it with the engine's own figure once a simulation has one. *In the app:* **Mass (Recovery, est.)** and the descent-sizing block before a run.

**Extended Barrowman** — The aerodynamic method the engine uses for CP, normal force and stability. It is accurate through subsonic and transonic flight and approximate above about Mach 1.5, where the app says so. See **Barrowman method**.

**Barrowman method** — The original analytical method for finding a rocket's center of pressure from its component shapes. The engine uses the extended form. See **Extended Barrowman**.

## F

**Fin set** — A group of identical fins spaced around the body. *In the app:* trapezoidal, elliptical and freeform fin sets, each with a fin count.

**Fin tab (through-the-wall tab)** — The part of a fin that passes through the airframe wall to anchor inside it. *In the app:* **Tab length**, **Tab height** and **Tab offset** on a fin set.

**Fineness ratio** — Overall length divided by maximum diameter. A low number is stubby, a high number is a needle. *In the app:* a stats tile.

**Flight configuration** — One named combination of motors, ignition and deployment choices for the same design, so several setups can be kept side by side. *In the app:* the configuration selector.

**Flight event** — Something the engine records at an instant: liftoff, rod clearance, burnout, apogee, deployment, separation, ground hit. *In the app:* the events table, and the markers on the plots.

**Flight model** — Which physics option a run uses where the app offers a choice. *In the app:* Settings ▸ Simulation ▸ **Flight model**. See **Guide-aware rod clearance**.

**Flight time** — How long the whole flight lasted. **Time to apogee** is the climb alone.

**Flown at Cd** — The drag coefficient a recovery device actually flew with, which is its own **Cd** unless it was set to follow the design automatically.

**Freeform fin** — A fin whose outline you draw point by point instead of choosing a trapezoid or an ellipse. *In the app:* the freeform fin editor, which also imports an outline from an image.

## G

**Ground track** — The path over the ground the flight took, drawn on a map at the launch site. See **Drift ellipse**.

**Ground-hit velocity** — How fast the rocket was descending when it landed. *In the app:* the landing-speed readout.

**Guide-aware rod clearance** — An optional flight model in which the rocket leaves the rod when its aft-most launch lug or rail button does, rather than after the full rod length. Off by default, which matches OpenRocket. On, the rail-exit velocity usually reads a little lower. *In the app:* Settings ▸ Simulation ▸ Flight model.

## H

**Haack (Von Kármán)** — A nose profile derived to minimize drag for a given length and volume; the LV-Haack and LD-Haack forms sit at either end of a shape parameter. *In the app:* a nose-cone **Shape**, with a **Shape parameter**.

## I

**Ignition event** — What lights a motor: the launch, a stage separation, or another motor's burnout. With an **ignition delay** it waits that long afterward. *In the app:* the motor's ignition settings.

**Impulse** — Thrust multiplied by the time it lasts, in newton-seconds: the total push a motor gives. Motors are grouped into **impulse classes** (A, B, C and up), each twice the one below. *In the app:* the motor browser and the **Total impulse** report row.

**Inner tube** — A tube inside another, most often the **motor mount** the motor sits in. *In the app:* **Inner tube**, with **Motor mount** ticked to make it one.

**Instance** — A repeat of a part: a pair of rail buttons, a ring of pods, a cluster of tubes. *In the app:* the instance count and separation on a part that can repeat.

**Integration** — Stepping the flight forward in small slices of time, which is how the whole trajectory is computed. The engine uses **RK4**, a fourth-order Runge-Kutta integrator, with an adaptive step. See **Time step**.

**ISA** — The International Standard Atmosphere: an agreed model of how temperature, pressure and density change with altitude. *In the app:* what a flight uses when the launch conditions leave temperature and pressure blank.

## K

**Kernel** — OpenRocket's own physics core, compiled to run in your browser. Every number a simulation produces comes from it. See **OpenRocket**.

## L

**Landing rate** — How fast the rocket is descending at the moment it touches down. It is the figure that decides whether the airframe survives the landing. *In the app:* the landing-speed readout, and the descent bands the sizing block compares against.

**Lateral** — Sideways, across the flight path. *In the app:* the `Al`, `Vl`, `Pl` and `θl` columns, which give lateral acceleration, velocity, distance and direction.

**Launch guide** — Whatever holds the rocket straight until it is fast enough for its fins to work: a **rod** through launch lugs, or a **rail** engaging rail buttons. *In the app:* **Rod length** and **Rod angle** in the launch conditions.

**Launch lug** — A small tube on the airframe that slides over a launch rod.

**Length** — The nose-to-tail span of every active part, including internal ones. Compare **Aerodynamic length**.

**Loaded mass (pad mass)** — The rocket ready to fly, motor and all. *In the app:* the **Mass (loaded)** tile.

## M

**Mach number** — Speed as a fraction of the speed of sound. **Subsonic** is below Mach 1, **transonic** around it, **supersonic** above. *In the app:* the **Max Mach** tile and the `M` column.

**Main parachute** — The chute that brings the rocket down to a safe landing speed, whether or not a drogue opened first.

**Marking guide** — A printable wrap-around template for marking fin and lug positions around a tube. *In the app:* an export.

**Mass component** — A part that is only mass: ballast, an altimeter, a battery, a payload. *In the app:* **Mass component**, with a type that names what it is.

**Mass override / CG override** — Replacing a part's computed mass or CG with a measured one, optionally for its whole subtree. *In the app:* the **Overrides** section. See **Override**.

**Material density** — How heavy a material is per unit of volume, area or length: bulk for solids, surface for fabric, line for cord. *In the app:* the material picker, where custom materials can be added.

**Moment of inertia** — How strongly the rocket resists being rotated. **Pitch** (or longitudinal) inertia resists tipping; **roll** (or rotational) inertia resists spinning. *In the app:* the inertia tiles and the `Il` and `Ir` columns.

**Moment (torque)** — A twisting force. *In the app:* the pitch, yaw and roll moment coefficients in a flight-data export.

**Motor type** — What kind of motor it is: single-use, a reload, or a hybrid. The **propellant type** names what is in it. Both come from the motor catalog rather than from your design, and neither changes the simulation: the thrust curve is what flies. *In the app:* the motor browser’s filters and detail rows.

**Motor designation** — A motor's name, such as `C6-5`: impulse class, average thrust, ejection delay. *In the app:* the motor browser.

**Motor overhang** — How far a motor sticks out past the end of its mount. *In the app:* **Motor overhang** on a mount.

## N

**Newton (N)** — The unit of force, so the unit of thrust. A **newton-second (N·s)** is the unit of impulse.

**Nose cone** — The rocket's front, shaped to cut drag. Its **profile** is the curve of its outline. See **Ogive**, **Haack**, **Shape parameter**.

**Nozzle** — The motor's throat and bell, which accelerate the exhaust. *In the app:* the motor's own nozzle diameter, used for the thrust model.

**Lift / normal force** — The aerodynamic force across the rocket's axis, which is what makes it weathercock or correct. Its coefficient is `Cn`, and the slope of that against angle of attack is CNα.

## O

**Ogive** — A nose profile whose outline is an arc. A **tangent** ogive meets the body smoothly; a **secant** ogive meets it at an angle. *In the app:* a nose-cone **Shape**.

**Offline install** — The app installs to your device and runs with no network, including this documentation and the bundled example designs. That is the point of it: a launch site rarely has signal. *In the app:* the install prompt in your browser, and **Help**, which reads offline from the first install onward.

**Offset** — How far a part sits from the reference its **Position from** names: the top or bottom of its parent, the middle, or an absolute distance from the nose.

**Opening shock** — The jolt when a canopy inflates. It is what a high deployment speed threatens the airframe with. See **Zippering**.

**OpenRocket** — The desktop rocket simulator whose physics core this app runs. Not affiliated with it. See **Kernel**.

**Optimum delay** — The ejection delay that would put deployment at apogee, computed by the engine from the flight. *In the app:* the **Optimum delay** tile.

**Outdated run** — A saved simulation whose result no longer describes the current inputs, because the design, the simulation's own settings, the flight configuration or a run preference has changed since. *In the app:* the row is marked outdated; run it again to bring the numbers up to date.

**Override** — Replacing something the app would compute with a value you supply: a mass, a CG, a drag coefficient. Used when you have weighed the real part.

## P

**Packed length / packed diameter** — The space a recovery device takes up folded in the airframe, as opposed to the size of its canopy. *In the app:* fields on the device.

**Parallel stage (strap-on booster)** — A booster mounted alongside the rocket rather than below it, which separates and flies its own branch. *In the app:* **Parallel stage**.

**Payload** — Whatever the rocket carries that is not there to make it fly: an altimeter, a camera, an egg.

**Pitch / yaw / roll** — Rotation about the three axes: nose up and down / nose left and right / spin about the long axis. *In the app:* the rate columns `dθ`, `dΨ` and `dΦ`.

**Planform** — A fin seen flat-on, and **planform area** is the area of that outline.

**Plugged motor** — A motor with no ejection charge, for a rocket that deploys electronically. *In the app:* the **Plugged** delay option.

**Pod set** — A group of external pods carried alongside the airframe, each able to hold its own parts. *In the app:* **Pod set**.

**Propellant mass** — How much of a motor's mass burns away. *In the app:* the difference between a motor's loaded and burnout mass, which is what recovery weight subtracts.

## R

**Rail button** — A small stud on the airframe that runs in a launch rail's slot, the usual alternative to launch lugs on larger rockets.

**Rail-exit velocity** — How fast the rocket is moving as it leaves the launch guide. Too slow and the fins have too little airflow to steer, so it can weathercock or go unstable. *In the app:* the **Rod exit** tile, judged against a minimum you set. See **Guide-aware rod clearance**.

**Recovery sizing** — Working out what canopy a rocket needs for a chosen descent rate. *In the app:* the descent-sizing block under a selected parachute, which is an estimate until a run has flown it. See **Estimate**.

**Recovery weight** — The mass the recovery system actually has to bring down: the rocket with the propellant gone. *In the app:* the **Mass (Recovery)** tile.

**Reference area / reference length** — The area and length the aerodynamic coefficients are expressed against, both taken from the body diameter. *In the app:* the `Ar` and `Lr` columns. Reference length is not the same as **Aerodynamic length**.

**Reynolds number** — A measure of how a flow behaves at a given size and speed, which is what decides how much of the drag is skin friction. *In the app:* the `R` column of a flight-data export.

**RK4** — Fourth-order Runge-Kutta, the integration scheme the flight simulator steps with. See **Integration**.

**RockSim** — Another rocket simulator, whose `.rkt` design files the app reads and writes.

**Rod aim** — Which compass direction the launch guide leans toward. *In the app:* **Rod direction**, or tick **Launch into wind** and the rod follows the surface wind, which is the usual practice and what the weathercocking figures assume. See **Weathercocking**.

**Rod angle** — How far the launch guide is tilted from vertical. *In the app:* **Rod angle**, with **Rod direction** for which way it leans, or **Launch into wind** to aim it automatically.

**Roll rate** — How fast the rocket is spinning about its long axis. *In the app:* the `dΦ` column. A cant angle drives it up.

## S

**Saved run** — A simulation kept in the list with its results, so several can be compared. See **Outdated run**.

**Scale factor** — Multiplying a whole design's dimensions to make a larger or smaller version of it. *In the app:* the **Scale** dialog.

**Schematic (2D) and 3D view** — The two ways the design is drawn: a flat side view with optional rulers, and a rotatable solid model. Both can show the CG and CP markers and the info card. See **Aft view**.

**Separation event** — A stage letting go of the one below it, optionally after a **separation delay**. *In the app:* the stage's separation settings, and the `STAGE_SEPARATION` flight event.

**Shape parameter** — The number that picks a variant within a nose or transition profile family, for power, parabolic and Haack shapes. It has no meaning on the others. *In the app:* **Shape parameter**, shown only where it applies.

**Shock cord** — The line joining a rocket's sections so they stay together after ejection. *In the app:* **Shock cord**, with a cord length and a line density.

**Shoulder** — The stepped-down end of a nose cone or transition that plugs into the tube behind it. A **capped** shoulder is closed off by a disc, which adds mass. *In the app:* shoulder radius, length, thickness and **Capped**.

**Shroud lines** — The cords from a canopy to the rocket. *In the app:* **Line count**, **Line length** and the line material on a parachute.

**SI units** — Meters, kilograms, seconds. Everything the app stores, the engine computes with, and every saved file holds is SI; the units you choose change only what is shown and typed. See **Units**.

**Simulation and design** — The design is the rocket; a simulation is one set of conditions to fly it under. One design can carry several simulations, each with its own launch conditions and its own saved result, so two sites or two wind speeds can be compared side by side. See **Outdated run**.

**Simulation branch** — One descending piece of a staged flight. The sustainer is one branch and each separated booster is another, each with its own events and its own mass, which is why a booster's figures are not the whole stack's.

**Six degrees of freedom (6DOF)** — A flight model that tracks position in three axes and rotation in three more, rather than treating the rocket as a point. It is what lets angle of attack, roll and weathercocking exist in the results.

**Solid (filled)** — A part with no hollow inside, so its mass is its whole volume. *In the app:* the **Filled** tick, which hides the wall and bore fields.

**Speed of sound** — How fast sound travels in the air the rocket is in, which falls as air gets colder. It sets what Mach number a given speed is. *In the app:* the `Vs` column.

**Spill hole** — A vent in the middle of a canopy, which lets it descend faster and more stably. *In the app:* **Spill hole diameter**, carried in the design.

**Stability margin** — How far the CP sits behind the CG, in **calibers** or as a percentage of length. Positive means the rocket tends to fly straight; too little and it is twitchy, too much and it weathercocks hard. *In the app:* the stability tile and badge, computed by the engine.

**Stage** — A section with its own motor that can separate. **Serial staging** is stages stacked nose to tail; see **Parallel stage** for alongside.

**Standard deviation (σ)** — How much a random quantity varies about its average. *In the app:* the wind's gust σ, which sets how much the wind fluctuates around the average you gave.

**Stats strip** — The row of tiles under the design views: length, diameter, fineness ratio, empty and loaded mass, CG, CP, recovery weight, stability, drag coefficient and the moments of inertia. Every figure in it comes from the engine as you edit, except the ones marked an estimate. See **Estimate**.

**Streamer** — A ribbon used instead of a chute for a fast, drifting descent on small rockets. *In the app:* **Streamer**, sized by strip length and width.

**Surface finish** — How rough a part's surface is, which changes skin-friction drag. *In the app:* **Finish** on an external part.

**Sweep** — How far a fin's tip sits back from its root. The **sweep angle** is the same thing as an angle. *In the app:* **Sweep** and **Sweep angle** on a fin set, which follow each other.

## T

**Terminal velocity** — The steady speed a falling object settles at once drag balances weight; under a canopy it is the descent rate. *In the app:* the descent figures, measured from the flight where one exists.

**Thrust** — The force a motor produces. **Average thrust** is its mean over the burn (the number in a motor's name), **peak thrust** its maximum. *In the app:* the `Ft` column and the thrust curve.

**Thrust curve** — Thrust against time for a particular motor, measured on a test stand. *In the app:* the motor browser's plot, and what a simulation actually flies.

**thrustcurve.org** — The public database of measured motor thrust curves the app’s motor catalog is built from. *In the app:* the motor browser, and the curve a simulation actually flies.

**Thrust-to-weight ratio** — Thrust divided by the rocket's weight at liftoff. Below about 5:1 a rocket leaves the pad sluggishly. *In the app:* the **T:W** tile and the `Twr` column.

**Time step** — How large a slice of time the integrator takes. Smaller is more accurate and slower; the stepper shortens it further when the rocket is rotating fast. *In the app:* Settings ▸ Simulation ▸ **Time step**, and the `dt` column. See **Integration**.

**Transition** — A part whose diameter changes from one end to the other, joining tubes of different sizes. A narrowing one at the tail is a **boattail**.

**Tube coupler** — A tube that fits inside two airframe tubes to join them.

**Tube fin** — A short tube mounted alongside the airframe as a fin. *In the app:* **Tube fin set**.

**Tumbling** — Coming down end over end rather than under a device. It is slower than a ballistic descent and is what a rocket with no recovery device does. *In the app:* the `TUMBLE` flight event.

**Turbulence intensity** — Gust σ expressed as a percentage of the average wind, which is often the easier way to think about it. *In the app:* the wind-profile editor, where the two follow each other.

## U

**Units** — The units shown and typed. A **preference** per quantity sets the default; a **unit chip** beside a field overrides it for that field alone. Everything stored stays SI. *In the app:* Settings ▸ Units, and the small unit control beside a value. See **SI units**.

## V

**Velocity** — Speed with a direction. **Vertical velocity** (`Vz`) is the up-and-down part alone; **lateral velocity** (`Vl`) is the sideways part.

## W

**WASM-GC / JS fallback** — The two forms the engine ships in. WebAssembly is the fast path essentially every current browser takes; the JavaScript build is the fallback for the rest. *In the app:* the header says which one is running.

**Weathercocking** — A stable rocket turning into the wind as it leaves the guide, which costs altitude and moves the landing point upwind. A low rail-exit velocity and a large stability margin both make it worse.

**Wind average / gusts** — The steady wind speed, and how much it varies about it. *In the app:* the launch conditions, or a layered **wind profile** giving speed and direction at several altitudes.

## Z

**Zippering** — A parachute opening hard enough that its shock cord tears a slit along the airframe tube. The usual cause is deploying too fast. See **Deployment velocity**, **Opening shock**.

## File types

| Type | What it is |
| --- | --- |
| `.ork` | OpenRocket's own design file. The app's primary format, read and written. |
| `.rkt` | RockSim's design file, read and written. Neither side is lossless; both say what they could not carry. |
| `.CDX1` | RASAero II's design file, written only. |
| `.csv` | Flight data, the events table and the run table, for a spreadsheet. |
| `.stl`, `.3mf`, `.obj` | Geometry for 3D printing and CAD. |
| `.svg`, `.pdf` | Cut files and the printable marking guide. |

## Symbols in plots and downloads

Every column a flight-data export can carry. The engine records these; the app only labels them.

| Symbol | Name |
| --- | --- |
| `ha` | Altitude above sea level |
| `Vz` | Vertical velocity |
| `Vl` | Lateral velocity |
| `Az` | Vertical acceleration |
| `Al` | Lateral acceleration |
| `Ax`, `Ay` | Acceleration to the East, to the North |
| `Abx`, `Aby` | Acceleration along the rocket's own body axes |
| `Ac` | Coriolis acceleration |
| `g` | Gravitational acceleration at the rocket's position |
| `Px`, `Py` | Position East of, and North of, the launch point |
| `Pl` | Lateral distance from the launch point |
| `θl` | Lateral direction |
| `Φ` | Lateral orientation (azimuth) |
| `Θ` | Vertical orientation (zenith) |
| `dθ`, `dΨ`, `dΦ` | Pitch, yaw and roll rate |
| `α` | Angle of attack |
| `M` | Mach number |
| `Vs` | Speed of sound |
| `ρ` | Air density |
| `P` | Air pressure |
| `T` | Air temperature |
| `Vw`, `θw` | Wind velocity and direction |
| `φ`, `λ` | Latitude and longitude |
| `Ft` | Thrust |
| `Twr` | Thrust-to-weight ratio |
| `mp` | Motor mass |
| `Cd` | Drag coefficient |
| `Cda` | Axial drag coefficient |
| `Cdf` | Friction drag coefficient |
| `Cdp` | Pressure drag coefficient |
| `Cdb` | Base drag coefficient |
| `Cn` | Normal force coefficient |
| `Cθ` | Pitch moment coefficient |
| `CτΦ`, `CτΨ` | Roll and yaw moment coefficient |
| `Cτs` | Side force coefficient |
| `Ccm` | Corrective moment coefficient |
| `Cdm` | Damping moment coefficient |
| `Cdm_aero`, `Cdm_prop` | Damping moment, aerodynamic and propulsive parts |
| `Cζθ`, `CζΦ`, `CζΨ` | Pitch, roll and yaw damping coefficient |
| `CfΦ` | Roll forcing coefficient |
| `ζ` | Damping ratio |
| `ωn` | Natural frequency |
| `Il` | Longitudinal (pitch) moment of inertia |
| `Ir` | Rotational (roll) moment of inertia |
| `Ar` | Reference area |
| `Lr` | Reference length |
| `R` | Reynolds number |
| `dt` | Simulation time step |
| `tc` | Computation time |

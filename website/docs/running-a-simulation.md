---
title: "Running a Simulation"
sidebar_position: 11
---
Simulations live in the right-hand panel. You can keep **several named simulations** for one design (e.g. different motors or launch sites), **duplicate** one as a starting point, and delete them. The red **Delete simulation** button (next to the current simulation's name) removes it after a confirmation; the workspace always keeps at least one, so it's disabled when only one remains.

## Set up the launch

Each simulation has its own launch configuration, grouped into cards:

- **Launch rod / rail** — length, angle from vertical, and direction (or "launch into the wind").
- **Launch site** — altitude, latitude, and longitude, plus [saved locations](#saved-locations) and a [map](#the-map).
- **Atmosphere** — ISA standard, or override temperature and pressure.
- **Wind** — average speed, gusts (standard deviation), and direction; or a **multi-level** wind profile that varies with altitude.
- **Earth model** — flat, spherical, or WGS84 (affects long/high flights).

New simulations start from your global [Settings](./settings.md) defaults.

### Saved locations

The launch site is a property of the **field**, not of a flight, so it does not have to be retyped every time. The row at the top of the Launch site card saves and recalls them:

- **💾 Save this location** stores the three site fields under a name. Saving under a name you already used updates that location instead of adding a second one you could not tell apart in the list.
- The **dropdown** applies a saved location's latitude, longitude and elevation. It is one ordinary edit, so it undoes like any other. It reads **Custom location** whenever the fields match no saved location, recognized from the numbers themselves, so it stays right whether you typed them, imported them from a `.ork` or used 📍 **Use my location**. Picking **Custom location** yourself returns the three site fields to your [Settings](./settings.md) launch defaults — the **Kennedy Space Center** unless you have changed them. That is for when you are somewhere new and would rather start from a known place than edit a saved location's numbers one at a time: the map has somewhere to open, and all three fields stay filled, so the run is never refused for a blank. It is an ordinary edit too, so undo brings the old site back.
- **⚙ Manage saved locations** lists them with their coordinates, so two fields with similar names can be told apart. **Edit** opens the whole location — name, latitude, longitude and elevation — because a mistyped coordinate is the thing you most often want to fix, and **New location** creates one by typing the numbers in. The same list is in the **menu → Launch locations**, beside the Motor Dashboard, so you can look at your locations without first opening a simulation; picking one there applies it to the simulation you have open, and **New location** is the way to add one from there, where no launch fields are on screen to capture.

Elevation is shown and edited in whatever unit your launch site card uses, so a field at 6,004 ft reads that way in both places. Latitude and longitude are always degrees, and both are required — 0°, 0° is a point in the Gulf of Guinea, not "unset".

### The map

Four digits of latitude and four of longitude are not something you can check by reading them. A dropped minus sign moves a Colorado field to western China and nothing on screen looks any different, so the site has a map: **🗺 Show on map** on the Launch site card opens it, and the location editor carries one beside its fields.

- **Satellite or street.** Imagery is the default and is usually the one that answers the question, because a club field is a mown strip in a hayfield: invisible on a street map, unmistakable from above. The street layer is for reading the roads in and the town you are near. Both come from Esri's map services; the street layer is built on OpenStreetMap data and credits it, but the app deliberately does not draw from OpenStreetMap's own tile servers, which are volunteer-funded and not there for applications to build on.
- **Clicking the map sets the coordinates**, to four decimal places (about 10 m, the same precision 📍 Use my location writes). This is the only way to enter a field that has no published numbers, and it is one ordinary edit, so it undoes like any other. Drag to pan, scroll or use **+** / **−** to zoom; a drag never counts as a click.
- **Typing moves the pin**, so the map and the fields are two views of one thing rather than two places to be wrong.

Tiles you have already looked at are stored by the app, so a location you checked at home still draws at the field with no signal. Somewhere you have never viewed cannot be drawn offline: the map says so and falls back to a coordinate grid, which still places the point by hemisphere. Tiles come from Esri, and only the ones for what you are looking at are ever requested — see **[Offline & Installing](./offline-and-installing.md)**.

A location holds **only the site**. The rod, the wind and the atmosphere are conditions on the day, and a location that restored last month's wind would be worse than one that restored nothing — it would look authoritative. Locations live in this browser on this device, like your custom motors and materials; nothing is uploaded.

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

These two checks are also the *only* safety rules the app enforces. What the simulation does and does not model, and what to verify on the real rocket before you fly it, is in [Safety](./safety.md).



## Read the results

Running opens the **Results** tab on the flight you just ran — one simulation or a batch, since running is asking to see the answer.

A **Before you fly** card heads the results: what these numbers are (estimates from a model, not a flight card), what the model never had (fin flutter, structural loads, parachute inflation and opening shock, your motor's behavior on the day), and the reminder to weigh and balance the rocket you actually built and enter those as overrides before trusting the margin. It links to **[Safety](./safety.md)**, and it leads the numbers rather than following them, because what a reading is worth is a thing to know before reading it.

Click its heading to fold the explanation away. Folding asks you to acknowledge the notes first, because the fold is remembered and that click is the last time they get offered on this browser; canceling leaves the card open, and opening it back up asks nothing. What never folds is the heading itself, so the warning glyph and the words stay above the numbers either way.

Under it, results are shown as tiles, in roughly chronological flight order, including:

- **Rail-exit velocity** (flagged if below your safety minimum)
- **Optimum delay** and **time to apogee**
- **Apogee** (max altitude) and **max velocity / acceleration / Mach**
- **Deployment speed** (flagged if above your warning threshold; green when safely low). On a [dual-deployment](./designing-a-rocket.md#dual-deployment) design the flight engine judges the main and the drogue against their own thresholds instead, and reports a warning for each.
- **Landing speed**, **flight time**, and **downrange** distance
- **Max-Q**, the peak dynamic pressure of the boost. The engine does not record it, so it is derived from the air density and speed of sound the run already carries; it is the number that decides whether the airframe holds together. A result saved before simulations kept the full series set has no air density stored, and reports no Max-Q rather than a zero that would look like an answer.

### Flight events

Under the tiles, the **Flight events** table is the flight as a list you can read down: one row per event, with the time it happened and the state of the rocket at that instant. The charts mark the same events as labels, which answers *when* and nothing else.

Every event the engine raises is named, not just the five the charts label, so rail departure, ignition, stage separation and tumble appear here for the first time. Each row carries the **altitude** and **speed** at its instant, in units you set from the column headers, and the rows that are read for more carry it on a line of their own:

- **Rail departure** gives the static margin, thrust-to-weight and angle of attack it left the rail with.
- **Burnout** gives its Mach.
- **Max-Q** gives the dynamic pressure and the Mach at the peak.

A **recovery deployment** names the parachute that fired, so a dual-deploy drogue is told from the main, and a clustered stage gets one row per motor rather than one for the stage. On a staged flight every stage is in the one table, tagged and interleaved on the single launch clock, because that is the order the flight happened in: a spent booster comes down while the sustainer is still coasting.

The **CSV** button writes the table as a file. See **[Files & Exports](./files-and-exports.md#exporting-data)**.

For the full time-history, open the **[Flight and 3D-path views](./views-and-analysis.md)**. To save the numbers, see **[Files & Exports](./files-and-exports.md)**.

## Editing invalidates results

Changing the design clears each simulation's cached result (the physics no longer matches) — just press **Run** again. The same applies to **undo/redo**: it restores your design and simulation *inputs*, but not cached flight results, so re-run to see the flight.

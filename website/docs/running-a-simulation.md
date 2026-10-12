---
title: "Running a Simulation"
sidebar_position: 12
---
Simulations live on the **Simulations** tab: a table with one row per simulation. On a wide screen the selected simulation's editor sits in a column to the right of the table; on a phone it sits under the table. A simulation is a [flight configuration](./flight-configurations.md) (the motors, the recovery and the staging) flown under a set of launch conditions, so what a row carries of its own is its name, the configuration it flies, the conditions and the last result. You can keep **several named simulations** for one design (e.g. different motors or launch sites), **duplicate** one as a starting point, and delete them. The toolbar above the table holds **＋ New**, **Duplicate simulation** and the red **Delete simulation**, which removes the current simulation. It asks first when **Confirm deletion of simulations** is on in [Settings ▸ Simulation](./settings.md#simulation-defaults), which it is by default. The workspace always keeps at least one simulation, so Delete is disabled when only one remains.

**Run outdated (N)** in the toolbar flies every simulation that has never run or whose result is outdated; N is how many that is. It ignores the tick boxes, and it is disabled when every simulation is up to date.

A row that has a result ends in a 📊 button, **View results**, which opens the Results tab on that simulation.

The tick boxes choose which rows **Run** flies, and also which rows the editor changes. With more than one ticked, the editor says *Editing N selected simulations*, and a field you change is set on all of them. Names and motors stay per simulation. A field where the ticked simulations differ says so, and changing it sets them all to the new value.

**⬇ CSV** in the toolbar downloads the **run table**: every simulation as one row, with its configuration, motors, status and results (apogee, speeds, times, Max-Q, max q·α and max roll rate) in your units. A simulation that has not flown is listed with its figures blank, and an outdated one is marked as such, since its figures describe the design before your latest edits.

## Pick what it flies

The **Configuration** column in the table, and the picker at the top of the editor, choose which [flight configuration](./flight-configurations.md) the row flies; the motors it seats are spelled out underneath. **Edit motors…** opens the Configurations tab on that one.

Several rows can fly the same configuration, which is the point of having them: change a motor once and every flight that uses it is flagged for a re-run. Two rows that should differ by motor want two configurations, one each.

## Set up the launch

Each simulation has its own launch configuration, grouped into cards:

- **Launch rail**, **Launch rod** or **Launcher**: length, angle from vertical, and direction (or "launch into the wind"). The card takes its name from the design's guides: rail buttons ride a rail, launch lugs ride a rod, and a design with neither, or both, says launcher. The same word runs through the results tiles, the flight events, the warnings and the report.
- **Launch site**: altitude, latitude, and longitude, plus [saved locations](#saved-locations) and a [map](#the-map).
- **Atmosphere**: ISA standard, or override temperature, pressure and humidity, or fill them and the wind from a [weather forecast](#weather). **Pressure** is the pressure *at the site*, not the sea-level figure weather apps and airport reports usually give. A typed pressure well above the standard pressure for the site's elevation gets an amber note under the field saying so, since that is what a sea-level figure looks like at a high field. The note never blocks a run: the value may be right.
- **Wind**: average speed, gusts (standard deviation), and direction; or a **multi-level** wind profile that varies with altitude.
- **Earth model**: flat, spherical, or WGS84 (affects long/high flights), and **Gravity**: WGS84 or **Constant**. Constant takes a **g** value.

New simulations start from your global [Settings](./settings.md) defaults.

### Saved locations

The launch site is a property of the **field**, not of a flight, so it does not have to be retyped every time. The row at the top of the Launch site card saves and recalls them:

- **🔍 Find a place** sets the site from a place name, a postal code, pasted coordinates or a map link. A name or postal code is looked up with Open-Meteo's place search, the same way the weather is fetched, and lists the matches with their elevation; choosing one sets latitude, longitude and elevation as one edit. Coordinates and map links from Google, Apple, OpenStreetMap or Bing are read in the app and never sent anywhere, and only the elevation at that point is looked up. When no elevation is found, as when you are offline, the elevation is left blank rather than kept from the previous site. A shortened link (`maps.app.goo.gl/…`) hides the place behind a redirect, so open it and paste the full address instead. Place names come from GeoNames, under CC BY 4.0.
- **💾 Save this location** stores the three site fields under a name. Saving under a name you already used updates that location instead of adding a second one you could not tell apart in the list.
- The **dropdown** applies a saved location's latitude, longitude and elevation. It is one ordinary edit, so it undoes like any other. It reads **Custom location** whenever the fields match no saved location, recognized from the numbers themselves, so it stays right whether you typed them, imported them from a `.ork` or used 📍 **Use my location**. Picking **Custom location** yourself returns the three site fields to your [Settings](./settings.md) launch defaults: the **Kennedy Space Center** unless you have changed them. That is for when you are somewhere new and would rather start from a known place than edit a saved location's numbers one at a time: the map has somewhere to open, and all three fields stay filled, so the run is never refused for a blank. It is an ordinary edit too, so undo brings the old site back.
- **⚙ Manage saved locations** is a two-pane library: the locations on the left with their coordinates, so two fields with similar names can be told apart, and the selected one open on the right. The editor is the whole location (name, latitude, longitude, elevation and the map) because a mistyped coordinate is the thing you most often want to fix. **Save** writes it and leaves it selected, **Discard** puts it back as it was stored, and moving to another location with unsaved edits asks first. **Use** applies the selected location to the simulation you have open, and is refused while you have unsaved edits, since what it offers is one of the sites you have *saved*. **New location** creates one by typing the numbers in. The same library is in the **menu → Launch locations**, beside the Motor Dashboard, so you can look at your locations without first opening a simulation, and **New location** is the way to add one from there, where no launch fields are on screen to capture.

Elevation is shown and edited in whatever unit your launch site card uses, so a field at 6,004 ft reads that way in both places. Latitude and longitude are always degrees, and both are required: 0°, 0° is a point in the Gulf of Guinea, not "unset". Beside each one, the unit names the hemisphere the sign puts the site in (**° N** or **° S**, **° E** or **° W**) as you type, so a dropped minus sign shows at once.

### The map

A latitude and longitude are hard to check by reading them, and a dropped minus sign moves a field to the other side of the world, so the site has a map: **🗺 Show on map** on the Launch site card opens it, and the location editor carries one beside its fields.

- **Satellite or street.** Satellite imagery is the default, because a club field usually shows on imagery and not on a street map. The street layer shows the roads and the nearby town. Both come from Esri's map services; the street layer is built on OpenStreetMap data and credits it. The app does not use OpenStreetMap's own tile servers.
- **Clicking the map sets the coordinates**, to four decimal places (about 10 m, the same precision 📍 Use my location writes). This is the only way to enter a field that has no published numbers, and it is one ordinary edit, so it undoes like any other. Drag to pan, scroll or use **+** / **−** to zoom; a drag never counts as a click.
- **Typing moves the pin**, so the map and the fields always show the same point.

Tiles you have already looked at are stored by the app, so a location you checked at home still draws at the field with no signal. Somewhere you have never viewed cannot be drawn offline: the map says so and falls back to a coordinate grid, which still places the point by hemisphere. Tiles come from Esri, and only the ones for what you are looking at are ever requested: see **[Offline & Installing](./offline-and-installing.md)**.

A location holds **only the site**. The launcher, the wind and the atmosphere change from day to day, so a location does not store them. Locations live in this browser on this device, like your custom motors and materials; nothing is uploaded.

### Weather from Open-Meteo {#weather}

**Get weather…** on the Atmosphere card fills the launch conditions from an [Open-Meteo](https://open-meteo.com/) forecast for the launch site. Set the site's latitude, longitude and elevation first, then pick a date and an hour in the site's own time and press **Fetch**.

The dialog shows what it found, each with a checkbox, and changes nothing until you press **Apply**:

- **Temperature**, **Pressure** and **Humidity** at the pad. The pressure is the pressure at the site's elevation, not the sea-level figure a weather report gives.
- **Wind**: the 10 m wind at the pad, the winds at 80, 120 and 180 m above it, and the wind at each of Open-Meteo's pressure levels higher up, written as a multi-level wind profile measured from sea level. The turbulence at the pad is estimated from the gusts, and the levels above it get 10%. The average wind fields are filled from the pad wind as well.
- **Atmosphere aloft**: temperature, pressure and humidity at each pressure level above the pad. With it applied, the flight uses this atmosphere instead of the ISA standard above the site. The Atmosphere card shows it as **Forecast atmosphere to** a height, with **Clear** to go back to the standard one.

Dates from about three months back to 15 days ahead use the forecast. Earlier dates, back to 1940, use Open-Meteo's historical record, which has surface values only, so the wind profile and the atmosphere aloft are not offered. When the site altitude and Open-Meteo's terrain height differ by more than 30 m, the dialog offers the terrain height as the site altitude, and the values it shows follow that choice.

The dialog says when the answer was fetched. An answer is reused for 30 minutes for the same place and dates, since the fastest forecast model publishes a new run once an hour; the dialog says when it was reused, and **Fetch fresh** asks Open-Meteo again anyway.

Below them, for the same hour, the dialog shows the forecast **cloud cover** (all levels, and low cloud) and the **visibility** (forecast dates only; the historical record has none). They are information for deciding whether to fly, not inputs: nothing in a flight reads them, so they have no checkbox and are never applied. The field's waiver and the RSO decide whether the sky is good enough.

A forecast is a model's estimate. Applying it is an ordinary edit that undoes like any other, and results flown under the old conditions show as outdated.

The Atmosphere card then says where the values came from, such as *Open-Meteo forecast for Oct 5, 2026, 12:00 PM MDT at 39.739°, -104.990°, fetched Oct 4, 2026, 9:14 AM MDT*, with Open-Meteo's credit, and adds a note when one of these is true:

- **Edited since it was applied**: a value the forecast filled has been changed.
- **The launch site has moved**: the latitude or longitude is no longer the place the forecast was for.
- **Fetched over 3 hours ago**: the forecast is for a time still ahead, and Open-Meteo has likely published a newer one.

**Refresh…** opens the dialog on the same date and hour with the same boxes ticked and fetches at once; nothing changes until you press Apply. A refresh that brings back the same values leaves your results current. The record is saved with the simulation and in a `.ork`.

**The service.** Requests go from your browser to Open-Meteo only when you press Fetch, and carry the site's coordinates and elevation and the chosen date. They do not name this app or the site it is served from. Without an API key the app uses Open-Meteo's free service, which is for non-commercial use and has daily limits. If you have a paid Open-Meteo plan, enter its key in [Settings](./settings.md#open-meteo-key), at the bottom of the Atmosphere card on the Launch tab. The key is kept only in this browser and is never saved into a design or a `.ork`. Weather data is by Open-Meteo.com under CC BY 4.0, and the dialog credits it.

The forecast atmosphere is this app's addition. Desktop OpenRocket uses the ISA standard above the site, and a `.ork` saved here carries the levels as an extension that desktop OpenRocket skips.

## Run it

Press **Run flight simulation**. The flight runs in a background **Web Worker**, so the interface stays responsive: a spinner shows while it computes (typically well under a second). When it finishes, the **Results** tab opens with its **Flight**, **3D path**, **Ground track** and **Environment** views (see [Views & Analysis](./views-and-analysis.md)).

### When a run is refused

A flight that cannot be computed correctly is not flown. The Run button says why, naming the part, field or simulation at fault.

Two kinds of problem, which behave differently:

**Faults in the design** stop everything, because every simulation shares one rocket:

- **No motor mount**: nowhere to seat a motor. Add one (see [Designing a Rocket](./designing-a-rocket.md#motor-mount)).
- **A required dimension is zero**: the part is named, along with which of its dimensions. See [Required dimensions](./designing-a-rocket.md#required-dimensions).

**Faults in one simulation** only skip that row. Select six and run them: the good ones fly, and the button tells you which are being left out and why.

- **No usable motor**: nothing loaded on the primary mount, or an imported `.ork` whose motor could not be matched to a thrust curve.
- **A required launch field is blank**: rail or rod length, rail or rod angle, wind speed, wind standard deviation, site altitude, latitude or longitude. These have no sensible default, so a blank one is named rather than guessed at.
- **Launch conditions outside the safety codes**: a launcher more than 30° from vertical for a model rocket or 20° for a high power one, or surface wind above 20 mph. See [Safety limits](#safety-limits) below.

The button only goes dead when *nothing* selected can fly. Otherwise it stays live, counts the rows that will actually run, and names the ones it is skipping. A row that cannot fly does not stop the others.

### Safety limits

Launch conditions are checked against the **NAR** and **Tripoli** safety codes, which is why two fields refuse to go past them:

- **Launcher angle** (rail or rod): within **30°** of vertical for a model rocket, and within **20°** for a high power rocket.
- **Wind speed**: at or below **20 mph** (32 km/h).

Which angle applies depends on the flight configuration the simulation flies. It is high power when any motor has more than 160 N·s of total impulse or more than 80 N of average thrust, when the motors together hold more than 320 N·s or more than 125 g of propellant, or when the rocket weighs more than 1,500 g at liftoff; otherwise it is a model rocket. The hint under the angle field says which code applies. In Settings, where the defaults serve every configuration, the field stops at 30° and the hint states both limits.

The codes state these in imperial, so the metric figures the app shows are exact conversions rather than round numbers. The fields clamp as you type, and a `.ork` file that arrives outside them is listed in the import banner rather than quietly flown.

Only the wind **at the pad** is judged. On a multi-level profile that is the ground layer; winds aloft are not something a launch is called on, because they are not something anyone at the field measures. Gust standard deviation is deliberately not checked either: the codes speak about wind speed, and a mean inside the limit with gusts above it is a judgment call the app is not equipped to make.

These are flying limits, not modeling limits. They are about whether the launch should happen, so unlike your rocket's geometry they are not preserved as authored: a file's out-of-limits conditions are flagged, and the run is refused until they are brought inside.

These two checks are also the *only* safety rules the app enforces. What the simulation does and does not model, and what to verify on the real rocket before you fly it, is in [Safety](./safety.md).



## Read the results

Running opens the **Results** tab on the flight you just ran: one simulation or a batch, since running is asking to see the answer.

A **Before you fly** card heads the results: what these numbers are (estimates from a model, not a flight card), what the model never had (fin flutter, structural loads, parachute inflation and opening shock, your motor's behavior on the day), and the reminder to weigh and balance the rocket you actually built and enter those as overrides before trusting the margin. It links to **[Safety](./safety.md)**, and it leads the numbers rather than following them, because what a reading is worth is a thing to know before reading it.

Click its heading to fold the explanation away. Folding asks you to acknowledge the notes first, because the fold is remembered and that click is the last time they get offered on this browser; canceling leaves the card open, and opening it back up asks nothing. What never folds is the heading itself, so the warning glyph and the words stay above the numbers either way.

Under it, results are shown as tiles, in roughly chronological flight order, including:

- **Rail exit** (**Rod exit** or **Launcher exit**, after the design's guides): the speed as the rocket leaves the launcher, flagged if below your safety minimum
- **Static margin @ rail exit** (**@ rod exit** or **@ launcher exit**, after the design's guides): the stability margin in calibers at the moment the rocket leaves the guide, with the CP at that moment, marked stable, marginal or unstable. The stats strip's stability figure is for the rocket on the pad; this one uses the real speed and the partly burned motor.
- **Optimum delay** and **time to apogee**
- **Apogee** (max altitude) and **max velocity / acceleration / Mach**
- **Deploy speed** (flagged if above your warning threshold; green when safely low). On a [dual-deployment](./designing-a-rocket.md#dual-deployment) design the flight engine judges the main and the drogue against their own thresholds instead, and reports a warning for each.
- **Landing** (the landing speed), **Flight time**, and **Downrange** distance
- **Max-Q**, the peak dynamic pressure of the boost. The engine does not record it, so it is derived from the air density and speed of sound the run already carries; it is the peak load the airframe has to withstand. A result with no stored air density reports no Max-Q rather than a zero.
- **Max q·α**, the largest dynamic pressure times angle of attack while the rocket still flies forward (up to deployment, else apogee), in the Max q pressure unit times your angle unit (kPa·° or psi·°, for example). The side load on fins and couplers follows it. Derived the same way as Max-Q.
- **Max roll rate**, the fastest the rocket rolled during the flight, read from the engine's roll rate series.

### Flight events

Under the tiles, the **Flight events** table is the flight as a list you can read down: one row per event, with the time it happened and the state of the rocket at that instant. The charts mark the same events as labels, which answers *when* and nothing else.

Every event the engine raises is named, not just the five the charts label, including rail departure, ignition, stage separation and tumble, which the charts do not label. Each row carries the **altitude** and **speed** at its instant, in units you set from the column headers, and the rows that are read for more carry it on a line of their own:

- **Rail departure** (or rod or launcher departure, after the design's guides) gives the static margin, thrust-to-weight and angle of attack it left with.
- **Burnout** gives its Mach.
- **Max-Q** gives the dynamic pressure and the Mach at the peak.

A **recovery deployment** names the parachute that fired, so a dual-deploy drogue is told from the main, and a clustered stage gets one row per motor rather than one for the stage. On a staged flight every stage is in the one table, tagged and interleaved on the single launch clock, because that is the order the flight happened in: a spent booster comes down while the sustainer is still coasting.

The **CSV** button writes the table as a file. See **[Files & Exports](./files-and-exports.md#exporting-data)**.

For the full time-history, open the **[Flight and 3D-path views](./views-and-analysis.md)**. To save the numbers, see **[Files & Exports](./files-and-exports.md)**.

## Editing invalidates results

Changing the design does not delete a simulation's result. The numbers stay readable, and the simulation is marked **Outdated** in the table and on the Results tab, because they no longer describe the rocket. Press **Run** (or **Run outdated**) to bring them up to date. **Undo/redo** restores your design and simulation *inputs* and keeps the current results; a result reads as outdated unless the restored inputs are the ones it was flown with.

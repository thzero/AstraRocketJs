---
title: "Tools"
sidebar_position: 12.5
---
The **Tools** tab holds quick answers that need no design: where a rocket lands, how it leaves the rail, and what size parachute it needs. They suit a rocket you have not modeled, or a quick check at the field. On narrower screens the tab shows as 🧰, and on a phone it is on the bottom bar. Pick a tool from the row of tabs at the top. Each one keeps its inputs and its last result while you switch tools or tabs, until the page is reloaded.

Every tool here is an estimate, and says so. A rocket designed here gets better answers from its own simulation.

## Landing estimator {#landing-estimator}

Where a rocket comes down, from a launch site, a forecast hour, an apogee and descent rates. A designed rocket's simulation flies the whole flight, the way up included; see [where it landed](./views-and-analysis.md#where-it-landed) on the Environment view.

### Enter the flight {#enter-the-flight}

- **Launch site.** Pick a [saved location](./running-a-simulation.md#saved-locations), type the latitude and longitude, or use **Show on map** to pick the spot. Leave **Site elevation** blank to use the terrain model's height at the site.
- **When.** The date and the hour, in the site's local time. Dates from about three months back to 15 days ahead use the forecast, which has the wind at a range of heights. Earlier dates, back to 1940, use Open-Meteo's historical record, which has only the wind near the ground, so the whole descent drifts on that and the result says so.
- **Flight.** The apogee above the pad, then the recovery:
  - **Single**: one descent rate from apogee to the ground.
  - **Dual**: the drogue's rate from apogee down to the height the main opens, then the main's rate to the ground. The main has to open below apogee, and **Estimate landing** stays disabled until it does.

Press **Estimate landing**. The inputs and the last result stay while you switch tabs, until the page is reloaded.

### How it works {#how-it-works}

The estimator fetches the [Open-Meteo](./running-a-simulation.md#weather) forecast for the site, through the free service or [your key](./settings.md#open-meteo-key) if you have one. The descent starts at apogee straight above the pad and falls at the rates you entered. At each height it drifts with the forecast wind there, taken between the forecast's pressure levels.

The flight up is not modeled: no weathercocking and no drift on the way up. The rates are the ones you type, not ones worked out from a parachute.

**Terrain.** The estimator also fetches ground heights over an area around the drift, up to 30 km either side of the pad, and ends the descent where it meets the ground. A landing in a valley falls longer and drifts farther; one on a hillside stops sooner. If the ground heights cannot be fetched, the landing is on flat ground at the pad's height, and the result says so.

**The landing zone.** Besides the main estimate, the estimator flies 135 descents:

- each forecast hour from two before to two after the one you chose,
- the wind speed 20% either way,
- the wind direction 15° either way,
- the descent rates 10% either way.

The landing zone is the 2σ ellipse around where they land. An hour near the start or end of the forecast has fewer hours around it, so it flies fewer descents.

### Read the result {#read-the-result}

The map is seen from above, with the pad at the center, north up and range rings for scale. It shows the descent's path, a ring where it lands, a dot for each of the 135 descents and the landing zone around them. The **None**, **Satellite** and **Street** buttons choose what is drawn underneath, the same as on the [ground track](./views-and-analysis.md#ground-track-after-a-simulation).

Under the map:

- **Lands at**: latitude and longitude.
- **Distance** and **Bearing from the pad**.
- **Descent time**: from apogee to the ground.
- **Landing zone (2σ)**: the ellipse's size. A very tight spread has none drawn.
- **Ground at landing**: the ground's height there.
- **Date / time**: the forecast hour, in the site's time zone.

Open-Meteo's CC BY 4.0 credit follows.

## Off the rail {#off-the-rail}

How a rocket leaves the rail on a given motor: its thrust to weight, the speed it leaves the rail at, and how far a crosswind turns it as it does. A designed rocket gets these from its simulation, on the [rail departure event](./running-a-simulation.md#flight-events).

### Enter the rocket {#enter-the-rocket}

- **Motor.** **Choose…** opens the same motor picker as a simulation, with the whole catalog and any motors you have imported. The motor's thrust curve and its mass as it burns come from there.
- **Rocket mass without the motor.** The motor's loaded mass is added to it.
- **Launch rod length.**
- **Wind speed.** Type it, or open **Wind from a forecast**, pick a site, date and hour, and press **Get the forecast wind** to fill it from Open-Meteo's wind at 10 m. The gusts for that hour are used too.

### How it works {#how-it-works-rail}

The rocket sits on the rail until the motor's thrust is more than its weight, then accelerates up the rail as thrust less weight over its mass, with the mass falling as the propellant burns. It leaves the rail when it has moved the rail's length. There is no drag and no rail friction, and the rail is taken as vertical, so a real rocket leaves a little slower.

A crosswind meets a rocket moving straight up, so the air it sees comes from an angle: the arctangent of the wind speed over the rail exit speed. The fins turn the rocket into that air, which is weathercocking.

### Read the result {#read-the-result-rail}

- **Liftoff mass**: the rocket and the loaded motor.
- **Thrust to weight**: the motor's average thrust over its burn, its peak thrust, and its thrust at the moment the rocket leaves the rail, each over the liftoff weight. The last one is the figure a simulation reports at rail departure.
- **Rail exit speed** and **Time to leave the rail**.
- **Rail for** the minimum rail exit speed: how much rail it takes to reach that speed, in amber when that is more than the rail you entered.
- **Weathercock angle** at the wind you entered, and **in the gusts** when the wind came from a forecast.
- **Strongest wind under 20°**: the wind that turns it exactly 20° at this exit speed.
- **Heaviest rocket without the motor**: the most it can weigh and still meet both an average thrust to weight of 5 : 1 and the minimum rail exit speed.

A figure is marked in amber when the average thrust to weight is under 5 : 1, the rail exit is slower than the minimum set in [Settings](./settings.md) (15 m/s unless you change it), or the weathercock angle is over 20°. These are common rules of thumb, not part of any safety code.

If the thrust never exceeds the weight, or the rocket slows to a stop before the end of the rail, the result says so instead.

## Parachute sizing {#parachute-sizing}

The canopy that lands a rocket at a chosen descent rate. Enter what comes down under the canopy (the rocket after its propellant has burned), the canopy's drag coefficient, and the site's elevation and temperature for the air density. Leave the temperature blank for the standard atmosphere at that elevation. Add a canopy diameter to see how fast that canopy comes down.

The result gives the diameter for the **main** band (15 to 20 ft/s) and the **drogue** band (50 to 75 ft/s), and for **your own descent rate** if you enter one. These come from the descent equation, the same one the parachute editor uses; see [sizing a parachute](./designing-a-rocket.md#sizing-a-parachute).

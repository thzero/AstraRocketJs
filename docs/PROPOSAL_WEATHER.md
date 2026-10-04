# Weather from Open-Meteo: proposal

> Status: PLANNED, nothing built. Written 2026-10-04 against `dev`, with the engine pinned to
> OpenRocket `unstable` at `b4eb02a48`.
>
> Fill a simulation's launch conditions from an Open-Meteo forecast for a chosen date, hour
> and launch site: temperature, pressure, humidity, surface wind and gusts, and winds aloft.
>
> This is a planning document. Once the work lands, what survives of it belongs in
> [Architecture & internals](./ARCHITECTURE.md) and the [website docs](../website/docs/), and
> this file goes away.

## Why

Most simulations are run before launch day, against conditions somebody typed in from a
forecast. The app already flies everything a forecast provides. The kernel has desktop's
multi-level wind model, and the launch conditions carry temperature, pressure, humidity, wind
levels and the launch-site altitude. What is missing is getting the numbers in without typing
them.

## Where OpenRocket stands

Nothing is merged. The pinned engine (`unstable` at `b4eb02a48`) has no weather code. Three
items are open upstream:

- **Issue [#2737](https://github.com/openrocket/openrocket/issues/2737)**, winds and
  temperatures aloft from Open-Meteo. The maintainers support it. It also proposes replacing
  the standard-atmosphere temperature aloft with the forecast's, which would be a kernel
  change.
- **PR [#2917](https://github.com/openrocket/openrocket/pull/2917)** looks up the launch-site
  elevation from the Open-Meteo elevation API when coordinates change. Its client is in
  `core` (`OpenMeteoAPI.java`).
- **PR [#3211](https://github.com/openrocket/openrocket/pull/3211)** adds a "Use Current
  Conditions" button to the launch conditions page. Its client is in `swing`
  (`currentconditions/OpenMeteoClient.java`). It fetches elevation, temperature, surface
  pressure, humidity, surface wind and gusts and up to 23 wind levels. It shows the values,
  their time and their source with a checkbox per field, and changes nothing until the user
  confirms. Reviewers asked for forecasts for a chosen date, not only current conditions,
  and raised the free tier's limits.

Our version follows #3211 where it has settled behavior and adds the dated forecast that
reviewers asked for. If #3211 changes before it merges, we follow it.

## Decisions taken

1. **Free by default, or the user's paid key.** Requests go from the user's browser straight
   to Open-Meteo. There is no key, account, proxy or server of ours in between. A user who has
   a paid Open-Meteo plan can enter the key in Settings, and requests then go to the paid
   endpoint.
2. **A forecast for a chosen date and hour,** current conditions included. Not current
   conditions only.

## Open-Meteo terms

- **Free tier:** no key, non-commercial use only, and limited to 600 calls a minute, 5,000 an
  hour, 10,000 a day and 300,000 a month. Open-Meteo counts a request for many variables as
  several calls. Their terms count private or non-profit apps without subscriptions or
  advertising as non-commercial, which describes this app while it stays free and ad-free.
- **Paid plans:** requests go to `customer-api.open-meteo.com` with `&apikey=<key>`. There is
  no free key. Prices are not published; Open-Meteo quotes them on request.
- **Attribution:** the data is CC BY 4.0 on every tier. The attribution has to be shown
  wherever the data is.

Sources: [terms](https://open-meteo.com/en/terms), [pricing](https://open-meteo.com/en/pricing).

The browser sends our site's address with every cross-origin request (the `Origin` header),
so Open-Meteo can see which site the calls come from. That cannot be removed, and the
referrer is not hidden either: a provider uses it to see who is calling, and hiding it is how
the OpenStreetMap tile server came to block the app.

## The service

New `web/src/services/weather/openMeteo.ts`.

**Endpoints.** Forecast (`/v1/forecast`), archive (`archive-api.open-meteo.com/v1/archive`)
and elevation (`/v1/elevation`). With a key, each goes to its `customer-` host with `apikey`
added. No geocoding: the launch-site map already sets the coordinates.

**Date window.** The forecast endpoint covers about 92 days back and 15 days ahead, with
every field. An earlier date goes to the archive, which has surface conditions but no winds
aloft. A date later than the forecast reaches is refused with a message that says why.

**Variables.** Hourly `temperature_2m`, `relative_humidity_2m`, `surface_pressure`,
`wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`; wind speed and direction at 80,
120 and 180 m above ground; and wind speed, wind direction and `geopotential_height` at the 19
pressure levels desktop uses (1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300,
250, 200, 150, 100, 70, 50 and 30 hPa). Units are requested explicitly (m/s, °C) and every unit
in the response is checked rather than assumed. A response in the wrong unit is an error, not
a conversion.

**Load.** Weather requests are spaced at least 5 s apart, as desktop does to stay under the
hourly limit. Answers are cached for 10 minutes per site, date and hour. Every request has a
timeout and can be cancelled when the dialog closes.

**Source.** mmrocket-sim's `openMeteo.ts` (GPLv3, as this project is) already covers the date
window, the archive fallback and unit checking. Port from it where it fits, rewritten to our
conventions, and credit it in the file header.

## Mapping to launch conditions

Every target already exists in `LaunchConditions` (`web/src/services/design/orkTree.ts`).

| Open-Meteo | Launch condition | Notes |
| --- | --- | --- |
| `temperature_2m` | `temperatureC` | |
| `surface_pressure` | `pressureHPa` | At the site, not sea level. |
| `relative_humidity_2m` | `relativeHumidity` | Percent to a fraction (0 to 1). |
| elevation | `launchAltitudeM` | Optional, off by default when the user has typed one. |
| 10 m wind | first `windLevels` entry | At site elevation plus 10 m. |
| 80, 120, 180 m wind | `windLevels` | At site elevation plus the height. |
| pressure-level wind | `windLevels` | At the level's geopotential height. |
| (all levels) | `windAltitudeReference` | `msl`. |

**Direction.** Open-Meteo gives the direction the wind blows FROM, in degrees. Check that
against what `windLevels[].directionDeg` means to the kernel before the first test is
written, and convert if they differ.

**Levels.** Sorted by altitude. A pressure level below the ground (its geopotential height
under the site elevation) is dropped, as are levels with a missing value.

**Turbulence.** Desktop's PR estimates the surface turbulence intensity from the gust spread:
`(gust - speed) / (3 × speed)`, clamped to 0.05 to 0.35, and 0.10 when the speed is under
0.1 m/s or the gust is not above it. Upper levels use a fixed 0.10. Our wind levels store a
standard deviation, so each level's `stddev` is its intensity times its speed.

**Single-wind fields.** With wind levels present the kernel flies the levels and ignores
`windAverage`, `windStdDev` and `windDirectionDeg`. Fill those from the 10 m sample anyway, so
that a user who later switches back to a single wind starts from the forecast rather than from
stale numbers.

**Results.** Launch conditions are already part of the result key
(`web/src/services/flight/simulations.ts`), so a simulation whose conditions are filled from
a forecast shows its old results as outdated without any extra wiring.

## The dialog

A "Weather" button on the launch conditions panel opens it.

- **Inputs:** date and hour, in the launch site's local time, defaulting to the next whole
  hour. The coordinates come from the launch conditions. Without coordinates, the dialog says
  to set the launch site first.
- **Fetch,** then show every value with its valid time, the endpoint it came from (forecast or
  archive), and a checkbox per field, as desktop does. Archive answers say they have no winds
  aloft.
- **Attribution:** "Weather data by Open-Meteo.com", linked, with the CC BY 4.0 license
  linked, shown in the dialog whenever data is shown.
- **Apply** writes only the ticked fields. Cancel writes nothing.
- **Offline or refused:** the message names the cause (no network, timeout, quota, a refused
  date, a bad key) and says the launch conditions are unchanged.

## Settings

An optional "Open-Meteo API key" field, with one line saying that the free service works
without one for non-commercial use, and that a key from a paid plan removes the limits.

The key is stored only in that browser. It is never written to a `.ork` save, a share link, a
session export or a crash file, and the request URL that carries it is never logged.

## Privacy and docs

- **Privacy dialog:** the launch-site coordinates and the chosen date go to Open-Meteo only
  when the user presses Fetch. Nothing is sent in the background.
- **Docs:** a page on getting weather, and its Spanish twin, which the Spanish build needs or
  it reports a broken link against the English file.
- **Comparison pages:** the OpenRocket comparison notes that desktop's version is still an
  open PR.

## Phases

1. **Service and mapping, no UI.** URL building (free and keyed), the date window, parsing with
   unit checks, the mapping and the turbulence estimate. Tested with recorded responses.
2. **Dialog** on the launch conditions panel, with the per-field checkboxes, attribution and
   error states.
3. **Settings** key field, and the checks that keep the key out of every export.
4. **Privacy dialog, docs and Spanish twin, CHANGELOG.**

## Tests

- URL building: the free host with no key, the `customer-` host with `apikey`, and every
  variable present.
- Date window: forecast, archive and refused dates, including a site whose local date differs
  from UTC.
- Parsing: a good response, a missing variable, a wrong unit, an error body.
- Mapping: level heights and order, a pressure level below the ground, the humidity fraction,
  the direction convention.
- Turbulence: each branch of the gust formula, and the clamps.
- The key never appears in a `.ork`, a share link or a session export.
- The dialog against a mocked fetch: apply only ticked fields, cancel writes nothing, and the
  attribution is shown.

## Not included

- **Temperature aloft.** The kernel keeps the standard atmosphere above the site, as desktop
  does today. Issue #2737 proposes the change upstream; if it lands in the kernel, we take it
  with the engine.
- **Device location.** Desktop's PR reads the computer's location; the launch-site map
  already sets ours.
- **Place search.** Same reason.

## Costs and risks

- **Shared free quota.** If Open-Meteo counts the free tier per site rather than per user,
  every user of a busy deployment shares one daily limit. The request spacing and the cache
  keep each user's load low, and a paid key takes a heavy user out of the shared pool.
- **Upstream may differ.** #3211 is not merged. If it changes how it maps gusts or levels,
  we change ours to match.
- **Forecast accuracy.** A model forecast is not a measurement. The dialog says it is a
  forecast and shows its valid time.

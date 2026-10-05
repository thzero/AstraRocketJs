import type { AtmosphereLevel, LaunchConditions, WindLevel } from '../design/orkTree';
import { usableAtmosphereLevels } from '../flight/atmosphereLevels';
import { usableWindLevels } from '../flight/windLevels';
import type { HourSample } from './openMeteo';

/**
 * One forecast hour as launch conditions, split into the groups the Weather
 * dialog offers one checkbox each. A group is absent when the hour has nothing
 * usable for it, so the dialog never offers to write a hole.
 *
 * The mapping follows desktop OpenRocket's current-conditions client (PR #3211):
 * the surface wind at 10 m above the site, the 80, 120 and 180 m winds above the
 * site, then each pressure level at its geopotential height, all as MSL wind
 * levels; turbulence estimated from the gust spread at the surface and a fixed
 * intensity above it.
 */

/** Turbulence intensity above the surface, where there is no gust figure. */
export const UPPER_AIR_TURBULENCE = 0.1;

/**
 * Surface turbulence intensity from the hourly gust: the spread between gust
 * and mean wind, over three standard deviations of the mean, held to 0.05..0.35.
 * 0.10 when the wind is near calm or the gust is not above it. Desktop
 * OpenRocket's `estimateTurbulenceIntensity`.
 */
export function turbulenceFromGust(speed: number, gust: number | null): number {
  if (speed <= 0.1 || gust === null || gust <= speed) return 0.1;
  return Math.max(0.05, Math.min(0.35, (gust - speed) / (3 * speed)));
}

export interface WeatherProposal {
  temperatureC?: number;
  pressureHPa?: number;
  /** A fraction, 0..1. */
  relativeHumidity?: number;
  /** The surface wind and the profile above it. */
  wind?: {
    surfaceSpeed: number;
    surfaceFromDeg: number;
    surfaceStdDev: number;
    gust: number | null;
    levels: WindLevel[];
  };
  /** The atmosphere above the site, one level per pressure level. */
  atmosphere?: AtmosphereLevel[];
}

export type ProposalGroup = 'temperature' | 'pressure' | 'humidity' | 'wind' | 'atmosphere';

/** The groups a proposal can fill, in the order the dialog lists them. */
export const PROPOSAL_GROUPS: readonly ProposalGroup[] = ['temperature', 'pressure', 'humidity', 'wind', 'atmosphere'];

/** Whether `proposal` has anything for `group`. */
export function hasGroup(p: WeatherProposal, group: ProposalGroup): boolean {
  switch (group) {
    case 'temperature':
      return p.temperatureC !== undefined;
    case 'pressure':
      return p.pressureHPa !== undefined;
    case 'humidity':
      return p.relativeHumidity !== undefined;
    case 'wind':
      return p.wind !== undefined;
    case 'atmosphere':
      return (p.atmosphere?.length ?? 0) > 0;
  }
}

/**
 * The proposal for one hour, answered for a pad at `elevationM` (meters above
 * sea level, the elevation the forecast was asked for).
 */
export function proposalFor(s: HourSample, elevationM: number): WeatherProposal {
  const p: WeatherProposal = {};
  if (s.temperatureC !== null) p.temperatureC = s.temperatureC;
  if (s.pressureHPa !== null && s.pressureHPa > 0) p.pressureHPa = s.pressureHPa;
  if (s.humidityPct !== null) p.relativeHumidity = Math.min(1, Math.max(0, s.humidityPct / 100));

  if (s.windSpeed !== null && s.windFromDeg !== null) {
    const surfaceTi = turbulenceFromGust(s.windSpeed, s.windGust);
    const raw: WindLevel[] = [
      { altitudeM: elevationM + 10, speed: s.windSpeed, directionDeg: s.windFromDeg, stddev: surfaceTi * s.windSpeed },
    ];
    for (const h of s.heightWinds) {
      if (h.speed !== null && h.speed >= 0 && h.fromDeg !== null) {
        raw.push({
          altitudeM: elevationM + h.heightM,
          speed: h.speed,
          directionDeg: h.fromDeg,
          stddev: UPPER_AIR_TURBULENCE * h.speed,
        });
      }
    }
    // Pressure levels only above the highest height wind: below it they are
    // the model's extrapolation into the ground layer the height winds cover.
    const top = Math.max(...raw.map((l) => l.altitudeM));
    for (const l of s.levels) {
      if (
        l.altitudeM !== null &&
        l.altitudeM > top &&
        l.windSpeed !== null &&
        l.windSpeed >= 0 &&
        l.windFromDeg !== null
      ) {
        raw.push({
          altitudeM: l.altitudeM,
          speed: l.windSpeed,
          directionDeg: l.windFromDeg,
          stddev: UPPER_AIR_TURBULENCE * l.windSpeed,
        });
      }
    }
    raw.sort((a, b) => a.altitudeM - b.altitudeM);
    p.wind = {
      surfaceSpeed: s.windSpeed,
      surfaceFromDeg: s.windFromDeg,
      surfaceStdDev: surfaceTi * s.windSpeed,
      gust: s.windGust,
      levels: usableWindLevels(raw),
    };
  }

  // The atmosphere above the pad. A level below or at the pad is the model's
  // extrapolation into the ground and is left out.
  const atmosphere = usableAtmosphereLevels(
    s.levels
      .filter((l) => l.altitudeM !== null && l.altitudeM > elevationM)
      .map((l) => ({
        altitudeM: l.altitudeM,
        temperatureC: l.temperatureC,
        pressureHPa: l.pressureHPa,
        relativeHumidity: l.humidityPct === null ? null : Math.min(1, Math.max(0, l.humidityPct / 100)),
      })),
  );
  if (atmosphere.length) p.atmosphere = atmosphere;
  return p;
}

/**
 * The launch-condition change for the ticked groups. Wind writes the profile
 * (MSL) and the single-wind fields from the surface, so switching back to one
 * wind later starts from the forecast rather than from stale numbers.
 */
export function proposalPatch(
  p: WeatherProposal,
  ticked: ReadonlySet<ProposalGroup>,
  elevation?: { launchAltitudeM: number },
): Partial<LaunchConditions> {
  const out: Partial<LaunchConditions> = {};
  if (ticked.has('temperature') && p.temperatureC !== undefined) out.temperatureC = round(p.temperatureC, 1);
  if (ticked.has('pressure') && p.pressureHPa !== undefined) out.pressureHPa = round(p.pressureHPa, 1);
  if (ticked.has('humidity') && p.relativeHumidity !== undefined) out.relativeHumidity = round(p.relativeHumidity, 2);
  if (ticked.has('wind') && p.wind) {
    out.windAverage = round(p.wind.surfaceSpeed, 2);
    out.windStdDev = round(p.wind.surfaceStdDev, 2);
    out.windDirectionDeg = round(p.wind.surfaceFromDeg, 0);
    out.windLevels = p.wind.levels;
    out.windAltitudeReference = 'msl';
  }
  if (ticked.has('atmosphere') && p.atmosphere?.length) out.atmosphereLevels = p.atmosphere;
  if (elevation) out.launchAltitudeM = elevation.launchAltitudeM;
  return out;
}

const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;

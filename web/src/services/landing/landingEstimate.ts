import { driftEllipse, type DriftEllipse } from '../flight/driftEllipse';
import type { GroundPoint } from '../flight/groundTrack';
import {
  fetchElevation,
  fetchWeather,
  sampleAt,
  type FetchOpts,
  type ForecastVariant,
  type WeatherAnswer,
} from '../weather/openMeteo';
import { proposalFor } from '../weather/weatherProposal';
import { descentDrift, type DescentPlan, type DriftResult, type WindLayer } from './descentDrift';
import { fetchTerrain, groundAt, type TerrainGrid } from './terrain';

/**
 * The Tools tab's landing estimate: one descent under the forecast wind for the
 * chosen hour, and a dispersion zone from the same descent repeated across what
 * is uncertain about it.
 *
 * What the zone varies, all at once (5 x 3 x 3 x 3 = 135 descents):
 *  - the forecast hour, two either side of the chosen one, for the wind
 *    changing over the launch window;
 *  - wind speed, 20 % either way, and direction, 15 degrees either way, for the
 *    forecast's own error;
 *  - the descent rates, 10 % either way, because here they are typed, not
 *    flown.
 * A two-sigma ellipse is fitted to the landings with the drift region's own
 * code (services/flight/driftEllipse).
 */

export const HOUR_OFFSETS = [-2, -1, 0, 1, 2] as const;
const SPEED_FACTORS = [0.8, 1, 1.2] as const;
const DIRECTION_OFFSETS_DEG = [-15, 0, 15] as const;
const RATE_FACTORS = [0.9, 1, 1.1] as const;

/** The wind profile for the hour starting at `unix`, from one forecast answer, or null. */
export function windAt(variant: ForecastVariant, unix: number): WindLayer[] | null {
  const sample = variant.samples.find((s) => s.unix === unix);
  if (!sample) return null;
  const levels = proposalFor(sample, variant.elevationM).wind?.levels;
  return levels?.length
    ? levels.map((l) => ({ altitudeM: l.altitudeM, speed: l.speed, fromDeg: l.directionDeg }))
    : null;
}

export interface LandingEstimate {
  /** The descent under the chosen hour's wind, as forecast. */
  nominal: DriftResult;
  /** Every descent's landing, the nominal one included. */
  samples: GroundPoint[];
  ellipse: DriftEllipse | null;
  /** The forecast hours that were in the answer and went into the zone. */
  hours: number;
}

/** The estimate for one answer and hour. Null when the answer has no wind for that hour. */
export function estimateLanding(q: {
  variant: ForecastVariant;
  validUnix: number;
  latitudeDeg: number;
  longitudeDeg: number;
  padElevationM: number;
  plan: DescentPlan;
  groundAt?: (latDeg: number, lonDeg: number) => number;
}): LandingEstimate | null {
  const base = { ...q, plan: q.plan };
  const chosen = windAt(q.variant, q.validUnix);
  if (!chosen) return null;
  const nominal = descentDrift({ ...base, wind: chosen });
  const samples: GroundPoint[] = [];
  let hours = 0;
  for (const dh of HOUR_OFFSETS) {
    const wind = dh === 0 ? chosen : windAt(q.variant, q.validUnix + dh * 3600);
    if (!wind) continue;
    hours++;
    for (const speedFactor of SPEED_FACTORS) {
      for (const directionOffsetDeg of DIRECTION_OFFSETS_DEG) {
        for (const rateFactor of RATE_FACTORS) {
          samples.push(descentDrift({ ...base, wind, speedFactor, directionOffsetDeg, rateFactor }).landing);
        }
      }
    }
  }
  return { nominal, samples, ellipse: driftEllipse(samples), hours };
}

/**
 * The terrain around the pad, re-based so its height AT the pad is the pad's:
 * the terrain model and a surveyed site altitude disagree by a few meters,
 * and without this a descent could end before reaching the pad's own ground.
 */
function relativeGround(grid: TerrainGrid, latDeg: number, lonDeg: number, padElevationM: number) {
  const g = groundAt(grid);
  const shift = padElevationM - g(latDeg, lonDeg);
  return (lat: number, lon: number) => g(lat, lon) + shift;
}

export interface LandingQuery {
  latitudeDeg: number;
  longitudeDeg: number;
  /** The pad, meters above sea level; null to take the terrain model's height. */
  padElevationM: number | null;
  date: string;
  hour: number;
  today: string;
  plan: DescentPlan;
  apiKey?: string;
}

export interface LandingRun {
  answer: WeatherAnswer;
  estimate: LandingEstimate;
  padElevationM: number;
  /** The forecast hour the nominal descent used. */
  validUnix: number;
  /** Whether the ground's shape was used, or flat ground at the pad's height (terrain lookup failed). */
  terrain: boolean;
}

/** Most the terrain grid reaches from the pad, meters: past this the drift is not a recovery. */
const MAX_TERRAIN_HALF_WIDTH_M = 30_000;

/**
 * A whole estimate: the pad's height if not given, the forecast, the landings
 * on flat ground to learn how far they reach, the terrain over that reach, and
 * the landings again on it. Throws `WeatherError` from the forecast; a failed
 * terrain lookup falls back to flat ground and says so.
 */
export async function runLandingEstimate(q: LandingQuery, o: FetchOpts = {}): Promise<LandingRun | 'noHour'> {
  const padElevationM = q.padElevationM ?? (await fetchElevation(q.latitudeDeg, q.longitudeDeg, q.apiKey, o)) ?? 0;
  const answer = await fetchWeather(
    {
      latitudeDeg: q.latitudeDeg,
      longitudeDeg: q.longitudeDeg,
      siteM: padElevationM,
      date: q.date,
      today: q.today,
      apiKey: q.apiKey,
    },
    o,
  );
  const variant = answer.variants[0]!;
  const sample = sampleAt(variant, answer.timezone, q.date, q.hour);
  if (!sample) return 'noHour';
  const base = {
    variant,
    validUnix: sample.unix,
    latitudeDeg: q.latitudeDeg,
    longitudeDeg: q.longitudeDeg,
    padElevationM,
    plan: q.plan,
  };
  const flat = estimateLanding(base);
  if (!flat) return 'noHour';

  const reach = Math.max(...flat.samples.map((p) => Math.hypot(p.east, p.north)), flat.nominal.distanceM);
  const halfWidth = Math.min(MAX_TERRAIN_HALF_WIDTH_M, Math.max(1000, reach * 1.5 + 500));
  let grid: TerrainGrid | null;
  try {
    grid = await fetchTerrain(q.latitudeDeg, q.longitudeDeg, halfWidth, q.apiKey, o);
  } catch (err) {
    if ((err as { kind?: string }).kind === 'aborted') throw err;
    grid = null;
  }
  const estimate = grid
    ? estimateLanding({ ...base, groundAt: relativeGround(grid, q.latitudeDeg, q.longitudeDeg, padElevationM) })!
    : flat;
  return { answer, estimate, padElevationM, validUnix: sample.unix, terrain: grid !== null };
}

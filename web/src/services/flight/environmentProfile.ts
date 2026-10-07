import type { FlightSeries } from '../../engine/openRocketEngine';

/**
 * The air a flight actually flew through, read off the series the kernel
 * records every step: wind speed and direction, temperature, pressure, density
 * and speed of sound. Nothing here is recomputed; whatever atmosphere and wind
 * model the run used (standard, site values, a forecast) is what comes back.
 *
 * Two things follow from the data being FLOWN rather than surveyed. The profile
 * covers only the band of altitude the rocket reached. And every altitude is
 * passed twice, on the way up and on the way down, at different times, so the
 * wind (which is turbulent) differs between the passes while the atmosphere
 * does not. The two passes are kept apart as `ascent` and `descent` rather
 * than drawn as one line through both.
 */

/** One recorded quantity against altitude above the pad, in SI. */
export interface ProfilePoint {
  /** Meters above the pad. */
  altitude: number;
  value: number;
}

export interface ProfileLegs {
  ascent: ProfilePoint[];
  descent: ProfilePoint[];
}

export type EnvironmentQuantity =
  'windSpeed' | 'windDirection' | 'temperature' | 'pressure' | 'density' | 'speedOfSound';

/** The kernel's series symbol for each quantity (FlightDataType.getSymbol()). */
const SERIES_KEY: Record<EnvironmentQuantity, string> = {
  windSpeed: 'Vw',
  windDirection: 'θw',
  temperature: 'T',
  pressure: 'P',
  density: 'ρ',
  speedOfSound: 'Vs',
};

export interface EnvironmentProfile {
  /** The first recorded sample: the air at the pad when the motor lit. */
  pad: Record<EnvironmentQuantity, number>;
  /** Meters above the pad at apogee, the top of every profile. */
  apogee: number;
  profiles: Record<EnvironmentQuantity, ProfileLegs>;
}

/** Most points drawn per leg; a long flight is thinned evenly to this. */
export const MAX_POINTS_PER_LEG = 400;

/**
 * The profile of one flight branch, or null when the series it needs are not
 * in the result (a result stored before these were recorded).
 */
export function environmentProfile(series: FlightSeries): EnvironmentProfile | null {
  const s = series as unknown as Record<string, readonly number[] | undefined>;
  const altitude = s['altitude'];
  if (!altitude?.length) return null;
  const columns = {} as Record<EnvironmentQuantity, readonly number[]>;
  for (const [q, key] of Object.entries(SERIES_KEY) as [EnvironmentQuantity, string][]) {
    const col = s[key];
    if (!col || col.length !== altitude.length) return null;
    columns[q] = col;
  }

  let top = 0;
  for (let i = 1; i < altitude.length; i++) if (altitude[i]! > altitude[top]!) top = i;

  const leg = (from: number, to: number, col: readonly number[]): ProfilePoint[] => {
    const n = to - from;
    const step = Math.max(1, Math.ceil(n / MAX_POINTS_PER_LEG));
    const out: ProfilePoint[] = [];
    for (let i = from; i < to; i += step) push(out, altitude[i]!, col[i]!);
    // Always end on the leg's last sample, so apogee is never thinned away.
    if (n > 0 && (n - 1) % step !== 0) push(out, altitude[to - 1]!, col[to - 1]!);
    return out;
  };

  const profiles = {} as Record<EnvironmentQuantity, ProfileLegs>;
  const pad = {} as Record<EnvironmentQuantity, number>;
  for (const q of Object.keys(SERIES_KEY) as EnvironmentQuantity[]) {
    const col = columns[q];
    profiles[q] = { ascent: leg(0, top + 1, col), descent: leg(top, altitude.length, col) };
    pad[q] = col[0]!;
  }
  return { pad, apogee: altitude[top]!, profiles };
}

/** Finite samples only: a NaN in a recorded series is a gap, not a value. */
function push(out: ProfilePoint[], altitude: number, value: number): void {
  if (Number.isFinite(altitude) && Number.isFinite(value)) out.push({ altitude, value });
}

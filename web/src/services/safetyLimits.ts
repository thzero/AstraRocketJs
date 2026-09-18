import type { LaunchConditions } from './orkTree';

/**
 * Flying limits from the NAR / Tripoli safety codes, in SI.
 *
 * These are about the FLIGHT, not the rocket: launch conditions are simulation
 * settings, so a `.ork` that carries conditions outside them is not a design to
 * be preserved as authored — it is a run this app will not fly. The import says
 * so and the Run button refuses until the conditions are brought inside.
 *
 * Both codes state the numbers in imperial, which is why the metric values here
 * are exact conversions rather than round figures.
 */

/** Launcher pointed within 20 degrees of vertical. */
export const MAX_ROD_ANGLE_DEG = 20;

/** No launch in winds above 20 mph. */
export const MAX_WIND_SPEED_MPH = 20;

const MPH_TO_MS = 0.44704;

export const MAX_ROD_ANGLE_RAD = (MAX_ROD_ANGLE_DEG * Math.PI) / 180;
export const MAX_WIND_SPEED_MS = MAX_WIND_SPEED_MPH * MPH_TO_MS;

export interface LimitViolation {
  field: 'rodAngle' | 'windSpeed';
  /** The offending value, in the unit the safety code states: degrees, or mph. */
  value: number;
  /** The cap, same unit. */
  limit: number;
}

/**
 * The wind at the pad, in m/s.
 *
 * A multilevel profile REPLACES the single wind at the engine (see
 * `simConditions`), and its GROUND layer is the one the limit is about: the
 * codes are a go/no-go call made from what you can measure at the pad, and
 * nobody is metering the wind at 500 m. Levels are not kept sorted, so the
 * ground layer is the lowest altitude rather than the first entry.
 */
function surfaceWindMs(launch: LaunchConditions): number {
  const levels = launch.windLevels ?? [];
  if (!levels.length) return launch.windAverage ?? 0;
  return levels.reduce((low, l) => (l.altitudeM < low.altitudeM ? l : low), levels[0]!).speed;
}

/**
 * Every way a set of launch conditions falls outside the codes.
 *
 * Only the wind AT THE PAD is judged (see `surfaceWindMs`) — winds aloft are not
 * something a launch is called on, because they are not something anyone at the
 * field measures. Gust standard deviation is left alone for a related reason:
 * the codes speak about wind speed, and a mean inside the limit with gusts above
 * it is a judgement call this is not equipped to make.
 */
export function launchLimitViolations(launch: LaunchConditions): LimitViolation[] {
  const out: LimitViolation[] = [];

  const angle = Math.abs(launch.launchRodAngleDeg ?? 0);
  if (angle > MAX_ROD_ANGLE_DEG) {
    out.push({ field: 'rodAngle', value: angle, limit: MAX_ROD_ANGLE_DEG });
  }

  const wind = surfaceWindMs(launch);
  if (wind > MAX_WIND_SPEED_MS) {
    out.push({ field: 'windSpeed', value: wind / MPH_TO_MS, limit: MAX_WIND_SPEED_MPH });
  }

  return out;
}

/**
 * One violation as a sentence.
 *
 * Reported in the code's OWN units (degrees, mph) rather than the user's
 * display units: the limit is a quoted rule, and quoting it in whatever unit the
 * reader happens to have selected makes the number stop matching the source.
 */
export function limitText(v: LimitViolation, t: (key: string, vars: Record<string, unknown>) => string): string {
  const vars = { value: Math.round(v.value * 10) / 10, limit: v.limit };
  return t(v.field === 'rodAngle' ? 'limits.rodAngle' : 'limits.wind', vars);
}

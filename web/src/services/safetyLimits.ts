import type { LaunchConditions, WindLevel } from './orkTree';
import { fmtUpTo, ladderDigits, withUnit } from '../i18n/format';
import { siToUi, type Quantity, type UnitSymbols } from '../prefs/units';

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

/** No launch in winds above 20 mph. Not exported: the cap leaves this file in
 *  SI, because nothing outside it now speaks the codes' own unit. */
const MAX_WIND_SPEED_MPH = 20;

const MPH_TO_MS = 0.44704;

export const MAX_ROD_ANGLE_RAD = (MAX_ROD_ANGLE_DEG * Math.PI) / 180;
export const MAX_WIND_SPEED_MS = MAX_WIND_SPEED_MPH * MPH_TO_MS;

export interface LimitViolation {
  field: 'rodAngle' | 'windSpeed';
  /** The offending value, in SI: radians, or m/s. */
  value: number;
  /** The cap, same unit. */
  limit: number;
}

/**
 * The GROUND layer of a multilevel wind profile, or `undefined` when the
 * launch has no profile.
 *
 * Levels are not kept sorted (a CSV or a `.ork` can list them top-down), so
 * the surface is the LOWEST altitude, not the first entry. `simulations.ts`
 * used to take `windLevels[0]` for the "launch into the wind" heading while
 * this file took the lowest, so a top-down profile aimed the rod at the wind
 * aloft and judged the safety code on the wind at the pad. One reader.
 */
export function surfaceLevel(launch: LaunchConditions): WindLevel | undefined {
  const levels = launch.windLevels ?? [];
  if (!levels.length) return undefined;
  return levels.reduce((low, l) => (l.altitudeM < low.altitudeM ? l : low), levels[0]!);
}

/**
 * The wind at the pad, in m/s.
 *
 * A multilevel profile REPLACES the single wind at the engine (see
 * `simConditions`), and its GROUND layer is the one the limit is about: the
 * codes are a go/no-go call made from what you can measure at the pad, and
 * nobody is metering the wind at 500 m.
 */
function surfaceWindMs(launch: LaunchConditions): number {
  return surfaceLevel(launch)?.speed ?? launch.windAverage ?? 0;
}

/**
 * Every way a set of launch conditions falls outside the codes.
 *
 * Only the wind AT THE PAD is judged (see `surfaceWindMs`) — winds aloft are not
 * something a launch is called on, because they are not something anyone at the
 * field measures. Gust standard deviation is left alone for a related reason:
 * the codes speak about wind speed, and a mean inside the limit with gusts above
 * it is a judgment call this is not equipped to make.
 */
export function launchLimitViolations(launch: LaunchConditions): LimitViolation[] {
  const out: LimitViolation[] = [];

  const angle = Math.abs(launch.launchRodAngleDeg ?? 0);
  if (angle > MAX_ROD_ANGLE_DEG) {
    out.push({ field: 'rodAngle', value: (angle * Math.PI) / 180, limit: MAX_ROD_ANGLE_RAD });
  }

  const wind = surfaceWindMs(launch);
  if (wind > MAX_WIND_SPEED_MS) {
    out.push({ field: 'windSpeed', value: wind, limit: MAX_WIND_SPEED_MS });
  }

  return out;
}

/**
 * One violation as a sentence, in the units the reader has selected.
 *
 * Both codes state their numbers in imperial, and this used to quote them that
 * way so the figure matched the source. That put "20 mph" in front of a reader
 * whose every other readout is m/s, which is a rule they then have to convert
 * before they can act on it — so both the offending value and the cap are
 * converted, and the symbol travels with each number rather than sitting in the
 * translated sentence.
 *
 * `u` is passed in rather than read here: see {@link UnitSymbols}.
 */
export function limitText(
  v: LimitViolation,
  t: (key: string, vars: Record<string, unknown>) => string,
  u: UnitSymbols,
): string {
  const quantity: Quantity = v.field === 'rodAngle' ? 'angle' : 'windspeed';
  const sym = u.sym(quantity);
  const ui = (si: number) => siToUi(quantity, sym, si);
  // One precision for both numbers, taken from the larger: "30.4°" beside
  // "20.0°" in the same sentence reads as two rules stated to different
  // accuracies, when the second is exact.
  const digits = ladderDigits(Math.max(Math.abs(ui(v.value)), Math.abs(ui(v.limit))));
  const show = (si: number) => withUnit(fmtUpTo(ui(si), digits), sym);
  return t(v.field === 'rodAngle' ? 'limits.rodAngle' : 'limits.wind', {
    value: show(v.value),
    limit: show(v.limit),
  });
}

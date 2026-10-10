import type { LaunchConditions } from '../design/orkTree';
import { padLevelWind } from './windLevels';
import { fmtUpTo, ladderDigits, withUnit } from '../../i18n/format';
import { degToRad, type Quantity, siToUi, uiToSi, type UnitSymbols } from '../../prefs/units';

/**
 * Flying limits from the NAR / Tripoli safety codes, in SI.
 *
 * These are about the flight, not the rocket: launch conditions are simulation
 * settings, so a `.ork` that carries conditions outside them is not a design to
 * be preserved as authored; it is a run this app will not fly. The import says
 * so and the Run button refuses until the conditions are brought inside.
 *
 * Both codes state the numbers in imperial, which is why the metric values here
 * are exact conversions rather than round figures.
 */

/** Launcher pointed within 20 degrees of vertical. */
export const MAX_ROD_ANGLE_DEG = 20;

/** No launch in winds above 20 mph. Not exported: the cap leaves this file in
 *  SI, because nothing outside it uses the codes' own unit. */
const MAX_WIND_SPEED_MPH = 20;

const MPH_TO_MS = uiToSi('windspeed', 'mph', 1);

export const MAX_ROD_ANGLE_RAD = degToRad(MAX_ROD_ANGLE_DEG);
export const MAX_WIND_SPEED_MS = MAX_WIND_SPEED_MPH * MPH_TO_MS;

/**
 * Ceiling on turbulence intensity, as the percentage the fields show.
 *
 * `turbulenceLevel`'s top rung is "extreme" at 25%. 100% is a scatter equal to
 * the mean wind (four times past that rung) and is where the percentage field
 * stops, so the percentage and the standard deviation it stands for cannot be
 * driven apart by typing into an unbounded field.
 *
 * The wind's standard deviation is bounded by `MAX_WIND_SPEED_MS` itself, not by
 * a constant of its own: a scatter larger than the largest wind the codes allow
 * is not a wind condition. No code states a figure for it, so a second number
 * here would be an invented limit.
 */
export const MAX_TURBULENCE_PERCENT = 100;

export interface LimitViolation {
  field: 'rodAngle' | 'windSpeed';
  /** The offending value, in SI: radians, or m/s. */
  value: number;
  /** The cap, same unit. */
  limit: number;
}

/**
 * The wind at the pad, in m/s.
 *
 * A multilevel profile replaces the single wind at the engine (see
 * `simConditions`), and its wind at the pad is the one the limit is about (see
 * `padLevelWind`): the codes are a go/no-go call made from what you can measure
 * at the pad, and nobody is metering the wind at 500 m. A negative speed flies
 * as its magnitude, so it is judged as one.
 */
function surfaceWindMs(launch: LaunchConditions): number {
  return padLevelWind(launch)?.speedMs ?? Math.abs(launch.windAverage ?? 0);
}

/**
 * Every way a set of launch conditions falls outside the codes.
 *
 * Only the wind at the pad is judged (see `surfaceWindMs`); winds aloft are not
 * something a launch is called on, because they are not something anyone at the
 * field measures. Gust standard deviation is left alone for a related reason:
 * the codes speak about wind speed, and a mean inside the limit with gusts above
 * it is a judgment call this is not equipped to make.
 */
export function launchLimitViolations(launch: LaunchConditions): LimitViolation[] {
  const out: LimitViolation[] = [];

  const angle = Math.abs(launch.launchRodAngleDeg ?? 0);
  if (angle > MAX_ROD_ANGLE_DEG) {
    out.push({ field: 'rodAngle', value: degToRad(angle), limit: MAX_ROD_ANGLE_RAD });
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
 * Both codes state their numbers in imperial. Quoted that way the figure matches
 * the source but puts "20 mph" in front of a reader whose every other readout is
 * m/s, leaving them to convert a rule before they can act on it. So both the
 * offending value and the cap are converted, and the symbol travels with each
 * number rather than sitting in the translated sentence.
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

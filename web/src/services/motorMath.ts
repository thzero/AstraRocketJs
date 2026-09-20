import type { CatalogMotor } from './motorDb';

/**
 * Standard gravity, m/s^2: the 1901 General Conference on Weights and Measures value (ISO 80000-3),
 * which is also what OpenRocket's kernel and thrustcurve.org use when they turn
 * total impulse and propellant weight into a specific impulse.
 *
 * Defined once here. It used to be spelled out in MotorDashboard, MotorDetail
 * and LaunchPanel separately (recoverySizing.ts keeps a private copy for the
 * ISA pressure ladder, which is a different formula and deliberately its own).
 */
export const G0 = 9.80665;

/** [time (s), thrust (N)] */
export type ThrustSample = readonly [number, number];

/**
 * Average thrust of a catalog motor: the certified figure when the catalog
 * has one, else total impulse over burn time (0 for a zero burn, so a sort or
 * a cell never sees a division by zero).
 */
export const avgThrustOf = (m: CatalogMotor): number => m.avgThrust ?? (m.burn > 0 ? m.impulse / m.burn : 0);

/** Specific impulse (s): total impulse per unit propellant weight. NaN if the propellant mass is unknown. */
export const ispOf = (m: CatalogMotor): number => (m.propWeightG ? m.impulse / ((m.propWeightG / 1000) * G0) : NaN);

/** Propellant mass fraction (%): propellant over loaded mass. NaN if either is unknown. */
export const massFracOf = (m: CatalogMotor): number => (m.propWeightG && m.mass ? (m.propWeightG / m.mass) * 100 : NaN);

/**
 * What a thrust curve says about itself: total impulse by the trapezoid rule,
 * burn time as the last sample's time, the average over that burn, and the
 * peak. Every figure is 0 for an empty curve.
 */
export function curveStats(samples: readonly ThrustSample[]): {
  impulse: number;
  burn: number;
  avg: number;
  max: number;
} {
  let impulse = 0;
  for (let i = 1; i < samples.length; i++) {
    impulse += ((samples[i]![0] - samples[i - 1]![0]) * (samples[i]![1] + samples[i - 1]![1])) / 2;
  }
  const burn = samples.length ? samples[samples.length - 1]![0] : 0;
  const avg = burn > 0 ? impulse / burn : 0;
  let max = 0;
  for (const s of samples) if (s[1] > max) max = s[1];
  return { impulse, burn, avg, max };
}

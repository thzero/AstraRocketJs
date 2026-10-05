import { G0 } from '../motors/motorMath';

/**
 * Off the rail, for a rocket that has not been designed here: a motor's thrust
 * and mass curves, the rest of the rocket's mass and a rail length give the
 * speed it leaves the rail at, and with a wind, the angle it weathercocks to.
 *
 * Point mass along a vertical rail, with no drag and no rail friction. Both make
 * the real exit slower, so this errs fast. A designed rocket gets these figures from the engine on
 * its rail departure event instead.
 */

/** Integration step, s. Rail exits take tenths of a second. */
const DT = 0.0005;

/** No rail exit is slower than this; past it the rocket has stalled on the rail. */
const MAX_RAIL_TIME_S = 10;

/** Steepest weathercock angle the usual rule accepts at rail exit, degrees. */
export const WEATHERCOCK_LIMIT_DEG = 20;

/** The usual minimum average thrust-to-weight. */
export const MIN_THRUST_TO_WEIGHT = 5;

export interface RailMotor {
  /** s */
  times: number[];
  /** N */
  thrusts: number[];
  /** Motor mass at each time, kg. */
  masses: number[];
}

export interface RailInput {
  motor: RailMotor;
  /** The rocket without its motor, kg. */
  dryMassKg: number;
  railLengthM: number;
}

export interface RailExit {
  liftoffMassKg: number;
  /** Mean thrust over the burn ÷ liftoff weight. */
  thrustToWeightAverage: number;
  /** Highest thrust ÷ liftoff weight. */
  thrustToWeightPeak: number;
  /** Thrust ÷ weight at the moment it leaves the rail, as the engine reports it. */
  thrustToWeightAtExit: number;
  /** When the thrust first exceeds the weight, s after ignition. */
  liftoffS: number;
  /** When it leaves the rail, s after ignition. */
  exitS: number;
  /** m/s */
  exitSpeedMs: number;
}

/** Why the rocket never leaves the rail. */
export type RailFailure = 'noLiftoff' | 'stalls';

/** Linear interpolation of `ys` over `xs` at `x`; zero past either end. */
function at(xs: number[], ys: number[], x: number, outside = 0): number {
  if (xs.length === 0 || x < xs[0]! || x > xs[xs.length - 1]!) return outside;
  let i = 1;
  while (i < xs.length - 1 && xs[i]! < x) i++;
  const x0 = xs[i - 1]!;
  const x1 = xs[i]!;
  if (x1 <= x0) return ys[i]!;
  return ys[i - 1]! + ((ys[i]! - ys[i - 1]!) * (x - x0)) / (x1 - x0);
}

function motorMassAt(m: RailMotor, t: number): number {
  if (m.masses.length === 0) return 0;
  if (t >= m.times[m.times.length - 1]!) return m.masses[m.masses.length - 1]!;
  return at(m.times, m.masses, Math.max(t, m.times[0]!), m.masses[0]!);
}

/** Mean thrust over the burn, N. */
function averageThrust(m: RailMotor): number {
  let impulse = 0;
  for (let i = 1; i < m.times.length; i++) {
    impulse += ((m.times[i]! - m.times[i - 1]!) * (m.thrusts[i]! + m.thrusts[i - 1]!)) / 2;
  }
  const burn = m.times[m.times.length - 1]! - m.times[0]!;
  return burn > 0 ? impulse / burn : 0;
}

export function railExit(input: RailInput): RailExit | RailFailure {
  const { motor, dryMassKg, railLengthM } = input;
  const liftoffMassKg = dryMassKg + (motor.masses[0] ?? 0);
  const weight = liftoffMassKg * G0;
  let t = motor.times[0] ?? 0;
  let s = 0;
  let v = 0;
  let liftoffS: number | null = null;
  while (t < MAX_RAIL_TIME_S) {
    const thrust = at(motor.times, motor.thrusts, t);
    const mass = dryMassKg + motorMassAt(motor, t);
    // Before liftoff the rail holds it up, so the net force cannot be negative.
    const a = thrust / mass - G0;
    if (liftoffS === null) {
      if (a <= 0) {
        if (t > motor.times[motor.times.length - 1]!) return 'noLiftoff';
        t += DT;
        continue;
      }
      liftoffS = t;
    }
    v += a * DT;
    if (v <= 0) return 'stalls';
    s += v * DT;
    t += DT;
    if (s >= railLengthM) {
      return {
        liftoffMassKg,
        thrustToWeightAverage: averageThrust(motor) / weight,
        thrustToWeightPeak: Math.max(...motor.thrusts) / weight,
        thrustToWeightAtExit: at(motor.times, motor.thrusts, t) / ((dryMassKg + motorMassAt(motor, t)) * G0),
        liftoffS,
        exitS: t,
        exitSpeedMs: v,
      };
    }
  }
  return liftoffS === null ? 'noLiftoff' : 'stalls';
}

/** The angle a rocket leaving the rail at `exitSpeedMs` turns into a crosswind, degrees. */
export function weathercockDeg(windMs: number, exitSpeedMs: number): number {
  return (Math.atan2(Math.max(0, windMs), exitSpeedMs) * 180) / Math.PI;
}

/** The strongest wind that keeps the weathercock angle at or under the limit, m/s. */
export function maxWindMs(exitSpeedMs: number, limitDeg = WEATHERCOCK_LIMIT_DEG): number {
  return exitSpeedMs * Math.tan((limitDeg * Math.PI) / 180);
}

/**
 * The heaviest rocket (without its motor) that still leaves the rail at
 * `minExitMs` or faster and meets the average thrust-to-weight minimum, kg.
 * Null when even an empty airframe cannot.
 */
export function maxDryMassKg(
  motor: RailMotor,
  railLengthM: number,
  minExitMs: number,
  minThrustToWeight = MIN_THRUST_TO_WEIGHT,
): number | null {
  const ok = (dry: number) => {
    const r = railExit({ motor, dryMassKg: dry, railLengthM });
    return typeof r !== 'string' && r.exitSpeedMs >= minExitMs && r.thrustToWeightAverage >= minThrustToWeight;
  };
  if (!ok(0)) return null;
  // The thrust-to-weight bound alone caps it, so the search has a finite top.
  let hi = averageThrust(motor) / (minThrustToWeight * G0) - (motor.masses[0] ?? 0);
  if (ok(hi)) return hi;
  let lo = 0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

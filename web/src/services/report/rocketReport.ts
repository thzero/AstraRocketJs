import { motorStatistics, type MotorSpec } from '../../engine/openRocketEngine';
import { impulseClass } from '../motors/motorCombine';
import { motorName } from '../motors/motorName';
import { curveStats } from '../motors/motorMath';

/**
 * Report computations: the numbers that back the print/export rocket report.
 * Pure and unit-agnostic (SI in, SI out); the view formats + labels them.
 */

export interface MotorStats {
  designation: string;
  manufacturer?: string;
  /** Average thrust over the burn (N). */
  avgThrust: number;
  /** Peak thrust (N). */
  maxThrust: number;
  /** Burn time (s). */
  burnTime: number;
  /** Total impulse (N·s). */
  totalImpulse: number;
  /** NAR/TRA impulse class letter. */
  impulseClass: string;
  /** Loaded motor mass (kg). */
  weight: number;
  /** Case diameter (m). */
  diameter: number;
  /** Case length (m). */
  length: number;
}

/** Thrust-curve summary for one motor. */
export function motorStats(spec: MotorSpec): MotorStats {
  // The kernel's figures (ThrustCurveMotor.computeStatistics), as desktop's
  // motor table prints them: the burn between the crossings of 5% of peak,
  // not to the last sample. A report is assembled with the engine running.
  // A curve the kernel builds no motor from has no burn or average to state:
  // those print as no value, and the impulse and peak are the curve's own.
  const curve = spec.times.map((t, i) => [t, spec.thrusts[i] ?? 0] as [number, number]);
  const kernel = motorStatistics(curve);
  const own = curveStats(curve);
  const impulse = kernel?.totalImpulse ?? own.impulse;
  return {
    designation: motorName(spec),
    manufacturer: spec.manufacturer,
    avgThrust: kernel?.averageThrust ?? NaN,
    maxThrust: kernel?.maxThrust ?? own.max,
    burnTime: kernel?.burnTime ?? NaN,
    totalImpulse: impulse,
    impulseClass: impulseClass(impulse),
    weight: spec.masses?.length ? spec.masses[0]! : 0,
    diameter: spec.diameter,
    length: spec.length,
  };
}

import type { MotorSpec } from '../../engine/openRocketEngine';
import { impulseClass } from '../motors/motorCombine';
import { curveStats } from '../motors/motorMath';
import { motorName } from '../motors/motorName';

/**
 * Report computations — the numbers that back the print/export rocket report.
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
  // A loop for the peak, not Math.max(...thrusts): spreading a very long curve
  // into arguments overflows the stack.
  const stats = curveStats(spec.times.map((t, i) => [t, spec.thrusts[i] ?? 0]));
  return {
    designation: motorName(spec),
    manufacturer: spec.manufacturer,
    avgThrust: stats.avg,
    maxThrust: stats.max,
    burnTime: stats.burn,
    totalImpulse: stats.impulse,
    impulseClass: impulseClass(stats.impulse),
    weight: spec.masses?.length ? spec.masses[0]! : 0,
    diameter: spec.diameter,
    length: spec.length,
  };
}

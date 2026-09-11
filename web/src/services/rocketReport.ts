import type { MotorSpec } from '../engine/openRocketEngine';
import { impulse, impulseClass, type Sample } from './motorCombine';

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
  const samples: Sample[] = spec.times.map((t, i) => [t, spec.thrusts[i] ?? 0]);
  const totalImpulse = impulse(samples);
  const burnTime = spec.times.length ? spec.times[spec.times.length - 1]! : 0;
  return {
    designation: spec.designation,
    manufacturer: spec.manufacturer,
    avgThrust: burnTime > 0 ? totalImpulse / burnTime : 0,
    maxThrust: spec.thrusts.length ? Math.max(...spec.thrusts) : 0,
    burnTime,
    totalImpulse,
    impulseClass: impulseClass(totalImpulse),
    weight: spec.masses?.length ? spec.masses[0]! : 0,
    diameter: spec.diameter,
    length: spec.length,
  };
}

/** Thrust-to-weight of a motor stack lifting a loaded mass (dimensionless). */
export function thrustToWeight(avgThrustN: number, loadedMassKg: number): number {
  const w = loadedMassKg * 9.80665;
  return w > 0 ? avgThrustN / w : 0;
}

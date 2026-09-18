import type { MotorSpec } from '../engine/openRocketEngine';
import type { Simulation } from './simulations';
import { launchLimitViolations, limitText, type LimitViolation } from './safetyLimits';
import { missingRequired, type RequiredLaunchKey } from './requiredLaunch';

/**
 * Why a given simulation cannot be flown — asked in ONE place, so the Run
 * button and the run loop cannot disagree about it.
 *
 * They used to. The button judged a batch on the ACTIVE simulation's motor
 * alone (and only when exactly one row was selected), while the loop checked
 * every row and skipped the bad ones; and on safety limits the button blocked
 * the whole batch while the loop skipped only the offending row. So a batch
 * could be refused outright over one bad row, and a batch with an unflyable row
 * could be started with the button showing nothing wrong.
 */

/** A motor is usable only if it carries a full thrust curve (time/thrust/mass samples). */
export const hasThrustCurve = (m: MotorSpec | undefined | null): boolean =>
  !!(m && m.times?.length && m.thrusts?.length && m.masses?.length);

export type UnflyableReason =
  | { kind: 'noMotor' }
  | { kind: 'incomplete'; missing: RequiredLaunchKey[] }
  | { kind: 'limits'; violations: LimitViolation[] };

export interface Unflyable {
  id: string;
  name: string;
  reason: UnflyableReason;
}

/**
 * Why this one simulation cannot fly, or null when it can.
 *
 * Motor first: a row with no usable motor cannot fly whatever its launch
 * conditions say, and reporting the conditions of a rocket that has no engine
 * would be noise.
 */
export function unflyable(sim: Simulation): UnflyableReason | null {
  if (!hasThrustCurve(sim.motor)) return { kind: 'noMotor' };
  // Before the safety codes, because a code is judged ON these numbers: a blank
  // rod angle is not "within 20 degrees of vertical", it is nothing to judge.
  const missing = missingRequired(sim.launch);
  if (missing.length) return { kind: 'incomplete', missing };
  const violations = launchLimitViolations(sim.launch);
  return violations.length ? { kind: 'limits', violations } : null;
}

/** Every simulation in `sims` that cannot fly, in the order given. */
export function unflyableSims(sims: Simulation[]): Unflyable[] {
  const out: Unflyable[] = [];
  for (const sim of sims) {
    const reason = unflyable(sim);
    if (reason) out.push({ id: sim.id, name: sim.name, reason });
  }
  return out;
}

/**
 * One row's refusal as a sentence, naming the simulation.
 *
 * Named even when only one row is involved: these messages are also what a
 * finished batch reports, where "no motor" on its own leaves the reader to
 * guess which of six rows it meant.
 */
export function unflyableText(u: Unflyable, t: (key: string, vars?: Record<string, unknown>) => string): string {
  if (u.reason.kind === 'noMotor') return t('sim.noMotorNamed', { name: u.name });
  if (u.reason.kind === 'incomplete') {
    // Named, so the message points at the fields to go and fill rather than
    // just asserting that something is wrong somewhere.
    const fields = u.reason.missing.map((k) => t(`launch.field.${k}`)).join(', ');
    return t('sim.incomplete', { name: u.name, fields });
  }
  return `${t('limits.refused', { name: u.name })} ${u.reason.violations.map((v) => limitText(v, t)).join(' ')}`;
}

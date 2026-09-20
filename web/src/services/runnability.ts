import type { MotorSpec } from '../engine/openRocketEngine';
import type { Simulation } from './simulations';
import { launchLimitViolations, limitText, type LimitViolation } from './safetyLimits';
import { missingRequired, type RequiredLaunchKey } from './requiredLaunch';
import { badDimensions, type BadDimension } from './requiredComponent';
import { findMounts } from './treeEdit';
import { hasUsableCurve } from './motorCurve';
import type { RocketTree } from '../engine/openRocketEngine';

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

/**
 * A motor is usable only if it carries a full thrust curve.
 *
 * The one predicate in `motorCurve.ts`, which is also what the builder seats
 * a motor by. This used to accept any non-empty arrays, so a one-sample motor
 * passed the Run button and then left the mount empty at build time.
 */
export const hasThrustCurve = (m: MotorSpec | undefined | null): boolean => hasUsableCurve(m);

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

/**
 * Why NO simulation of this design can fly.
 *
 * Separate from {@link unflyable} because these are facts about the ROCKET, not
 * about one row: every simulation shares the tree, so there is no "skip the bad
 * one and fly the rest" here. A design with a zero-radius body tube used to
 * simulate happily and hand back an apogee, which is a worse answer than none.
 */
export type DesignBlocker = { kind: 'noMount' } | { kind: 'badGeometry'; bad: BadDimension[] };

export function designBlocker(tree: RocketTree): DesignBlocker | null {
  // No mount first: with nowhere to seat a motor there is no flight to discuss,
  // whatever else the geometry says.
  if (findMounts(tree).length === 0) return { kind: 'noMount' };
  const bad = badDimensions(tree);
  return bad.length ? { kind: 'badGeometry', bad } : null;
}

/**
 * A design blocker as a sentence, naming each part and what it is missing.
 *
 * Grouped by part rather than one line per field: a tube with its radius AND
 * thickness zeroed is one thing to go and fix, not two.
 */
export function designBlockerText(
  b: DesignBlocker,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string {
  if (b.kind === 'noMount') return t('sim.noMount');
  const byPart = new Map<string, string[]>();
  for (const d of b.bad) {
    // An unnamed part falls back to its TYPE, which is a bare token like
    // "bodytube"; translate that rather than printing it at the user.
    const name = d.name === d.type ? t(`part.${d.type}`) : d.name;
    const fields = byPart.get(name) ?? [];
    fields.push(t(`part.field.${d.field}`));
    byPart.set(name, fields);
  }
  const parts = [...byPart].map(([name, fields]) => `"${name}" (${fields.join(', ')})`).join('; ');
  return t('sim.badGeometry', { parts });
}

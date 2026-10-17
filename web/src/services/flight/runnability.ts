import type { MotorSpec } from '../../engine/openRocketEngine';
import type { Simulation } from './simulations';
import { launchLimitViolations, limitText, type LimitViolation } from './safetyLimits';
import type { PowerClass } from './powerClass';
import type { UnitSymbols } from '../../prefs/units';
import { missingRequired, type RequiredLaunchKey } from './requiredLaunch';
import { badDimensions, overturnedFins, type BadDimension, type NamedPart } from '../design/requiredComponent';
import { findMounts } from '../design/treeEdit';
import { duplicateAltitudeRows } from './windLevels';
import { hasUsableCurve } from '../motors/motorCurve';
import type { RocketTree } from '../../engine/openRocketEngine';
import { fmtList, partLabel } from '../../i18n/format';
import { keyedText, type Keyed } from '../../i18n/keyedError';

/**
 * Why a given simulation cannot be flown, asked in one place so the Run button
 * and the run loop cannot disagree about it. Judged apart, they diverge on which
 * rows a batch is judged by and on whether a limit blocks the batch or skips the
 * row, which shows up as a batch refused over one bad row, or a batch with an
 * unflyable row started with the button showing nothing wrong.
 */

/**
 * A motor is usable only if it carries a full thrust curve.
 *
 * The one predicate in `motorCurve.ts`, which is also what the builder seats a
 * motor by. Accepting any non-empty arrays instead would pass a one-sample motor
 * through the Run button and then leave the mount empty at build time.
 */
export const hasThrustCurve = (m: MotorSpec | undefined | null): boolean => hasUsableCurve(m);

export type UnflyableReason =
  | { kind: 'noMotor' }
  | { kind: 'incomplete'; missing: RequiredLaunchKey[] }
  /** Two wind levels at one altitude: a profile the kernel will not build. */
  | { kind: 'windProfile' }
  | { kind: 'limits'; violations: LimitViolation[] };

export interface Unflyable {
  id: string;
  name: string;
  reason: UnflyableReason;
}

/**
 * Why this one simulation cannot fly, or null when it can. `cls` is the class
 * of the rocket its configuration flies (`configPowerClass`), which decides the
 * launcher angle the codes allow.
 *
 * Motor first: a row with no usable motor cannot fly whatever its launch
 * conditions say, and reporting the conditions of a rocket that has no engine
 * would be noise.
 */
export function unflyable(sim: Simulation, motor: MotorSpec | undefined, cls: PowerClass): UnflyableReason | null {
  if (!hasThrustCurve(motor)) return { kind: 'noMotor' };
  // Before the safety codes, because a code is judged on these numbers: a blank
  // rod angle is not "within so many degrees of vertical", it is nothing to judge.
  const missing = missingRequired(sim.launch);
  if (missing.length) return { kind: 'incomplete', missing };
  // Before the limits for the same reason: the codes are judged on the surface
  // level, and a profile with two levels at one altitude is not a profile the
  // bridge will fly at all. Left to `simulate()` the bridge refuses it before
  // the kernel sees it, with its own `wind levels repeat the altitude 0.0 m
  // (level 2)`, an engine error for something the profile editor let the user
  // type, where this names the profile.
  if (duplicateAltitudeRows(sim.launch.windLevels ?? []).length) return { kind: 'windProfile' };
  const violations = launchLimitViolations(sim.launch, cls);
  return violations.length ? { kind: 'limits', violations } : null;
}

/**
 * Every simulation in `sims` that cannot fly, in the order given.
 *
 * `motorOf` and `classOf` resolve the row's own flight configuration, because
 * two rows can fly different configurations, and the motor and the rocket's
 * class are what the checks are about.
 */
export function unflyableSims(
  sims: Simulation[],
  motorOf: (sim: Simulation) => MotorSpec | undefined,
  classOf: (sim: Simulation) => PowerClass,
): Unflyable[] {
  const out: Unflyable[] = [];
  for (const sim of sims) {
    const reason = unflyable(sim, motorOf(sim), classOf(sim));
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
export function unflyableText(
  u: Unflyable,
  t: (key: string, vars?: Record<string, unknown>) => string,
  units: UnitSymbols,
): string {
  if (u.reason.kind === 'noMotor') return t('sim.noMotorNamed', { name: u.name });
  if (u.reason.kind === 'incomplete') {
    // Named, so the message points at the fields to go and fill rather than
    // just asserting that something is wrong somewhere.
    const fields = fmtList(u.reason.missing.map((k) => t(`launch.field.${k}`)));
    return t('sim.incomplete', { name: u.name, fields });
  }
  if (u.reason.kind === 'windProfile') return t('sim.windProfile', { name: u.name });
  // Sentence after sentence through a key, since not every language spaces them.
  return u.reason.violations
    .map((v) => limitText(v, t, units))
    .reduce((text, next) => t('limits.sentenceJoin', { first: text, next }), t('limits.refused', { name: u.name }));
}

/**
 * Why no simulation of this design can fly.
 *
 * Separate from {@link unflyable} because these are facts about the rocket, not
 * about one row: every simulation shares the tree, so there is no "skip the bad
 * one and fly the rest" here.
 */
export type DesignBlocker =
  | { kind: 'noMount' }
  | { kind: 'badGeometry'; bad: BadDimension[] }
  /** Fin sets the kernel would fly with NaN root points (`overturnedFins`). */
  | { kind: 'finCant'; fins: NamedPart[] };

export function designBlocker(tree: RocketTree): DesignBlocker | null {
  // No mount first: with nowhere to seat a motor there is no flight to discuss,
  // whatever else the geometry says.
  if (findMounts(tree).length === 0) return { kind: 'noMount' };
  const bad = badDimensions(tree);
  if (bad.length) return { kind: 'badGeometry', bad };
  const fins = overturnedFins(tree);
  return fins.length ? { kind: 'finCant', fins } : null;
}

/**
 * A design blocker as a sentence, naming each part and what it is missing.
 *
 * Grouped by part rather than one line per field: a tube with its radius and
 * thickness zeroed is one thing to go and fix, not two.
 */
export function designBlockerText(
  b: DesignBlocker,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string {
  if (b.kind === 'noMount') return t('sim.noMount');
  if (b.kind === 'finCant') {
    const parts = b.fins.map((f) => t('sim.finCantPart', { name: partLabel(t, f) })).join(t('sim.badGeometryPartSep'));
    return t('sim.finCant', { parts });
  }
  const byPart = new Map<string, string[]>();
  for (const d of b.bad) {
    const name = partLabel(t, d);
    const fields = byPart.get(name) ?? [];
    fields.push(t(`part.field.${d.field}`));
    byPart.set(name, fields);
  }
  const parts = [...byPart]
    .map(([name, fields]) => t('sim.badGeometryPart', { name, fields: fields.join(t('sim.badGeometryFieldSep')) }))
    .join(t('sim.badGeometryPartSep'));
  return t('sim.badGeometry', { parts });
}

/**
 * Why the design did not build, as a sentence: the design's own explanation
 * when it has one (the zero dimensions first, then the overturned fin sets),
 * since the engine's message for either names no part ("The number NaN cannot
 * be converted to a BigInt", a NaN mass), and otherwise the engine's message.
 */
export function buildFailureText(
  res: { error: string | Keyed; bad?: BadDimension[]; fins?: NamedPart[] },
  t: (key: string, vars?: Record<string, unknown>) => string,
): string {
  if (res.bad?.length) return designBlockerText({ kind: 'badGeometry', bad: res.bad }, t);
  if (res.fins?.length) return designBlockerText({ kind: 'finCant', fins: res.fins }, t);
  return typeof res.error === 'string' ? res.error : keyedText(res.error, t);
}

import type { Simulation, SimPrefs } from './simulations';
import type { LaunchConditions } from '../design/orkTree';
import { stableJson } from '../app/stableJson';

/**
 * Which fields the simulations being edited together DISAGREE on.
 *
 * Editing a selection writes the field you touch to every selected simulation,
 * so the one thing the editor must not do is let you flatten a value you could
 * not see. The panel shows the ACTIVE simulation's value (blanking it would
 * collide with the atmosphere fields, where blank already means ISA), and marks
 * every field where the others differ.
 *
 * Motors are exempt, and so there is nothing here that compares them: a motor
 * change only ever touches the active simulation, so there is no overwrite to
 * warn about, and rows differing on motor is the normal state of a comparison
 * rather than something to flag.
 *
 * Only asked for a real multi-selection; one target agrees with itself.
 */

/** Value equality that is good enough for a launch field or a run preference. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // null and undefined both mean "not set" here: `temperatureC` is null for ISA
  // and an older workspace may simply lack the key.
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  // The structured launch values are lists of levels (wind, atmosphere). Wind
  // levels are not kept sorted, so list order counts; key order inside a level
  // does not, since a reload rebuilds those objects.
  return stableJson(a) === stableJson(b);
}

/**
 * The keys whose values are not the same across `records`, over every key any
 * of them sets. An absent record sets nothing.
 */
function diffKeys<T extends object>(records: (T | undefined)[]): Set<keyof T> {
  const out = new Set<keyof T>();
  if (records.length < 2) return out;
  const [first, ...rest] = records;
  const keys = new Set<string>();
  for (const r of records) for (const k of Object.keys(r ?? {})) keys.add(k);
  for (const k of keys) {
    const key = k as keyof T;
    if (rest.some((r) => !same(r?.[key], first?.[key]))) out.add(key);
  }
  return out;
}

/** The launch-condition keys whose values are not the same across `sims`. */
export function launchDiffKeys(sims: Simulation[]): Set<keyof LaunchConditions> {
  return diffKeys(sims.map((s) => s.launch));
}

/**
 * The run-preference keys that differ. Compared as the EFFECTIVE value would
 * read in the editor, which is the override or nothing: two simulations that
 * both fall through to the same global agree, and one that pins the global's
 * own number still differs from one that leaves it unset, because clearing the
 * field later moves only one of them.
 */
export function prefDiffKeys(sims: Simulation[]): Set<keyof SimPrefs> {
  return diffKeys(sims.map((s) => s.prefs));
}

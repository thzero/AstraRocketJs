import type { Simulation, SimPrefs } from './simulations';
import type { LaunchConditions } from './orkTree';

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
  // Wind levels are the only structured launch value, and their order is
  // meaningful (the list is not kept sorted), so a plain deep compare is right.
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The launch-condition keys whose values are not the same across `sims`. */
export function launchDiffKeys(sims: Simulation[]): Set<keyof LaunchConditions> {
  const out = new Set<keyof LaunchConditions>();
  if (sims.length < 2) return out;
  const [first, ...rest] = sims as [Simulation, ...Simulation[]];
  const keys = new Set<string>();
  for (const s of sims) for (const k of Object.keys(s.launch)) keys.add(k);
  for (const k of keys) {
    const key = k as keyof LaunchConditions;
    if (rest.some((s) => !same(s.launch[key], first.launch[key]))) out.add(key);
  }
  return out;
}

/**
 * The run-preference keys that differ. Compared as the EFFECTIVE value would
 * read in the editor, which is the override or nothing: two simulations that
 * both fall through to the same global agree, and one that pins the global's
 * own number still differs from one that leaves it unset, because clearing the
 * field later moves only one of them.
 */
export function prefDiffKeys(sims: Simulation[]): Set<keyof SimPrefs> {
  const out = new Set<keyof SimPrefs>();
  if (sims.length < 2) return out;
  const [first, ...rest] = sims as [Simulation, ...Simulation[]];
  const keys = new Set<string>();
  for (const s of sims) for (const k of Object.keys(s.prefs ?? {})) keys.add(k);
  for (const k of keys) {
    const key = k as keyof SimPrefs;
    if (rest.some((s) => !same(s.prefs?.[key], first.prefs?.[key]))) out.add(key);
  }
  return out;
}

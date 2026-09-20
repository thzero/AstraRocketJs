import type { ComponentNode } from '../engine/openRocketEngine';

/**
 * Typed accessors for a ComponentNode's open-ended parameter bag
 * (`[param: string]: unknown`). Each reads one key, returning the value when it
 * has the expected type and the fallback otherwise — the guard-and-cast that
 * every consumer used to hand-roll as a local `num` / `numVal` helper.
 */

/** Numeric parameter, or `fb` (default 0) when absent / non-numeric / non-finite.
 *  The `Number.isFinite` guard is load-bearing: a `NaN`/`Infinity` that slipped
 *  in from a malformed file, a lost JSON round-trip, or a bad field would
 *  otherwise flow straight into every geometry/mesh/report path as NaN
 *  coordinates. Treat non-finite as absent (fall back). */
export const num = (n: ComponentNode, key: string, fb = 0): number =>
  typeof n[key] === 'number' && Number.isFinite(n[key] as number) ? (n[key] as number) : fb;

/** Like {@link num} but yields `undefined` (not a fallback) when absent / non-finite. */
export const numOpt = (n: ComponentNode, key: string): number | undefined =>
  typeof n[key] === 'number' && Number.isFinite(n[key] as number) ? (n[key] as number) : undefined;

/**
 * A SAFETY ceiling on any instance count, not a design opinion.
 *
 * Every consumer read counts as `Math.max(1, Math.round(...))`: a floor and no
 * ceiling. Each one then loops that many times allocating as it goes - a
 * cloned ExtrudeGeometry per fin in the 3D view, an SVG shape per fin in the
 * schematic, a tube per instance in the aft view. Typing 100000 into Fin count
 * (a plausible slip on a 3-fin design) locked the tab, and a hostile `.ork`
 * could carry the same value. 64 is far above anything buildable and far below
 * anything that hurts.
 */
export const MAX_INSTANCE_COUNT = 64;

/**
 * An instance count (fins, tubes, pod instances): a whole number in
 * [1, {@link MAX_INSTANCE_COUNT}].
 *
 * One reader so the cap cannot be applied in some of the eleven places that
 * loop on a count and forgotten in the rest.
 */
export const countOf = (n: ComponentNode, key: string, fb: number): number =>
  Math.min(MAX_INSTANCE_COUNT, Math.max(1, Math.round(num(n, key, fb))));

/** String parameter, or `fb` (default '') when absent / non-string. */
export const str = (n: ComponentNode, key: string, fb = ''): string =>
  typeof n[key] === 'string' ? (n[key] as string) : fb;

/** Boolean parameter, or `fb` (default false) when absent / non-boolean. */
export const bool = (n: ComponentNode, key: string, fb = false): boolean =>
  typeof n[key] === 'boolean' ? (n[key] as boolean) : fb;

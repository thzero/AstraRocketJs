import type { ComponentNode, ComponentPosition } from '../engine/openRocketEngine';

/**
 * Typed accessors for a ComponentNode's open-ended parameter bag
 * (`[param: string]: unknown`). Each reads one key, returning the value when it
 * has the expected type and the fallback otherwise, so no consumer has to
 * hand-roll the guard-and-cast as a local helper.
 */

/** Numeric parameter, or `fb` (default 0) when absent / non-numeric / non-finite.
 *  The `Number.isFinite` guard is load-bearing: a `NaN`/`Infinity` that slipped
 *  in from a malformed file, a lost JSON round-trip, or a bad field would
 *  otherwise flow straight into every geometry/mesh/report path as NaN
 *  coordinates. Treat non-finite as absent (fall back). */
export const num = (n: ComponentNode, key: string, fb = 0): number =>
  typeof n[key] === 'number' && Number.isFinite(n[key]) ? n[key] : fb;

/** Like {@link num} but yields `undefined` (not a fallback) when absent / non-finite. */
export const numOpt = (n: ComponentNode, key: string): number | undefined =>
  typeof n[key] === 'number' && Number.isFinite(n[key]) ? n[key] : undefined;

/**
 * A safety ceiling on any instance count, not a design opinion.
 *
 * Each consumer loops that many times allocating as it goes: a cloned
 * ExtrudeGeometry per fin in the 3D view, an SVG shape per fin in the
 * schematic, a tube per instance in the aft view. Without a ceiling, typing
 * 100000 into Fin count (a plausible slip on a 3-fin design) locks the tab, and
 * a hostile `.ork` could carry the same value. 64 is far above anything buildable and far below
 * anything that hurts.
 */
export const MAX_INSTANCE_COUNT = 64;

/**
 * The most fins a fin set can carry: the kernel's own limit. `FinSet.setFinCount`
 * clamps to 8, and the engine boundary rejects anything above it for every fin
 * type, so a count past this is a design the engine will not build.
 */
export const MAX_FIN_COUNT = 8;

/**
 * The largest fin cant either way, in radians: the kernel's own limit.
 * `FinSet.setCantAngle` clamps to MAX_CANT_RADIANS (15 deg) and the desktop fin
 * dialogs stop their spinner and slider there, so a larger cant is one the
 * kernel never flies.
 */
export const MAX_CANT = (15 * Math.PI) / 180;

/**
 * An instance count (fins, tubes, pod instances): a whole number in
 * [1, {@link MAX_INSTANCE_COUNT}].
 *
 * One reader so the cap cannot be applied in some of the places that loop on a
 * count and forgotten in the rest.
 */
export const countOf = (n: ComponentNode, key: string, fb: number): number =>
  Math.min(MAX_INSTANCE_COUNT, Math.max(1, Math.round(num(n, key, fb))));

/** String parameter, or `fb` (default '') when absent / non-string. */
export const str = (n: ComponentNode, key: string, fb = ''): string => (typeof n[key] === 'string' ? n[key] : fb);

/** Boolean parameter, or `fb` (default false) when absent / non-boolean. */
export const bool = (n: ComponentNode, key: string, fb = false): boolean => (typeof n[key] === 'boolean' ? n[key] : fb);

/**
 * A chain member's outer radius (m), read from the key its type sizes by: a
 * nose cone's `aftRadius`, a body tube's `outerRadius`, a transition's larger
 * end. 0 for any other type or a missing value.
 */
export const chainOuterRadius = (n: ComponentNode): number => {
  if (n.type === 'nosecone') return num(n, 'aftRadius', 0);
  if (n.type === 'bodytube') return num(n, 'outerRadius', 0);
  if (n.type === 'transition') return Math.max(num(n, 'foreRadius', 0), num(n, 'aftRadius', 0));
  return 0;
};

/**
 * The largest of a node's `outerRadius`, `aftRadius` and `foreRadius` (m),
 * whatever its type; 0 when it carries none. Unlike {@link chainOuterRadius}
 * it reads every radius key, so it also sizes non-chain parts and any node
 * that carries a key its type does not size by.
 */
export const anyOuterRadius = (n: ComponentNode): number =>
  Math.max(num(n, 'aftRadius', 0), num(n, 'outerRadius', 0), num(n, 'foreRadius', 0));

const AXIAL_METHODS: ReadonlySet<string> = new Set<ComponentPosition['method']>([
  'top',
  'middle',
  'bottom',
  'absolute',
  'after',
]);

/**
 * A node's axial position, validated: the method is one the union names and
 * the offset is a finite number, each falling back to the kernel's own
 * default (`top`, 0: ComponentFactory's `str(position, "method", "top")` and
 * `dbl(position, "offset", 0)`) otherwise.
 *
 * One reader, applying the same guard as the numeric accessors above, rather than
 * an `as ComponentPosition` cast at each call site: a hand-edited design or a
 * hostile `.ork` with `offset: "0.1"` otherwise reaches `pLen - childLen + "0.1"`
 * and produces a string station.
 *
 * `ork` (what an imported file actually said) rides along untouched, since the
 * exporter writes it back verbatim.
 */
export const positionOf = (n: ComponentNode): ComponentPosition => {
  const raw = n.position as Partial<ComponentPosition> | null | undefined;
  const method = raw && typeof raw.method === 'string' && AXIAL_METHODS.has(raw.method) ? raw.method : 'top';
  const offset = raw && typeof raw.offset === 'number' && Number.isFinite(raw.offset) ? raw.offset : 0;
  return raw?.ork ? { method, offset, ork: raw.ork } : { method, offset };
};

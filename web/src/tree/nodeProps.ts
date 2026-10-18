import type { ComponentNode, ComponentPosition } from '../engine/openRocketEngine';
import { KERNEL_BODYTUBE_OUTER_RADIUS, KERNEL_DEFAULTS } from './kernelDefaults';

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
 * a hostile `.ork` could carry the same value. 64 is far above anything
 * buildable and far below anything that hurts.
 */
export const MAX_INSTANCE_COUNT = 64;

/**
 * The most shroud lines a parachute can carry: the bridge's ceiling
 * (`ComponentFactory.MAX_LINE_COUNT`), shared by the editor and both importers
 * so a count any of them admits always builds. Nothing in the app loops on the
 * count, so it does not need the instance ceiling; the bound is there because
 * line mass scales with it, and an absurd count would fly an absurd mass.
 */
export const MAX_LINE_COUNT = 1024;

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

/** A fin set's cant as the kernel flies it: the stored one, clamped to {@link MAX_CANT}. */
export const finCant = (node: ComponentNode): number => Math.max(-MAX_CANT, Math.min(MAX_CANT, num(node, 'cant', 0)));

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
 * end. A body tube or nose cone with no radius is the one it flies at
 * ({@link bodyTubeRadius}, {@link noseConeAftRadius}); 0 for any other type or
 * another missing value.
 */
export const chainOuterRadius = (n: ComponentNode): number => {
  if (n.type === 'nosecone') return noseConeAftRadius(n);
  if (n.type === 'bodytube') return bodyTubeRadius(n);
  if (n.type === 'transition') return Math.max(num(n, 'foreRadius', 0), num(n, 'aftRadius', 0));
  return 0;
};

/**
 * A body tube's radius, the same at every station (`BodyTube.getRadius(x)`).
 * A tube with no `outerRadius` is the bridge's default (`ComponentFactory`,
 * case "bodytube", 0.025 m), the radius it is flown at. Every reader that
 * stands a part on a tube or places an assembly against one goes through here.
 */
export const bodyTubeRadius = (n: ComponentNode): number => num(n, 'outerRadius', KERNEL_BODYTUBE_OUTER_RADIUS);

/**
 * A nose cone's base radius. A cone with no `aftRadius` is the bridge's
 * default (`ComponentFactory`, case "nosecone", 0.025 m), the radius it is
 * flown at, so every reader sizes a keyless cone as the kernel does.
 */
export const noseConeAftRadius = (n: ComponentNode): number => num(n, 'aftRadius', KERNEL_DEFAULTS.nosecone.aftRadius);

/**
 * The largest of a node's `outerRadius`, `aftRadius` and `foreRadius` (m),
 * whatever its type; 0 when it carries none, except a nose cone, whose missing
 * `aftRadius` is the one it flies at ({@link noseConeAftRadius}). Unlike
 * {@link chainOuterRadius} it reads every radius key, so it also sizes
 * non-chain parts and any node that carries a key its type does not size by.
 */
export const anyOuterRadius = (n: ComponentNode): number =>
  Math.max(
    n.type === 'nosecone' ? noseConeAftRadius(n) : num(n, 'aftRadius', 0),
    num(n, 'outerRadius', 0),
    num(n, 'foreRadius', 0),
  );

const AXIAL_METHODS: ReadonlySet<string> = new Set<ComponentPosition['method']>([
  'top',
  'middle',
  'bottom',
  'absolute',
  'after',
]);

/**
 * The axial method a part keeps when its node has no `position`: the bridge
 * sets one only from that key (`ComponentFactory.create`, `applyAssembly`), so
 * the constructor's stands, at offset 0. `FinSet`, `TubeFinSet`,
 * `InternalComponent` (inner tubes, couplers, rings, bulkheads, engine blocks),
 * `PodSet` and `ParallelStage` set `BOTTOM`; `LaunchLug` and `RailButton` set
 * `MIDDLE`. `MassObject` (recovery devices, mass components and the fairing,
 * which the bridge builds as one) sets `TOP`, the reader's default. A chain
 * member stacks behind the part ahead whatever it states.
 */
const CONSTRUCTOR_METHOD: Readonly<Record<string, ComponentPosition['method']>> = {
  trapezoidfinset: 'bottom',
  ellipticalfinset: 'bottom',
  freeformfinset: 'bottom',
  tubefinset: 'bottom',
  innertube: 'bottom',
  tubecoupler: 'bottom',
  centeringring: 'bottom',
  bulkhead: 'bottom',
  engineblock: 'bottom',
  podset: 'bottom',
  parallelstage: 'bottom',
  launchlug: 'middle',
  railbutton: 'middle',
};

/**
 * The method a `position` with no valid method falls back to: `bottom` for a
 * pod set or booster (`applyAssembly` reads `str(position, "method",
 * "bottom")`), `top` for any other part (`create` reads `"top"`).
 */
const statedMethodDefault = (type: string): ComponentPosition['method'] =>
  type === 'podset' || type === 'parallelstage' ? 'bottom' : 'top';

/**
 * A node's axial position, validated: the method is one the union names and
 * the offset is a finite number, each falling back to the kernel's own
 * default otherwise. A node with no `position` reads as its constructor
 * places it (`CONSTRUCTOR_METHOD`, offset 0); one with a `position` reads the
 * bridge's defaults for a missing method (`statedMethodDefault`) and offset
 * (`dbl(position, "offset", 0)`).
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
  const fallback = raw ? statedMethodDefault(n.type) : (CONSTRUCTOR_METHOD[n.type] ?? 'top');
  const method = raw && typeof raw.method === 'string' && AXIAL_METHODS.has(raw.method) ? raw.method : fallback;
  const offset = raw && typeof raw.offset === 'number' && Number.isFinite(raw.offset) ? raw.offset : 0;
  return raw?.ork ? { method, offset, ork: raw.ork } : { method, offset };
};

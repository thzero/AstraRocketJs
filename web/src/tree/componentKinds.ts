import type { ComponentType } from '../engine/openRocketEngine';

/**
 * What KIND of thing each component type is, in one table.
 *
 * The tree modules used to answer "is this a chain member / an assembly / a
 * fin set" with ad-hoc string tests: `type.endsWith('finset')`, three separate
 * `new Set(['nosecone', 'bodytube', 'transition'])` literals (position.ts,
 * assembly.ts, scaleRocket.ts) plus a fourth in treeEdit.ts, and
 * `type === 'podset' || type === 'parallelstage'`. Each copy was correct on the
 * day it was written and nothing tied them together, so adding a component
 * type meant finding every one of them by hand.
 *
 * Keyed by `ComponentType` and checked with `satisfies`, so a type added to
 * the union without a row here is a compile error rather than a part that
 * silently belongs to no family.
 */
export type ComponentKind =
  /** The top-level stage container. */
  | 'stage'
  /** Axial chain members: they stack nose to tail and carry the airframe. */
  | 'chain'
  /** Fin sets with a flat planform (OpenRocket's `instanceof FinSet`). */
  | 'planarfin'
  /** Tube fins: a fin set with no planform (`TubeFinSet extends Tube`). */
  | 'tubefin'
  /** Internal structure nested inside a tube. */
  | 'internal'
  /** External hardware riding on the airframe surface. */
  | 'external'
  /** Recovery devices. */
  | 'recovery'
  /** A point mass (or a mass-carrying placeholder). */
  | 'mass'
  /** Off-axis assemblies: pod sets and parallel boosters. */
  | 'assembly';

export const COMPONENT_KIND = {
  stage: 'stage',
  nosecone: 'chain',
  transition: 'chain',
  bodytube: 'chain',
  trapezoidfinset: 'planarfin',
  ellipticalfinset: 'planarfin',
  freeformfinset: 'planarfin',
  tubefinset: 'tubefin',
  innertube: 'internal',
  tubecoupler: 'internal',
  centeringring: 'internal',
  bulkhead: 'internal',
  engineblock: 'internal',
  launchlug: 'external',
  railbutton: 'external',
  // A camera shroud is external hardware; it is modeled as a mass component
  // by the kernel, but it rides on the surface (see openRocketEngine.ts).
  fairing: 'external',
  parachute: 'recovery',
  streamer: 'recovery',
  shockcord: 'recovery',
  masscomponent: 'mass',
  podset: 'assembly',
  parallelstage: 'assembly',
} as const satisfies Record<ComponentType, ComponentKind>;

/** The component types of one kind, as a narrowed union. */
export type TypesOfKind<K extends ComponentKind> = {
  [T in ComponentType]: (typeof COMPONENT_KIND)[T] extends K ? T : never;
}[ComponentType];

export type ChainType = TypesOfKind<'chain'>;
export type AssemblyType = TypesOfKind<'assembly'>;
export type PlanarFinSetType = TypesOfKind<'planarfin'>;
export type FinSetType = TypesOfKind<'planarfin' | 'tubefin'>;

/** Every component type of the given kinds, derived from the table above. */
export function typesOfKind<K extends ComponentKind>(...kinds: K[]): ReadonlySet<TypesOfKind<K>> {
  const wanted = new Set<ComponentKind>(kinds);
  const out = new Set<TypesOfKind<K>>();
  for (const [type, kind] of Object.entries(COMPONENT_KIND) as [ComponentType, ComponentKind][]) {
    if (wanted.has(kind)) out.add(type as TypesOfKind<K>);
  }
  return out;
}

/**
 * The axial chain members: nose cone, body tube, transition. These stack
 * sequentially inside a stage (or a pod) and their own `position` is not used
 * for layout.
 */
export const CHAIN_TYPES: ReadonlySet<ChainType> = typesOfKind('chain');

/** Off-axis assemblies (PodSet / ParallelStage). */
export const ASSEMBLY_TYPES: ReadonlySet<AssemblyType> = typesOfKind('assembly');

/** Fin sets with a flat planform: everything except tube fins. */
export const PLANAR_FIN_TYPES: ReadonlySet<PlanarFinSetType> = typesOfKind('planarfin');

/** Every fin set, tube fins included. */
export const FIN_SET_TYPES: ReadonlySet<FinSetType> = typesOfKind('planarfin', 'tubefin');

/**
 * The guards take a plain `string` on purpose: a node's `type` arrives from a
 * persisted design or an imported file and may be anything, and a caller
 * holding a `ComponentType` gets the narrowed type back through the predicate.
 */
export const isChainType = (type: string): type is ChainType => (CHAIN_TYPES as ReadonlySet<string>).has(type);

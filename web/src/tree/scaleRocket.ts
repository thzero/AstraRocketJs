import type { ComponentNode, ComponentType, RocketTree } from '../engine/openRocketEngine';
import { isAssembly } from './assembly';
import { isChainType } from './componentKinds';
import { chainOuterRadius, numOpt, positionOf } from './nodeProps';
import { walkNodes } from './treeWalk';
import { roundTo } from '../services/app/numbers';

/**
 * Scale a whole rocket by one factor: the "upscale/downscale a plan" workflow.
 * Motor-mount snapping is left out (it needs a motor-class database); this is
 * the pure geometric scale.
 *
 * Why a key list and not a schema walk: `ComponentNode` has an open index
 * signature and importers write length-valued keys no schema declares (freeform
 * `points`, ring/coupler radii, shoulder thicknesses, instance separations…),
 * while some declared lengths are not geometry (`deployAltitude` is an altitude
 * AGL). So the lists below are explicit per type, and a key scales only when it
 * is already present as a number. Absence is a value in this tree (an absent
 * transition radius means automatic; freezing it to `k × default` changes the
 * design).
 *
 * What doesn't scale: a part sized by something outside the rocket keeps its
 * size and only moves: a camera shroud (fairing), a rail button (preset
 * sizes). Angles, counts,
 * densities, drag coefficients, finish, motor choice, deployment/separation and
 * the pad conditions are all untouched.
 *
 * Mass: densities are left alone, so a solid part's mass follows its volume and
 * goes as k³, a canopy/streamer as k² (surface), a shock cord as k (line). A
 * design carrying recovery gear is therefore not exactly similar after scaling.
 */

/**
 * Length-valued keys per component type. Present-only, multiplied by k.
 *
 * Keyed by `ComponentType`, not `string`: a type added to the union without a
 * row here is a compile error, where an open record would silently scale
 * nothing on it.
 */
const LENGTH_KEYS: Record<ComponentType, readonly string[]> = {
  nosecone: ['length', 'aftRadius', 'thickness', 'shoulderRadius', 'shoulderLength', 'shoulderThickness'],
  transition: [
    'length',
    'foreRadius',
    'aftRadius',
    'thickness',
    'foreShoulderRadius',
    'foreShoulderLength',
    'foreShoulderThickness',
    'aftShoulderRadius',
    'aftShoulderLength',
    'aftShoulderThickness',
  ],
  bodytube: ['length', 'outerRadius', 'thickness'],
  trapezoidfinset: [
    'rootChord',
    'tipChord',
    'sweep',
    'height',
    'thickness',
    'airfoilLeDiamond',
    'airfoilTeDiamond',
    'finLeRadius',
    'tabHeight',
    'tabLength',
    'tabOffset',
    'filletRadius',
  ],
  // `points` is the whole planform, handled separately below.
  freeformfinset: [
    'thickness',
    'airfoilLeDiamond',
    'airfoilTeDiamond',
    'finLeRadius',
    'tabHeight',
    'tabLength',
    'tabOffset',
    'filletRadius',
  ],
  ellipticalfinset: [
    'rootChord',
    'height',
    'thickness',
    'airfoilLeDiamond',
    'airfoilTeDiamond',
    'finLeRadius',
    'tabHeight',
    'tabLength',
    'tabOffset',
    'filletRadius',
  ],
  tubefinset: ['length', 'outerRadius', 'thickness'],
  innertube: ['length', 'outerRadius', 'thickness', 'radialPosition', 'maxMotorLength'],
  tubecoupler: ['length', 'thickness', 'outerRadius', 'innerRadius'],
  centeringring: ['length', 'outerRadius', 'innerRadius', 'instanceSeparation'],
  bulkhead: ['length', 'outerRadius', 'instanceSeparation'],
  engineblock: ['length', 'thickness', 'outerRadius'],
  // Desktop's LaunchLug scalers: outer radius, wall and length together.
  launchlug: ['length', 'outerRadius', 'thickness', 'instanceSeparation'],
  // A rail button is a catalog part; the spacing between a pair is an airframe span.
  railbutton: ['instanceSeparation'],
  // `length` is the packed length (orkImport reads <packedlength> into it) and
  // position.axialLength uses it for layout. Left unscaled, a 25 mm packed chute
  // would occupy 25 mm in a doubled airframe, and anything positioned `middle`
  // or `bottom` against it, plus the caliper snap targets built from
  // axialLength, would land at the wrong stations.
  parachute: ['length', 'diameter', 'spillHoleDiameter', 'lineLength'],
  streamer: ['length', 'stripLength', 'stripWidth'],
  shockcord: ['length', 'cordLength'],
  masscomponent: ['length', 'radius', 'radialPosition'],
  fairing: [],
  podset: ['radiusOffset'],
  parallelstage: ['radiusOffset'],
  stage: [],
};

/** Types whose own geometry is fixed hardware: they move, they do not grow. */
const FIXED_SIZE: ReadonlySet<ComponentType> = new Set<ComponentType>(['fairing', 'railbutton']);

/**
 * The keys that place a part rather than size it: how far off the axis it sits,
 * and the spacing between its instances. With the axial position and an
 * override CG, these are what desktop's **Scale component offsets** governs.
 */
const OFFSET_KEYS: ReadonlySet<string> = new Set(['radialPosition', 'radiusOffset', 'instanceSeparation']);

/** What a scale covers: the design, the selected part and everything inside it, or the part alone. */
export type ScaleScope = 'rocket' | 'subtree' | 'part';

/**
 * What a scale changes besides the sizes, as desktop's Scale dialog offers it.
 *
 * - `offsets`: positions too (axial and radial offsets, instance spacing, an
 *   override CG). Off, a part keeps its station and only changes size.
 * - `masses`: masses typed outright (a mass component's mass, a mass override).
 *   Desktop scales an override mass in its offsets pass, so it changes only
 *   with both on; a mass component's own mass needs `masses` alone.
 *
 * Both default to on, which is the whole-rocket scale.
 */
export interface ScaleOptions {
  offsets?: boolean;
  masses?: boolean;
}

/**
 * The exponent a pinned mass scales by, per type, matching how the same part's
 * computed mass scales (densities are untouched): a solid is a volume (k³), a
 * canopy/streamer a surface (k²), a cord a line (k).
 *
 * Every type is listed, rather than only the exceptions over an open
 * `Record<string, number>` with `?? 3` at the read: that leaves the k³ cases
 * implicit and drops a newly added type into them unreviewed.
 */
const MASS_EXPONENT: Record<ComponentType, number> = {
  // A stage or assembly has no mass of its own, but an `overrideMass` pinned on
  // one covers its whole subtree, which is a volume.
  stage: 3,
  podset: 3,
  parallelstage: 3,
  // Solid bodies: every dimension scales, so a volume.
  nosecone: 3,
  transition: 3,
  bodytube: 3,
  // Fins: a planform area (k²) times a thickness (k).
  trapezoidfinset: 3,
  ellipticalfinset: 3,
  freeformfinset: 3,
  // A tube: length, radius and wall all scale.
  tubefinset: 3,
  innertube: 3,
  tubecoupler: 3,
  centeringring: 3,
  bulkhead: 3,
  engineblock: 3,
  // A mass component's length and radius scale (LENGTH_KEYS.masscomponent), so
  // its pinned mass follows the volume it now occupies.
  masscomponent: 3,
  parachute: 2,
  streamer: 2,
  shockcord: 1,
  // A lug's length, outer radius and wall all scale, so a volume.
  launchlug: 3,
  // Fixed-size hardware (FIXED_SIZE): the same physical part after scaling,
  // so its mass is never touched. k^0 = 1 says so even if the guard is lost.
  railbutton: 0,
  fairing: 0,
};

/** Twelve places: past any real dimension, short of float noise. */
const round = (x: number, places = 12): number => roundTo(x, places);

/**
 * Scales one node's own fields. Children are handled by the caller.
 *
 * Exported for the freeform editor's **Scale fin**, which is this applied to one
 * component: the same key lists, so a scaled fin's tab, fillet and thickness
 * follow its outline exactly as they would in a whole-rocket scale.
 */
export function scaleNode(n: ComponentNode, k: number, options: ScaleOptions = {}): ComponentNode {
  const offsets = options.offsets ?? true;
  const masses = options.masses ?? true;
  const type = n.type;
  const fixed = FIXED_SIZE.has(type);
  // Children are left off, rather than carried by the spread and overwritten by
  // whichever caller remembers to. Every caller supplies its own (`scaleRocket`
  // and `scalePart` walk or reuse them, `componentActions.scaleComponent` reuses
  // them), and a returned node that aliased the input's `children` array would
  // be a scaled node sharing a subtree with the unscaled one.
  const { children: _children, ...own } = n;
  const out: ComponentNode = { ...own };

  // `?? []` survives for a persisted node whose `type` the union does not
  // know: the table is complete for the union, not for arbitrary input.
  for (const key of LENGTH_KEYS[type] ?? []) {
    if (!offsets && OFFSET_KEYS.has(key)) continue;
    const v = numOpt(n, key);
    if (v !== undefined) out[key] = round(v * k);
  }

  // A freeform fin's planform lives entirely in `points`: [x along the body,
  // y off the surface], meters. Both coordinates scale.
  if (Array.isArray(n['points'])) {
    const pts = n['points'] as unknown[];
    out['points'] = pts.map((p) =>
      Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number'
        ? [round(p[0] * k), round(p[1] * k)]
        : // A row that is not a numeric pair is copied rather than passed through
          // by reference: it cannot be scaled, but the scaled node must not share
          // an array with the node it was scaled from. Left unscaled on purpose -
          // guessing at what a malformed vertex meant is worse than carrying it.
          Array.isArray(p)
          ? [...(p as unknown[])]
          : p,
    );
  }

  // Pinned masses go as k^exp, but only where the geometry moved (a fixed-size
  // part is the same physical part after scaling and weighs the same).
  if (!fixed) {
    // Same reasoning as the `?? []` on LENGTH_KEYS above: complete for the union, and
    // a solid is the safe reading of a type it has never seen.
    const exp = MASS_EXPONENT[type] ?? 3;
    const mass = numOpt(n, 'mass');
    if (masses && mass !== undefined) out['mass'] = round(mass * k ** exp, 15);
    const override = numOpt(n, 'overrideMass');
    if (masses && offsets && override !== undefined) out['overrideMass'] = round(override * k ** exp, 15);
    // An override CG is a station from the component's own front: a length.
    const cg = numOpt(n, 'overrideCGX');
    if (offsets && cg !== undefined) out['overrideCGX'] = round(cg * k);
  }

  // Axial placement: startFromPosition is homogeneous of degree 1 in
  // (parentLength, childLength, offset), so scaling the offset alongside the
  // lengths keeps every part at the same relative station, fixed-size parts
  // included (they move to their new station, same as desktop's rule).
  // `positionOf` validates the method and the offset the way position.ts
  // reads them, so a string offset scales to the kernel's 0 rather than being
  // carried through untouched to disagree with the layout.
  if (n.position && offsets) {
    const pos = positionOf(n);
    out.position = { ...pos, offset: round(pos.offset * k) };
  }

  return out;
}

/**
 * Scale the whole design by `factor`, returning a new tree (the input is
 * untouched). A non-positive, non-finite or 1× factor is a no-op: the same
 * tree object is returned, so callers can cheaply detect "nothing to do".
 */
export function scaleRocket(tree: RocketTree, factor: number, options: ScaleOptions = {}): RocketTree {
  if (!(factor > 0) || !Number.isFinite(factor) || factor === 1) return tree;
  const walk = (nodes: ComponentNode[]): ComponentNode[] =>
    nodes.map((n) => {
      const scaled = scaleNode(n, factor, options);
      return n.children ? { ...scaled, children: walk(n.children) } : scaled;
    });
  return { ...tree, components: walk(tree.components) };
}

/**
 * Scale one part, and with `withChildren` everything inside it, leaving the
 * rest of the design alone: desktop's "Selection and all subcomponents" and
 * "Only selected component(s)". Returns the same tree when there is nothing to
 * do or no such part.
 */
export function scalePart(
  tree: RocketTree,
  id: string,
  factor: number,
  withChildren: boolean,
  options: ScaleOptions = {},
): RocketTree {
  if (!(factor > 0) || !Number.isFinite(factor) || factor === 1) return tree;
  let found = false;
  const all = (n: ComponentNode): ComponentNode => {
    const scaled = scaleNode(n, factor, options);
    return n.children ? { ...scaled, children: n.children.map(all) } : scaled;
  };
  const walk = (nodes: ComponentNode[]): ComponentNode[] =>
    nodes.map((n) => {
      if (n.id === id) {
        found = true;
        if (withChildren) return all(n);
        const scaled = scaleNode(n, factor, options);
        return n.children ? { ...scaled, children: n.children } : scaled;
      }
      return n.children ? { ...n, children: walk(n.children) } : n;
    });
  const components = walk(tree.components);
  return found ? { ...tree, components } : tree;
}

/** Whether a design has a mass anything scales as a typed value: a mass component or a mass override. */
export function hasExplicitMass(tree: RocketTree): boolean {
  for (const n of walkNodes(tree.components)) {
    if (n.type === 'masscomponent' || typeof n['overrideMass'] === 'number') return true;
  }
  return false;
}

/** The rocket's greatest body diameter (m): what a "scale to a tube" factor divides. */
export function maxBodyDiameter(tree: RocketTree): number {
  let r = 0;
  for (const n of walkNodes(tree.components)) r = Math.max(r, chainOuterRadius(n));
  return r * 2;
}

/** Total nose-to-tail length (m) of the core axial chain, stages summed. Off-axis
 *  pods/parallel boosters are not part of the rocket's length. */
export function rocketLength(tree: RocketTree): number {
  // The shared chain / assembly tables (componentKinds.ts), not a third local
  // copy of "nosecone, bodytube, transition".
  let total = 0;
  const walk = (nodes: ComponentNode[]) => {
    for (const n of nodes) {
      if (isAssembly(n.type)) continue;
      if (isChainType(n.type)) total += numOpt(n, 'length') ?? 0;
      walk(n.children ?? []);
    }
  };
  walk(tree.components);
  return total;
}

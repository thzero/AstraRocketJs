import type { ComponentNode, ComponentType, RocketTree } from '../engine/openRocketEngine';
import { isAssembly } from './assembly';
import { isChainType } from './componentKinds';
import { chainOuterRadius, numOpt, positionOf } from './nodeProps';
import { walkNodes } from './treeWalk';
import { partLength } from './position';
import { roundTo } from '../services/app/numbers';
import { kernelDefault } from './kernelDefaults';

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
 * size and only moves: a camera shroud (fairing). A rail button scales in
 * every dimension but its screw height, as desktop's RailButtonScaler does.
 * Angles, counts, densities, drag coefficients, finish, motor choice,
 * deployment/separation and the pad conditions are all untouched.
 *
 * Mass: densities are left alone, so a solid part's computed mass follows its
 * volume and goes as k³, a canopy/streamer as k² (surface), a shock cord as k
 * (line). A mass typed outright (a mass component's mass, any mass override)
 * goes as k³ whatever the part, as desktop's MassComponentScaler and
 * OverrideScaler do it. A design carrying recovery gear is therefore not
 * exactly similar after scaling.
 *
 * Deliberately not desktop's ScaleDialog: a fin fillet's radius, a tube fin
 * set's sizes and an inner tube's maximum motor length scale here, because each
 * is a size of the part and a scaled rocket keeps them in proportion; desktop
 * leaves them. A fin tab's offset keeps its own reference method, and an
 * automatic aft radius follows its own automatic flag, where desktop converts
 * the method and reads the fore radius's flag.
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
  bodytube: ['length', 'outerRadius', 'thickness', 'motorOverhang'],
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
  innertube: ['length', 'outerRadius', 'thickness', 'radialPosition', 'maxMotorLength', 'motorOverhang'],
  // Every ring part is a desktop RingComponent, whose RadialPosition is an offset.
  // Desktop has no InstanceSeparation scaler for a ring or a lug (only the rail
  // button's), so their instance spacing keeps its value.
  tubecoupler: ['length', 'thickness', 'outerRadius', 'innerRadius', 'radialPosition'],
  centeringring: ['length', 'outerRadius', 'innerRadius', 'radialPosition'],
  bulkhead: ['length', 'outerRadius', 'radialPosition'],
  engineblock: ['length', 'thickness', 'outerRadius', 'radialPosition'],
  // Desktop's LaunchLug scalers: outer radius, wall and length together.
  launchlug: ['length', 'outerRadius', 'thickness'],
  // Desktop's RailButtonScaler: diameters and the three heights. The screw is
  // not among them, so it keeps its length.
  railbutton: ['outerDiameter', 'innerDiameter', 'height', 'baseHeight', 'flangeHeight', 'instanceSeparation'],
  // `length` is the packed length (orkImport reads <packedlength> into it) and
  // position.axialLength uses it for layout. Left unscaled, a 25 mm packed chute
  // would occupy 25 mm in a doubled airframe, and anything positioned `middle`
  // or `bottom` against it, plus the caliper snap targets built from
  // axialLength, would land at the wrong stations.
  // `radius` is the packed radius and `radialPosition` the offset off the axis,
  // desktop's MassObject Radius and RadialPosition scalers. A parachute's
  // scalers are Diameter and LineLength only, so its spill hole keeps its size.
  parachute: ['length', 'radius', 'radialPosition', 'diameter', 'lineLength'],
  streamer: ['length', 'radius', 'radialPosition', 'stripLength', 'stripWidth'],
  shockcord: ['length', 'radius', 'radialPosition', 'cordLength'],
  masscomponent: ['length', 'radius', 'radialPosition'],
  fairing: [],
  podset: ['radiusOffset'],
  parallelstage: ['radiusOffset'],
  stage: [],
};

/** Types whose own geometry is fixed hardware: they move, they do not grow. */
const FIXED_SIZE: ReadonlySet<ComponentType> = new Set<ComponentType>(['fairing']);

/**
 * A size the kernel works out for itself when its flag is set, which desktop's
 * scaler skips (`isRadiusAutomatic` on a mass object): the next resolve sets it.
 */
const AUTO_FLAG: Readonly<Record<string, string>> = { radius: 'radiusAuto' };

/**
 * A wall desktop leaves alone on a solid part: its SymmetricComponent Thickness
 * scaler is skipped while `isFilled`, so the stored wall is the same when the
 * part is made hollow again.
 */
const FILLED_WALL: ReadonlySet<ComponentType> = new Set<ComponentType>(['nosecone', 'transition', 'bodytube']);

/**
 * The keys that place a part rather than size it: how far off the axis it sits,
 * and the spacing between its instances. With the axial position and an
 * override CG, these are what desktop's **Scale component offsets** governs.
 */
const OFFSET_KEYS: ReadonlySet<string> = new Set(['radialPosition', 'radiusOffset', 'instanceSeparation']);

/**
 * The scale factor's bounds, desktop's ScaleDialog SCALE_MIN and SCALE_MAX. A
 * factor far past them (a mistyped exponent) cubes a mass to Infinity.
 */
export const SCALE_MIN = 0.01;
export const SCALE_MAX = 100;

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
    const flag = AUTO_FLAG[key];
    if (flag !== undefined && n[flag] === true) continue;
    if (key === 'thickness' && n['filled'] === true && FILLED_WALL.has(type)) continue;
    // A key the node leaves to the kernel flies the kernel's default, and that
    // is the value desktop's scalers scale: a new rail button's spacing, a new
    // chute's packed radius and length.
    const v = numOpt(n, key) ?? kernelDefault(type, key);
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

  // Pinned masses go as k³, but only where the geometry moved (a fixed-size
  // part is the same physical part after scaling and weighs the same). Desktop
  // cubes a mass component's mass and every override mass, a parachute's or a
  // shock cord's included, rather than following how the part's computed mass
  // grows.
  if (!fixed) {
    // Only a mass component's own mass is a typed mass desktop scales.
    const mass = type === 'masscomponent' ? numOpt(n, 'mass') : undefined;
    if (masses && mass !== undefined) out['mass'] = round(mass * k ** 3, 15);
    const override = numOpt(n, 'overrideMass');
    if (masses && offsets && override !== undefined) out['overrideMass'] = round(override * k ** 3, 15);
    // An override CG is a station from the component's own front: a length.
    const cg = numOpt(n, 'overrideCGX');
    if (offsets && cg !== undefined) out['overrideCGX'] = round(cg * k);
  }

  // Axial placement: startFromPosition is homogeneous of degree 1 in
  // (parentLength, childLength, offset), so scaling the offset alongside the
  // lengths keeps every part at the same relative station, fixed-size parts
  // included (they move to their new station, same as desktop's rule).
  // Desktop's AxialOffset scaler multiplies the stored offset whatever the
  // method, so an absolute offset, measured from the nose tip, scales from the
  // nose tip too: in a whole-rocket scale that is the same relative station,
  // and in a part scale it is k times the old station from the tip.
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
      // A member with no length key is the kernel's length for its type.
      if (isChainType(n.type)) total += partLength(n);
      walk(n.children ?? []);
    }
  };
  walk(tree.components);
  return total;
}

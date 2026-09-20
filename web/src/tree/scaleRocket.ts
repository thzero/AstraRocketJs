import type { ComponentNode, ComponentType, RocketTree } from '../engine/openRocketEngine';
import { isAssembly } from './assembly';
import { isChainType } from './componentKinds';
import { numOpt, positionOf } from './nodeProps';

/**
 * Scale a whole rocket by one factor — the "upscale/downscale a plan" workflow.
 * Ported from the sibling mmrocket-sim `tree/scaleRocket.ts`; the motor-mount
 * snapping half of that file (which needs a motor-class database) is left out —
 * this is the pure geometric scale.
 *
 * WHY A KEY LIST AND NOT A SCHEMA WALK: `ComponentNode` has an open index
 * signature and importers write length-valued keys no schema declares (freeform
 * `points`, ring/coupler radii, shoulder thicknesses, instance separations…),
 * while some declared lengths are NOT geometry (`deployAltitude` is an altitude
 * AGL). So the lists below are explicit per type, and a key scales only when it
 * is ALREADY PRESENT as a number — absence is a value in this tree (an absent
 * transition radius means AUTOMATIC; freezing it to `k × default` changes the
 * design).
 *
 * WHAT DOESN'T SCALE: a part sized by something OUTSIDE the rocket keeps its
 * size and only moves — a camera shroud (fairing), a rail button (preset
 * sizes), and a launch lug's BORE (the launch rod's diameter). Angles, counts,
 * densities, drag coefficients, finish, motor choice, deployment/separation and
 * the pad conditions are all untouched.
 *
 * MASS: densities are left alone, so a SOLID part's mass follows its volume and
 * goes as k³, a canopy/streamer as k² (surface), a shock cord as k (line). A
 * design carrying recovery gear is therefore not exactly similar after scaling.
 */

/**
 * Length-valued keys per component type. Present-only, multiplied by k.
 *
 * Keyed by `ComponentType`, not `string`: a type added to the union without a
 * row here is a compile error, where the open record silently scaled nothing
 * on it.
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
  // A lug's BORE is the launch rod's diameter and does not scale; its length does.
  launchlug: ['length', 'instanceSeparation'],
  // A rail button is a catalog part; the SPACING between a pair is an airframe span.
  railbutton: ['instanceSeparation'],
  // `length` is the PACKED length (orkImport reads <packedlength> into it) and
  // position.axialLength uses it for layout, so leaving it unscaled left a
  // 25 mm packed chute occupying 25 mm in a doubled airframe - and anything
  // positioned `middle` or `bottom` against it, plus the caliper snap targets
  // built from axialLength, landed at the wrong stations.
  parachute: ['length', 'diameter', 'spillHoleDiameter', 'lineLength'],
  streamer: ['length', 'stripLength', 'stripWidth'],
  shockcord: ['length', 'cordLength'],
  masscomponent: ['length', 'radius', 'radialPosition'],
  fairing: [],
  podset: ['radiusOffset'],
  parallelstage: ['radiusOffset'],
  stage: [],
};

/** Types whose own geometry is fixed hardware — they move, they do not grow. */
const FIXED_SIZE: ReadonlySet<ComponentType> = new Set<ComponentType>(['fairing', 'railbutton']);

/** Mass keys — scaled only on parts whose geometry actually scaled. */
const MASS_KEYS = ['mass', 'overrideMass'] as const;

/**
 * The exponent a PINNED mass scales by, per type — matching how the same part's
 * COMPUTED mass scales (densities are untouched): a solid is a volume (k³), a
 * canopy/streamer a surface (k²), a cord a line (k).
 *
 * Every type is listed. The table used to hold only the exceptions over an
 * open `Record<string, number>` with `?? 3` at the read, so the k³ cases were
 * implicit and a new type fell into them unreviewed; the launch-lug error
 * below is exactly what that produced.
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
  // A lug only grows in ONE dimension: its bore is the launch rod's diameter
  // and its wall goes with it, so LENGTH_KEYS.launchlug scales `length` alone.
  // The k^3 default therefore made a pinned 1 g lug weigh 8 g after a 2x scale
  // on a part that merely got twice as long, and that error lands straight in
  // the scaled design's total mass and CG.
  launchlug: 1,
  // Fixed-size hardware (FIXED_SIZE): the same physical part after scaling,
  // so its mass is never touched. k^0 = 1 says so even if the guard is lost.
  railbutton: 0,
  fairing: 0,
};

const round = (x: number, places = 12): number => {
  const p = 10 ** places;
  return Math.round(x * p) / p;
};

/** Scales one node's own fields. Children are handled by the caller. */
function scaleNode(n: ComponentNode, k: number): ComponentNode {
  const type = n.type;
  const fixed = FIXED_SIZE.has(type);
  const out: ComponentNode = { ...n };

  // `?? []` survives for a persisted node whose `type` the union does not
  // know: the table is complete for the union, not for arbitrary input.
  for (const key of LENGTH_KEYS[type] ?? []) {
    const v = numOpt(n, key);
    if (v !== undefined) out[key] = round(v * k);
  }

  // A freeform fin's planform lives entirely in `points` — [x along the body,
  // y off the surface], meters. Both coordinates scale.
  if (Array.isArray(n['points'])) {
    const pts = n['points'] as unknown[];
    out['points'] = pts.map((p) =>
      Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number'
        ? [round((p[0] as number) * k), round((p[1] as number) * k)]
        : p,
    );
  }

  // Pinned masses go as k^exp — but only where the geometry moved (a fixed-size
  // part is the same physical part after scaling and weighs the same).
  if (!fixed) {
    // Same `?? 3` reasoning as LENGTH_KEYS above: complete for the union, and
    // a solid is the safe reading of a type it has never seen.
    const exp = MASS_EXPONENT[type] ?? 3;
    for (const key of MASS_KEYS) {
      const v = numOpt(n, key);
      if (v !== undefined) out[key] = round(v * k ** exp, 15);
    }
    // An override CG is a station from the component's own front — a length.
    const cg = numOpt(n, 'overrideCGX');
    if (cg !== undefined) out['overrideCGX'] = round(cg * k);
  }

  // Axial placement: startFromPosition is homogeneous of degree 1 in
  // (parentLength, childLength, offset), so scaling the offset alongside the
  // lengths keeps every part at the same relative station — fixed-size parts
  // included (they move to their new station, same as desktop's rule).
  // `positionOf` validates the method and the offset the way position.ts now
  // reads them, so a string offset scales to the kernel's 0 rather than being
  // carried through untouched to disagree with the layout.
  if (n.position) {
    const pos = positionOf(n);
    out.position = { ...pos, offset: round(pos.offset * k) };
  }

  return out;
}

/**
 * Scale the whole design by `factor`, returning a NEW tree (the input is
 * untouched). A non-positive, non-finite or 1× factor is a no-op — the same
 * tree object is returned, so callers can cheaply detect "nothing to do".
 */
export function scaleRocket(tree: RocketTree, factor: number): RocketTree {
  if (!(factor > 0) || !Number.isFinite(factor) || factor === 1) return tree;
  const walk = (nodes: ComponentNode[]): ComponentNode[] =>
    nodes.map((n) => {
      const scaled = scaleNode(n, factor);
      return n.children ? ({ ...scaled, children: walk(n.children) } as ComponentNode) : scaled;
    });
  return { ...tree, components: walk(tree.components) };
}

/** The rocket's greatest body diameter (m) — what a "scale to a tube" factor divides. */
export function maxBodyDiameter(tree: RocketTree): number {
  let r = 0;
  const walk = (nodes: ComponentNode[]) => {
    for (const n of nodes) {
      const t = n.type;
      if (t === 'bodytube') r = Math.max(r, numOpt(n, 'outerRadius') ?? 0);
      else if (t === 'nosecone') r = Math.max(r, numOpt(n, 'aftRadius') ?? 0);
      else if (t === 'transition') r = Math.max(r, numOpt(n, 'foreRadius') ?? 0, numOpt(n, 'aftRadius') ?? 0);
      walk(n.children ?? []);
    }
  };
  walk(tree.components);
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

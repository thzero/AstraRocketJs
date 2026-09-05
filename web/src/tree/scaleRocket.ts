import type { ComponentNode, ComponentPosition, RocketTree } from '../engine/openRocketEngine';

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

const num = (n: ComponentNode, key: string): number | null =>
  typeof n[key] === 'number' && Number.isFinite(n[key] as number) ? (n[key] as number) : null;

/** Length-valued keys per component type. Present-only, multiplied by k. */
const LENGTH_KEYS: Record<string, readonly string[]> = {
  nosecone: ['length', 'aftRadius', 'thickness', 'shoulderRadius', 'shoulderLength', 'shoulderThickness'],
  transition: [
    'length', 'foreRadius', 'aftRadius', 'thickness',
    'foreShoulderRadius', 'foreShoulderLength', 'foreShoulderThickness',
    'aftShoulderRadius', 'aftShoulderLength', 'aftShoulderThickness',
  ],
  bodytube: ['length', 'outerRadius', 'thickness'],
  trapezoidfinset: [
    'rootChord', 'tipChord', 'sweep', 'height', 'thickness',
    'airfoilLeDiamond', 'airfoilTeDiamond', 'finLeRadius', 'tabHeight', 'tabLength', 'tabOffset', 'filletRadius',
  ],
  // `points` is the whole planform, handled separately below.
  freeformfinset: [
    'thickness', 'airfoilLeDiamond', 'airfoilTeDiamond', 'finLeRadius',
    'tabHeight', 'tabLength', 'tabOffset', 'filletRadius',
  ],
  ellipticalfinset: [
    'rootChord', 'height', 'thickness',
    'airfoilLeDiamond', 'airfoilTeDiamond', 'finLeRadius', 'tabHeight', 'tabLength', 'tabOffset', 'filletRadius',
  ],
  tubefinset: ['length', 'outerRadius', 'thickness'],
  innertube: ['length', 'outerRadius', 'thickness', 'radialPosition', 'maxMotorLength'],
  tubecoupler: ['length', 'thickness', 'outerRadius', 'innerRadius'],
  centeringring: ['length', 'outerRadius', 'innerRadius', 'instanceSeparation'],
  bulkhead: ['length', 'outerRadius', 'instanceSeparation'],
  engineblock: ['length', 'thickness', 'outerRadius'],
  // A lug's BORE is the launch rod's diameter and does not scale; its length does.
  launchlug: ['length', 'instanceSeparation'],
  // A rail button is a catalogue part; the SPACING between a pair is an airframe span.
  railbutton: ['instanceSeparation'],
  parachute: ['diameter', 'spillHoleDiameter', 'lineLength'],
  streamer: ['stripLength', 'stripWidth'],
  shockcord: ['cordLength'],
  masscomponent: ['length', 'radius', 'radialPosition'],
  fairing: [],
  protuberance: ['width', 'height', 'length'],
  podset: ['radiusOffset'],
  parallelstage: ['radiusOffset'],
  stage: [],
};

/** Types whose own geometry is fixed hardware — they move, they do not grow. */
const FIXED_SIZE = new Set(['fairing', 'railbutton']);

/** Mass keys — scaled only on parts whose geometry actually scaled. */
const MASS_KEYS = ['mass', 'overrideMass'] as const;

/**
 * The exponent a PINNED mass scales by, per type — matching how the same part's
 * COMPUTED mass scales (densities are untouched): a solid is a volume (k³), a
 * canopy/streamer a surface (k²), a cord a line (k).
 */
const MASS_EXPONENT: Record<string, number> = {
  parachute: 2,
  streamer: 2,
  shockcord: 1,
};

const round = (x: number, places = 12): number => {
  const p = 10 ** places;
  return Math.round(x * p) / p;
};

/** Scales one node's own fields. Children are handled by the caller. */
function scaleNode(n: ComponentNode, k: number): ComponentNode {
  const type = n.type as string;
  const fixed = FIXED_SIZE.has(type);
  const out: ComponentNode = { ...n };

  for (const key of LENGTH_KEYS[type] ?? []) {
    const v = num(n, key);
    if (v !== null) out[key] = round(v * k);
  }

  // A freeform fin's planform lives entirely in `points` — [x along the body,
  // y off the surface], metres. Both coordinates scale.
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
    const exp = MASS_EXPONENT[type] ?? 3;
    for (const key of MASS_KEYS) {
      const v = num(n, key);
      if (v !== null) out[key] = round(v * k ** exp, 15);
    }
    // An override CG is a station from the component's own front — a length.
    const cg = num(n, 'overrideCGX');
    if (cg !== null) out['overrideCGX'] = round(cg * k);
  }

  // Axial placement: startFromPosition is homogeneous of degree 1 in
  // (parentLength, childLength, offset), so scaling the offset alongside the
  // lengths keeps every part at the same relative station — fixed-size parts
  // included (they move to their new station, same as desktop's rule).
  const pos = n.position as ComponentPosition | undefined;
  if (pos && typeof pos.offset === 'number') {
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
      const t = n.type as string;
      if (t === 'bodytube') r = Math.max(r, num(n, 'outerRadius') ?? 0);
      else if (t === 'nosecone') r = Math.max(r, num(n, 'aftRadius') ?? 0);
      else if (t === 'transition') r = Math.max(r, num(n, 'foreRadius') ?? 0, num(n, 'aftRadius') ?? 0);
      walk(n.children ?? []);
    }
  };
  walk(tree.components);
  return r * 2;
}

/** Total nose-to-tail length (m) of the core axial chain, stages summed. Off-axis
 *  pods/parallel boosters are not part of the rocket's length. */
export function rocketLength(tree: RocketTree): number {
  const CHAIN = new Set(['nosecone', 'bodytube', 'transition']);
  const OFF_AXIS = new Set(['podset', 'parallelstage']);
  let total = 0;
  const walk = (nodes: ComponentNode[]) => {
    for (const n of nodes) {
      const t = n.type as string;
      if (OFF_AXIS.has(t)) continue;
      if (CHAIN.has(t)) total += num(n, 'length') ?? 0;
      walk(n.children ?? []);
    }
  };
  walk(tree.components);
  return total;
}

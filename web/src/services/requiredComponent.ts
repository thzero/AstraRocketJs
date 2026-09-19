import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';

/**
 * Component dimensions a ZERO makes nonsense of.
 *
 * Lives here rather than in the property panel because two different places
 * need the same answer: the panel, to mark the field, and the run path, to
 * refuse a design built on one. Keeping the list in the panel would have meant
 * the editor and the Run button deciding "is this valid" separately, which is
 * exactly the split that let the button and the run loop disagree about motors.
 *
 * Unlike the launch conditions -- where a cleared field had to be told apart
 * from a typed zero, because still air and sea level are real values -- a part
 * has no meaningful "blank length". Zero IS the invalid state, so there is no
 * second state to model and the field keeps storing a number.
 *
 * Marked conservatively: only where a zero makes the part stop being that part.
 * Plenty of dimensions are legitimately zero and are deliberately absent here --
 * a tipChord of 0 is a delta fin, a sweep or cant of 0 is a straight one, a
 * shoulder or fin tab of 0 is simply absent, a centering ring's innerRadius of 0
 * is a solid disc, a mass component's length of 0 is a point mass, and every
 * delay and angle offset starts at 0.
 */
export const REQUIRED_COMPONENT_FIELDS: Record<string, readonly string[]> = {
  nosecone: ['length', 'aftRadius', 'thickness'],
  bodytube: ['length', 'outerRadius', 'thickness'],
  transition: ['length', 'foreRadius', 'aftRadius', 'thickness'],
  trapezoidfinset: ['finCount', 'rootChord', 'height', 'thickness'],
  ellipticalfinset: ['finCount', 'rootChord', 'height', 'thickness'],
  // A freeform fin's outline comes from its points, not from chord and height.
  freeformfinset: ['finCount', 'thickness'],
  tubefinset: ['finCount', 'length', 'outerRadius', 'thickness'],
  innertube: ['length', 'outerRadius', 'thickness'],
  tubecoupler: ['length', 'outerRadius', 'thickness'],
  centeringring: ['length', 'outerRadius'],
  bulkhead: ['length', 'outerRadius'],
  engineblock: ['length', 'outerRadius', 'thickness'],
  launchlug: ['length', 'outerRadius'],
  railbutton: ['outerDiameter'],
  parachute: ['diameter', 'cd'],
  streamer: ['stripLength', 'stripWidth', 'cd'],
  masscomponent: ['mass'],
  podset: ['instanceCount'],
  parallelstage: ['instanceCount'],
};

/**
 * Dimensions OpenRocket DERIVES when the part does not carry one, so an absent
 * value means automatic rather than missing.
 *
 * Inner structure takes its outer radius from whatever it sits in, and a
 * centering ring takes its inner radius from the motor mount running through
 * it; the `.ork` spells that `auto` and the kernel recomputes it as the design
 * changes (`RadiusRingComponent.getOuterRadius`, `CenteringRing.getInnerRadius`).
 * `ComponentFactory` leaves the automatic flag on whenever the node has no
 * radius key, so absent here is a working part, not a broken one.
 *
 * A radius that IS present still has to be a real dimension: an automatic ring
 * and a ring explicitly sized to zero are different mistakes.
 */
export const AUTO_COMPONENT_FIELDS: Record<string, readonly string[]> = {
  centeringring: ['outerRadius', 'innerRadius'],
  bulkhead: ['outerRadius'],
  engineblock: ['outerRadius'],
  tubecoupler: ['outerRadius'],
};

/** True when this field may legitimately be absent because the kernel derives it. */
const isAuto = (type: string, field: string, value: unknown): boolean =>
  value == null && (AUTO_COMPONENT_FIELDS[type]?.includes(field) ?? false);

/** One dimension of one part that cannot be what it currently is. */
export interface BadDimension {
  /** Node id, when the part has one — enough to select it in the tree. */
  id?: string;
  type: string;
  /** The part's own name, falling back to its type for the message. */
  name: string;
  field: string;
}

/** True when this value is a usable dimension. Zero is not; nor is a blank. */
export const isDimension = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Every required dimension in the tree that is zero or missing, depth first so
 * the order matches the component tree the user is looking at.
 */
export function badDimensions(tree: RocketTree): BadDimension[] {
  const out: BadDimension[] = [];
  const visit = (n: ComponentNode) => {
    for (const field of REQUIRED_COMPONENT_FIELDS[n.type] ?? []) {
      if (isAuto(n.type, field, n[field])) continue;
      if (!isDimension(n[field])) {
        out.push({ id: n.id, type: n.type, name: typeof n.name === 'string' && n.name ? n.name : n.type, field });
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  for (const c of tree.components ?? []) visit(c);
  return out;
}

import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { num } from '../../tree/nodeProps';
import { tubeFinRadius } from '../../tree/tubefins';
import { DISC_TYPES } from '../files/componentFormats';
import { boreAround, ringBore, tubeRadii } from './discGeometry';
import { mapTreePreserving, type MapContext } from '../../tree/treeWalk';
import { isChainType } from '../../tree/componentKinds';

/**
 * Diameters that follow the part next door: OpenRocket's **Automatic**
 * checkbox, on a nose cone's base, a transition's two ends and a body tube's
 * outside.
 *
 * The kernel's rules, from `SymmetricComponent`, `Transition` and `BodyTube`:
 *
 * - The part ahead and the part behind are the neighboring symmetric
 *   components along the airframe, across stage boundaries
 *   (`getPreviousSymmetricComponent`, `getNextSymmetricComponent`). Inside a
 *   pod set or a side booster the search stays within it, because the parts
 *   around it are off its axis.
 * - A transition's automatic fore end takes what the part ahead offers at its
 *   aft end, and its automatic aft end what the part behind offers at its fore
 *   end; with no part there, `DEFAULT_RADIUS`.
 * - An automatic body tube asks the part ahead first and the part behind
 *   second, skipping a neighbor that is itself sizing from this tube, and
 *   falls back to `DEFAULT_RADIUS` (`getAutoOuterRadius`).
 * - What a part offers (`getFrontAutoRadius`, `getRearAutoRadius`): a cone or
 *   transition offers the end facing the asker unless that end is automatic;
 *   an automatic body tube passes the question on to the part beyond it.
 *
 * A flipped nose cone is a tail cone: its base is the fore end, so an
 * automatic base follows the part ahead of it.
 *
 * Two automatic ends that each follow the other have no answer: the kernel
 * returns -1 for them. The stored radius is kept as it is in that case.
 *
 * Stored as an explicit flag with the resolved number beside it, the same shape
 * as {@link syncAutoShoulders}, rather than as the absence of a radius, which
 * is how the `.ork` spells it. Absence would mean every one of the dozen places
 * that reads a radius to draw, mesh, export or measure has to know the rule and
 * have the chain in hand; the number is kept correct on every edit instead, and
 * only the file writer and the engine bridge care that it was automatic.
 */

/** `SymmetricComponent.DEFAULT_RADIUS`: what an automatic end with nothing to follow takes (m). */
export const KERNEL_AUTO_RADIUS = 0.025;

/** One symmetric component's two ends, as the neighbor rules see them. */
interface Ends {
  node: ComponentNode;
  tube: boolean;
  fore: number;
  aft: number;
  foreAuto: boolean;
  aftAuto: boolean;
}

const hasRadius = (node: ComponentNode, key: string): boolean => Number.isFinite(node[key]);

function endsOf(node: ComponentNode): Ends {
  const r = (key: string) => num(node, key, 0);
  switch (node.type) {
    case 'bodytube': {
      const auto = node['outerRadiusAuto'] === true;
      return { node, tube: true, fore: r('outerRadius'), aft: r('outerRadius'), foreAuto: auto, aftAuto: auto };
    }
    case 'nosecone': {
      // `aftRadius` is the base wherever it sits; flipped, the base is in front.
      const auto = node['aftRadiusAuto'] === true;
      return node['flipped'] === true
        ? { node, tube: false, fore: r('aftRadius'), aft: 0, foreAuto: auto, aftAuto: false }
        : { node, tube: false, fore: 0, aft: r('aftRadius'), foreAuto: false, aftAuto: auto };
    }
    default:
      return {
        node,
        tube: false,
        fore: r('foreRadius'),
        aft: r('aftRadius'),
        // An end with no radius is automatic, as ComponentFactory builds it.
        foreAuto: node['foreRadiusAuto'] === true || !hasRadius(node, 'foreRadius'),
        aftAuto: node['aftRadiusAuto'] === true || !hasRadius(node, 'aftRadius'),
      };
  }
}

/**
 * The symmetric components in airframe order, one chain per axis: the stages
 * end to end, and each pod set or side booster on its own.
 */
function chains(components: ComponentNode[]): ComponentNode[][] {
  const main: ComponentNode[] = [];
  for (const top of components) {
    const row = top.type === 'stage' ? (top.children ?? []) : [top];
    main.push(...row.filter((c) => isChainType(c.type)));
  }
  const out: ComponentNode[][] = [main];
  const pods = (nodes: ComponentNode[]) => {
    for (const n of nodes) {
      if (n.type === 'podset' || n.type === 'parallelstage') {
        out.push((n.children ?? []).filter((c) => isChainType(c.type)));
      }
      pods(n.children ?? []);
    }
  };
  pods(components);
  return out;
}

type Patch = Partial<Record<string, number | boolean>>;

/** The resolved automatic radii of one chain, keyed by node. */
function resolveChain(chain: ComponentNode[], out: Map<ComponentNode, Patch>): void {
  const ends = chain.map(endsOf);
  const last = ends.length - 1;
  // Which neighbor each automatic tube took its radius from: `BodyTube.refComp`.
  // The kernel keeps it as state and reads whatever it holds, so a tube still
  // being resolved counts as following no one.
  const ref = new Map<number, -1 | 1 | null>();
  const busy = new Set<number>();

  /** `getFrontAutoRadius`: what part i offers the part behind it. */
  const front = (i: number): number => {
    const e = ends[i]!;
    if (e.tube) return e.aftAuto ? (i > 0 ? front(i - 1) : -1) : e.aft;
    return e.aftAuto ? -1 : e.aft;
  };
  /** `getRearAutoRadius`: what part i offers the part ahead of it. */
  const rear = (i: number): number => {
    const e = ends[i]!;
    if (e.tube) return e.foreAuto ? (i < last ? rear(i + 1) : -1) : e.fore;
    return e.foreAuto ? -1 : e.fore;
  };
  /** `BodyTube.getAutoOuterRadius`. */
  const tubeRadius = (i: number): number => {
    busy.add(i);
    let r = -1;
    let from: -1 | 1 | null = null;
    if (i > 0) {
      from = -1;
      if (!usesNext(i - 1)) r = front(i - 1);
    }
    if (r < 0 && i < last && !usesPrev(i + 1)) {
      from = 1;
      r = rear(i + 1);
    }
    busy.delete(i);
    ref.set(i, from);
    return r < 0 ? KERNEL_AUTO_RADIUS : r;
  };
  const tubeRef = (i: number): -1 | 1 | null => {
    if (!ref.has(i) && !busy.has(i)) tubeRadius(i);
    return ref.get(i) ?? null;
  };
  const usesNext = (i: number): boolean => {
    const e = ends[i]!;
    return e.tube ? e.aftAuto && tubeRef(i) === 1 : e.aftAuto;
  };
  const usesPrev = (i: number): boolean => {
    const e = ends[i]!;
    return e.tube ? e.foreAuto && tubeRef(i) === -1 : e.foreAuto;
  };

  ends.forEach((e, i) => {
    const patch: Patch = {};
    if (e.tube) {
      if (e.foreAuto) patch['outerRadius'] = tubeRadius(i);
    } else {
      const foreR = e.foreAuto ? (i > 0 ? front(i - 1) : KERNEL_AUTO_RADIUS) : null;
      const aftR = e.aftAuto ? (i < last ? rear(i + 1) : KERNEL_AUTO_RADIUS) : null;
      if (e.node.type === 'nosecone') {
        const base = e.node['flipped'] === true ? foreR : aftR;
        if (base !== null && base >= 0) patch['aftRadius'] = base;
      } else {
        if (foreR !== null && foreR >= 0) Object.assign(patch, { foreRadius: foreR, foreRadiusAuto: true });
        if (aftR !== null && aftR >= 0) Object.assign(patch, { aftRadius: aftR, aftRadiusAuto: true });
      }
    }
    if (Object.keys(patch).length) out.set(e.node, patch);
  });
}

/**
 * The rules that look at a part's parent rather than at its neighbors.
 *
 * A ring, coupler, bulkhead or engine block fills the bore of the part it sits
 * in, at its own two faces (`boreAround`), and a centering ring's own bore is
 * the motor mount running through it (`ringBore`). The resolved numbers are
 * stored, so the DXF sheet, the print solids and the drawings read them. A tube fin set with no diameter is sized by the kernel from the body
 * radius and the fin count (`TubeFinSet.getOuterRadius`, ported in
 * tree/tubefins.ts).
 */
function parentDerived(node: ComponentNode, parent: ComponentNode | null): void {
  if (!parent) return;
  if (node.type === 'tubefinset' && node['outerRadiusAuto'] === true) {
    const body = num(parent, 'outerRadius', NaN);
    // The stored radius is the last resolved one, not a size the user chose:
    // `tubeFinRadius` returns any stored radius as is, so it is left out here.
    if (Number.isFinite(body) && body > 0)
      node['outerRadius'] = tubeFinRadius({ ...node, outerRadius: undefined }, body);
    return;
  }
  // A mass object's automatic packed radius is the room its parent gives it:
  // `MassObject.getMaxParentRadius`.
  if (node['radiusAuto'] === true) {
    const r =
      parent.type === 'nosecone'
        ? num(parent, 'aftRadius', 0)
        : parent.type === 'transition'
          ? Math.max(num(parent, 'foreRadius', 0), num(parent, 'aftRadius', 0))
          : (tubeRadii(parent)?.innerR ?? 0);
    if (r > 0) node['radius'] = r;
  }
  if (!DISC_TYPES.has(node.type)) return;
  if (node['outerRadiusAuto'] === true) {
    const outer = boreAround(node, parent);
    // Zero where the parent has no bore there, as at a nose cone's tip: the
    // kernel's answer, which the pre-run check then reports.
    if (outer !== null) node['outerRadius'] = outer;
  }
  if (node.type === 'centeringring' && node['innerRadiusAuto'] === true) {
    node['innerRadius'] = ringBore(node, parent, num(node, 'outerRadius', 0));
  }
}

/**
 * Resolve every automatic diameter in the tree against its current neighbors.
 *
 * Runs after each tree edit, so widening a body tube moves the transition
 * plugged into it in the same keystroke. Returns the same arrays and nodes
 * where nothing changed.
 */
export function syncAutoRadii(tree: RocketTree): RocketTree {
  // The airframe first, from the stored radii of the parts it follows; then
  // everything sized from a parent, pre-order below.
  const axial = new Map<ComponentNode, Patch>();
  for (const chain of chains(tree.components)) resolveChain(chain, axial);
  const resolve = (n: ComponentNode, { parent }: MapContext): ComponentNode => {
    let node = n;
    // Rings, tube fins and packed devices take their size from what they are
    // inside, not from the part beside them, so they resolve against the
    // parent rather than through the neighbor rules.
    if (node['outerRadiusAuto'] === true || node['innerRadiusAuto'] === true || node['radiusAuto'] === true) {
      const before = { outer: node['outerRadius'], inner: node['innerRadius'], r: node['radius'] };
      const draft = { ...node };
      parentDerived(draft, parent);
      if (
        draft['outerRadius'] !== before.outer ||
        draft['innerRadius'] !== before.inner ||
        draft['radius'] !== before.r
      ) {
        node = draft;
      }
    }
    const patch = axial.get(n);
    if (patch && Object.entries(patch).some(([k, v]) => node[k] !== v)) node = { ...node, ...patch };
    return node;
  };
  // Pre-order: children last, so each one sees a parent whose own radius is
  // already resolved. Resolved inside-out, a disc inside an automatic-radius
  // coupler would take the coupler's bare default instead of its real bore (on
  // a 3-inch airframe, a bulkhead 24.00 mm across rather than 72.2), and the
  // schematic, the DXF and the printed template would all repeat it. Every
  // coupler the Add menu makes is automatic.
  const components = mapTreePreserving(tree.components, resolve, 'pre');
  return components === tree.components ? tree : { ...tree, components };
}

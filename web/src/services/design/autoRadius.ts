import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { num } from '../../tree/nodeProps';
import { tubeFinRadius } from '../../tree/tubefins';
import { DISC_TYPES } from '../files/componentFormats';
import { discDims, tubeRadii } from './discGeometry';
import { KERNEL_DEFAULTS } from '../../tree/kernelDefaults';

/**
 * Diameters that follow the part next door: OpenRocket's **Automatic**
 * checkbox, on a nose cone's base, a transition's two ends and a body tube's
 * outside.
 *
 * The desktop's rule, from `BodyTube.getAutoOuterRadius` and
 * `Transition.getForeRadius`/`getAftRadius`: take the PREVIOUS symmetric
 * component's aft radius, else the NEXT one's fore radius, and skip a neighbor
 * whose own facing end is automatic, which is what stops two parts pointing at
 * each other. With nothing to follow it falls back to the kernel's default
 * radius, the same number the desktop shows.
 *
 * Stored as an explicit flag with the resolved number beside it, the same shape
 * as {@link syncAutoShoulders}, rather than as the ABSENCE of a radius, which
 * is how the `.ork` spells it. Absence would mean every one of the dozen places
 * that reads a radius to draw, mesh, export or measure has to know the rule and
 * have the chain in hand; the number is kept correct on every edit instead, and
 * only the file writer and the engine bridge care that it was automatic.
 */

/** Which radius of a part follows a neighbor, and which way it looks. */
const AUTO: Record<string, readonly { radius: string; flag: string; side: -1 | 1 }[]> = {
  nosecone: [{ radius: 'aftRadius', flag: 'aftRadiusAuto', side: 1 }],
  transition: [
    { radius: 'foreRadius', flag: 'foreRadiusAuto', side: -1 },
    { radius: 'aftRadius', flag: 'aftRadiusAuto', side: 1 },
  ],
  // A body tube is one diameter end to end, so it looks both ways: behind
  // first, exactly as the kernel does.
  bodytube: [{ radius: 'outerRadius', flag: 'outerRadiusAuto', side: -1 }],
};

/** The radius a neighbor offers at the end that faces us, or null if it has none. */
function facingRadius(node: ComponentNode | undefined, end: 'fore' | 'aft'): number | null {
  if (!node) return null;
  switch (node.type) {
    case 'bodytube': {
      // A tube whose own diameter is automatic cannot lend one.
      if (node['outerRadiusAuto'] === true) return null;
      const r = num(node, 'outerRadius', NaN);
      return Number.isFinite(r) && r > 0 ? r : null;
    }
    case 'transition': {
      const key = end === 'aft' ? 'aftRadius' : 'foreRadius';
      if (node[`${key}Auto`] === true) return null;
      const r = num(node, key, NaN);
      return Number.isFinite(r) && r > 0 ? r : null;
    }
    case 'nosecone': {
      // Its front is a point; only its base can be followed.
      if (end !== 'aft' || node['aftRadiusAuto'] === true) return null;
      const r = num(node, 'aftRadius', NaN);
      return Number.isFinite(r) && r > 0 ? r : null;
    }
    default:
      return null;
  }
}

/**
 * The rules that look at a part's PARENT rather than at its neighbors.
 *
 * A ring, coupler, bulkhead or engine block fills the bore of the tube it sits
 * in, and a centering ring's own bore is the motor mount running through it -
 * `discDims` is that resolution, shared with the DXF sheet and the print
 * solids. A tube fin set with no diameter is sized by the kernel from the body
 * radius and the fin count (`TubeFinSet.getOuterRadius`, ported in
 * tree/tubefins.ts).
 */
function parentDerived(node: ComponentNode, parent: ComponentNode | null, siblings: ComponentNode[]): void {
  if (!parent) return;
  if (node.type === 'tubefinset' && node['outerRadiusAuto'] === true) {
    const body = num(parent, 'outerRadius', NaN);
    if (Number.isFinite(body) && body > 0) node['outerRadius'] = tubeFinRadius(node, body);
    return;
  }
  // A mass object's automatic PACKED radius is the room its parent gives it:
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
  const d = discDims({ ...node, outerRadius: undefined, innerRadius: undefined }, tubeRadii(parent), siblings);
  if (!d) return;
  if (node['outerRadiusAuto'] === true && d.outerR > 0) node['outerRadius'] = d.outerR;
  if (node['innerRadiusAuto'] === true && d.innerR >= 0) node['innerRadius'] = d.innerR;
}

/**
 * Resolve every automatic diameter in the tree against its current neighbors.
 *
 * Runs after each tree edit, so widening a body tube moves the transition
 * plugged into it in the same keystroke. Returns the same arrays and nodes
 * where nothing changed.
 */
export function syncAutoRadii(tree: RocketTree): RocketTree {
  const chain = (nodes: ComponentNode[], parent: ComponentNode | null = null): ComponentNode[] => {
    let changed = false;
    const out = nodes.map((n, i) => {
      let node = n;
      // Rings, tube fins and packed devices take their size from what they are
      // INSIDE, not from the part beside them, so they resolve against the
      // parent rather than through the neighbor rule below.
      if (node['outerRadiusAuto'] === true || node['innerRadiusAuto'] === true || node['radiusAuto'] === true) {
        const before = { outer: node['outerRadius'], inner: node['innerRadius'], r: node['radius'] };
        const draft = { ...node };
        parentDerived(draft, parent, nodes);
        if (
          draft['outerRadius'] !== before.outer ||
          draft['innerRadius'] !== before.inner ||
          draft['radius'] !== before.r
        ) {
          node = draft;
          changed = true;
        }
      }
      for (const spec of AUTO[node.type] ?? []) {
        if (node[spec.flag] !== true) continue;
        // Behind first, then ahead, as the kernel does. The neighbor is read
        // from the ORIGINAL row: a resolved radius is not a source for anyone
        // else, because a neighbor that is itself automatic is skipped.
        const behind = facingRadius(nodes[i - 1], 'aft');
        const ahead = facingRadius(nodes[i + 1], 'fore');
        const first = spec.side === -1 ? behind : ahead;
        const r = first ?? (spec.side === -1 ? ahead : behind) ?? KERNEL_DEFAULTS.bodytube.outerRadius;
        if (node[spec.radius] !== r) {
          node = { ...node, [spec.radius]: r };
          changed = true;
        }
      }
      // CHILDREN LAST, so each one sees a parent whose own radius is already
      // resolved. Resolving inside-out gave a disc inside an AUTOMATIC-radius
      // coupler the coupler's bare default instead of its real bore: on a
      // 3-inch airframe a bulkhead came out 24.00 mm across rather than 72.2,
      // which is what the schematic drew, the DXF cut and the printed template
      // measured. Every coupler the Add menu makes is automatic, so the only
      // way to miss it was to size the coupler by hand first.
      if (node.children) {
        const kids = chain(node.children, node);
        if (kids !== node.children) {
          node = { ...node, children: kids };
          changed = true;
        }
      }
      return node;
    });
    return changed ? out : nodes;
  };
  const components = chain(tree.components);
  return components === tree.components ? tree : { ...tree, components };
}

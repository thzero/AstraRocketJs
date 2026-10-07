import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { boreAt } from './discGeometry';
import { mapTreePreserving, type MapContext } from '../../tree/treeWalk';

/**
 * Shoulders that follow the tube they plug into.
 *
 * A shoulder diameter is never a free choice: it is the bore of the part next
 * door, and typing it again on every nose cone and transition is transcription,
 * with the usual consequence that resizing the tube leaves the stub at the old
 * size and nothing says so.
 *
 * It is an explicit FLAG rather than "absent means derive it", which is how
 * OpenRocket spells auto for a ring's radius (see AUTO_COMPONENT_FIELDS). For
 * a ring, absent means "fill the tube". For a shoulder, absent already means
 * "this part has no shoulder" - the starting design and most imported files
 * are exactly that - so deriving from absence would grow a shoulder on every
 * design ever loaded and quietly change its mass and CG. The flag is set on
 * parts created here and never on parts read from a file.
 *
 * Only the DIAMETER follows. A shoulder's length is a build decision (how far
 * into the tube it reaches), so a part with an auto diameter and no length
 * still has no shoulder, which is the right starting point.
 *
 * `.ork` has no tag for this, so export writes the resolved number and a
 * desktop round trip freezes it at that value. That is why the resolved number
 * is written into the node here rather than computed at each read site: every
 * consumer - the kernel bridge, both views, the DXF sheet, the print solids and
 * the writer - then sees a plain dimension and needs to know nothing about it.
 */

/** Which shoulder follows which neighbor: -1 is the part above, +1 below. */
const SHOULDERS: Record<string, readonly { auto: string; radius: string; side: -1 | 1 }[]> = {
  nosecone: [{ auto: 'shoulderAuto', radius: 'shoulderRadius', side: 1 }],
  transition: [
    { auto: 'foreShoulderAuto', radius: 'foreShoulderRadius', side: -1 },
    { auto: 'aftShoulderAuto', radius: 'aftShoulderRadius', side: 1 },
  ],
};

/**
 * Resolve every auto shoulder in the tree against its current neighbor.
 *
 * Runs after each tree edit (see treeEdit), so widening a body tube updates the
 * nose cone plugged into it in the same keystroke. Returns the SAME arrays and
 * nodes where nothing changed, so an edit elsewhere in the rocket does not
 * invalidate memos that depend on the parts it did not touch.
 */
export function syncAutoShoulders(tree: RocketTree): RocketTree {
  const resolve = (n: ComponentNode, { index, siblings }: MapContext): ComponentNode => {
    let node = n;
    for (const s of SHOULDERS[node.type] ?? []) {
      if (node[s.auto] !== true) continue;
      // The neighbor is read from the ORIGINAL row: a shoulder never changes
      // the bore it is measured against, so there is no ordering to get wrong.
      const neighbor = siblings[index + s.side];
      const bore = neighbor ? boreAt(neighbor, s.side === -1 ? 'aft' : 'fore') : null;
      // No neighbor yet, or one with no bore to plug: leave the stored value
      // alone rather than zeroing a shoulder somebody typed. Adding the tube
      // later fills it in on that edit.
      if (bore !== null && node[s.radius] !== bore) node = { ...node, [s.radius]: bore };
    }
    return node;
  };
  // Post-order: a node's children are resolved before the node itself.
  const components = mapTreePreserving(tree.components, resolve, 'post');
  return components === tree.components ? tree : { ...tree, components };
}

import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { boreAt, endAt } from './discGeometry';
import { num } from '../../tree/nodeProps';
import { KERNEL_AUTO_RADIUS } from '../../tree/kernelDefaults';
import { COMPONENT_DEFAULTS } from './componentDefaults';
import { mapTreePreserving, type MapContext } from '../../tree/treeWalk';

/**
 * Shoulders that follow the tube they plug into.
 *
 * A shoulder diameter is never a free choice: it is the bore of the part next
 * door, and typing it again on every nose cone and transition is transcription,
 * with the usual consequence that resizing the tube leaves the stub at the old
 * size and nothing says so.
 *
 * It is an explicit flag rather than "absent means derive it", which is how
 * OpenRocket spells auto for a ring's radius (see AUTO_COMPONENT_FIELDS). For
 * a ring, absent means "fill the tube". For a shoulder, absent already means
 * "this part has no shoulder" (the starting design and most imported files
 * are exactly that), so deriving from absence would grow a shoulder on every
 * design ever loaded and quietly change its mass and CG. The flag is set on
 * parts created here and never on parts read from a file.
 *
 * Only the diameter follows. A shoulder's length is a build decision (how far
 * into the tube it reaches), so a part with an auto diameter and no length
 * still has no shoulder, which is the right starting point.
 *
 * `.ork` has no tag for this, so export writes the resolved number and a
 * desktop round trip freezes it at that value. That is why the resolved number
 * is written into the node here rather than computed at each read site: every
 * consumer (the kernel bridge, both views, the DXF sheet, the print solids and
 * the writer) then sees a plain dimension and needs to know nothing about it.
 */

/** Which shoulder follows which neighbor: -1 is the part above, +1 below. */
const SHOULDERS: Record<
  string,
  readonly { auto: string; length: string; radius: string; thickness: string; capped: string; side: -1 | 1 }[]
> = {
  nosecone: [
    {
      auto: 'shoulderAuto',
      length: 'shoulderLength',
      radius: 'shoulderRadius',
      thickness: 'shoulderThickness',
      capped: 'shoulderCapped',
      side: 1,
    },
  ],
  transition: [
    {
      auto: 'foreShoulderAuto',
      length: 'foreShoulderLength',
      radius: 'foreShoulderRadius',
      thickness: 'foreShoulderThickness',
      capped: 'foreShoulderCapped',
      side: -1,
    },
    {
      auto: 'aftShoulderAuto',
      length: 'aftShoulderLength',
      radius: 'aftShoulderRadius',
      thickness: 'aftShoulderThickness',
      capped: 'aftShoulderCapped',
      side: 1,
    },
  ],
};

const isZero = (v: number): boolean => Math.abs(v) < 1e-8;

/**
 * What a shoulder length edit brings with it, as desktop's setter does it
 * (`Transition.setForeShoulderLength`, `setAftShoulderLength`; a nose cone's
 * shoulder is the one at its base). A shoulder that grows from length 0 takes
 * the neighbor's wall and a radius of the neighbor's radius less that wall,
 * each only where it was 0, and is capped. With no neighbor the wall is the
 * part's own and the radius `SymmetricComponent.DEFAULT_RADIUS` less it. A
 * shoulder set back to 0 loses its radius, wall and cap. Desktop applies a
 * catalog part through the same setter (`Transition.loadFromPreset`).
 *
 * Without it the bridge, which flies the wall the node states, would fly a
 * shoulder with no wall and no cap where desktop flies one with both.
 *
 * `before` is the node as it was, `after` with the edit applied, `siblings`
 * and `index` where it sits. Keys the edit states itself are left alone.
 */
export function shoulderSeed(
  before: ComponentNode,
  after: ComponentNode,
  edit: Partial<ComponentNode>,
  siblings: readonly ComponentNode[],
  index: number,
): Partial<ComponentNode> {
  const out: Record<string, unknown> = {};
  const free = (k: string) => !(k in edit);
  for (const s of SHOULDERS[after.type] ?? []) {
    const was = num(before, s.length, 0);
    const now = num(after, s.length, 0);
    if (isZero(was) && !isZero(now)) {
      const side = sideOf(after, s.side);
      const neighbor = siblings[index + side];
      const e = neighbor ? endAt(neighbor, side === -1 ? 'aft' : 'fore') : null;
      // A neighbor that is solid, or a nose cone's tip, offers no wall to take.
      if (!neighbor || e) {
        const own = num(after, 'thickness', COMPONENT_DEFAULTS[after.type as 'nosecone' | 'transition'].thickness);
        const wall = e ? e.wall : own;
        const radius = (e ? e.outer : KERNEL_AUTO_RADIUS) - wall;
        if (free(s.thickness) && isZero(num(after, s.thickness, 0))) out[s.thickness] = wall;
        if (free(s.radius) && isZero(num(after, s.radius, 0))) out[s.radius] = Math.max(0, radius);
      }
      if (free(s.capped)) out[s.capped] = true;
    } else if (!isZero(was) && isZero(now)) {
      if (free(s.radius)) out[s.radius] = 0;
      if (free(s.thickness)) out[s.thickness] = 0;
      if (free(s.capped)) out[s.capped] = false;
    }
  }
  return out;
}

/**
 * A flipped nose cone is a tail cone: its base, and the shoulder on it, face
 * forward into the part ahead (`NoseCone.setFlipped` moves the aft shoulder
 * to the fore end).
 */
const sideOf = (node: ComponentNode, side: -1 | 1): -1 | 1 =>
  node.type === 'nosecone' && node['flipped'] === true ? -1 : side;

/**
 * Resolve every auto shoulder in the tree against its current neighbor.
 *
 * Runs after each tree edit (see treeEdit), so widening a body tube updates the
 * nose cone plugged into it in the same keystroke. Returns the same arrays and
 * nodes where nothing changed, so an edit elsewhere in the rocket does not
 * invalidate memos that depend on the parts it did not touch.
 */
export function syncAutoShoulders(tree: RocketTree): RocketTree {
  const resolve = (n: ComponentNode, { index, siblings }: MapContext): ComponentNode => {
    let node = n;
    for (const s of SHOULDERS[node.type] ?? []) {
      if (node[s.auto] !== true) continue;
      // The neighbor is read from the original row: a shoulder never changes
      // the bore it is measured against, so there is no ordering to get wrong.
      const neighbor = siblings[index + sideOf(node, s.side)];
      const bore = neighbor ? boreAt(neighbor, sideOf(node, s.side) === -1 ? 'aft' : 'fore') : null;
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

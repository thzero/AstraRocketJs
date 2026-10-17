import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { boreAt, endAt } from './discGeometry';
import { num } from '../../tree/nodeProps';
import { KERNEL_AUTO_RADIUS, KERNEL_DEFAULTS } from '../../tree/kernelDefaults';
import { COMPONENT_DEFAULTS } from './componentDefaults';
import { mapTreePreserving, type MapContext } from '../../tree/treeWalk';
import { isZero } from '../motors/mathEquals';
import { symmetricNeighbors, type Neighbors } from './autoRadius';

/**
 * Shoulders that follow the tube they plug into.
 *
 * A shoulder diameter is never a free choice: it is the bore of the part next
 * door, and typing it again on every nose cone and transition is transcription,
 * with the usual consequence that resizing the tube leaves the stub at the old
 * size and nothing says so.
 *
 * It is an explicit flag rather than "absent means derive it", which is how
 * OpenRocket spells auto for a ring's radius (`RadiusRingComponent`). For
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

/**
 * The part a shoulder plugs into: the airframe part on `side` of `node` as the
 * kernel finds it ({@link symmetricNeighbors}), across stages, through pod sets
 * and boosters in line with the airframe, and through an assembly flush with a
 * tube's end, with the radius it offers there. `neighbors` is that map for
 * the tree `node` sits in.
 */
const neighborOf = (
  neighbors: Map<ComponentNode, Neighbors>,
  node: ComponentNode,
  side: -1 | 1,
): { node: ComponentNode; offers: number } | null => {
  const n = neighbors.get(node);
  const found = n ? (side === -1 ? n.previous : n.next) : null;
  return found && n ? { node: found, offers: side === -1 ? n.previousOffers : n.nextOffers } : null;
};

/**
 * What a shoulder length edit brings with it, as the kernel's setter does it
 * (`Transition.setForeShoulderLength`, `setAftShoulderLength`; a nose cone's
 * shoulder is the one at its base). A shoulder that grows from length 0 takes
 * the neighbor's wall and a radius of the radius the neighbor offers at that
 * end less that wall, each only where it was 0, and is capped. With no
 * neighbor the wall is the part's own and the radius
 * `SymmetricComponent.DEFAULT_RADIUS` less it. A shoulder set back to 0 loses
 * its radius, wall and cap. A catalog pick states
 * its shoulder's radius and cap itself (`presetShoulder` in treeEdit). The
 * neighbor is the one the kernel finds ({@link neighborOf}), and the seeded
 * radius stops at the part's own end (`setForeShoulderRadius` and
 * `setAftShoulderRadius` clamp it).
 *
 * Without it the bridge, which flies the wall the node states, would fly a
 * shoulder with no wall and no cap where the kernel's edit gives it both.
 *
 * `before` is the node as it was, `after` with the edit applied, `components`
 * the top level of the tree `before` sits in. Keys the edit states itself are
 * left alone.
 */
export function shoulderSeed(
  before: ComponentNode,
  after: ComponentNode,
  edit: Partial<ComponentNode>,
  components: readonly ComponentNode[],
): Partial<ComponentNode> {
  const out: Record<string, unknown> = {};
  const free = (k: string) => !(k in edit);
  let neighbors: Map<ComponentNode, Neighbors> | null = null;
  for (const s of SHOULDERS[after.type] ?? []) {
    const was = num(before, s.length, 0);
    const now = num(after, s.length, 0);
    if (isZero(was) && !isZero(now)) {
      const side = sideOf(after, s.side);
      neighbors ??= symmetricNeighbors(components);
      const found = neighborOf(neighbors, before, side);
      const neighbor = found?.node ?? null;
      const solid = neighbor?.['filled'] === true;
      const open = neighbor
        ? endAt(solid ? { ...neighbor, filled: false } : neighbor, side === -1 ? 'aft' : 'fore')
        : null;
      // A nose cone's tip offers no end to plug.
      if (!neighbor || open) {
        // `SymmetricComponent.getThickness`, the neighbor's or with none the
        // part's own: a solid part's wall is its widest radius.
        const own =
          after['filled'] === true
            ? solidWall(after)
            : num(after, 'thickness', COMPONENT_DEFAULTS[after.type as 'nosecone' | 'transition'].thickness);
        const wall = !neighbor ? own : solid ? solidWall(neighbor) : open!.wall;
        // The radius the neighbor offers (`getFrontAutoRadius`, `getRearAutoRadius`),
        // read through an automatic tube to the part beyond it. Where nothing
        // fixed lies beyond, the kernel's -1 would seed a negative shoulder, so
        // the tube's resolved radius is taken instead.
        const outer = !neighbor ? KERNEL_AUTO_RADIUS : found!.offers >= 0 ? found!.offers : open!.outer;
        const end = shoulderEnd(after, s.side);
        const radius = Math.max(0, outer - wall);
        if (free(s.thickness) && isZero(num(after, s.thickness, 0))) out[s.thickness] = wall;
        if (free(s.radius) && isZero(num(after, s.radius, 0)))
          out[s.radius] = end === null ? radius : Math.min(radius, end);
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

/** A solid part's widest radius, which `SymmetricComponent.getThickness` reports as its wall. */
const solidWall = (node: ComponentNode): number => {
  const open = { ...node, filled: false };
  return Math.max(endAt(open, 'fore')?.outer ?? 0, endAt(open, 'aft')?.outer ?? 0);
};

/**
 * A flipped nose cone is a tail cone: its base, and the shoulder on it, face
 * forward into the part ahead (`NoseCone.setFlipped` moves the aft shoulder
 * to the fore end).
 */
const sideOf = (node: ComponentNode, side: -1 | 1): -1 | 1 =>
  node.type === 'nosecone' && node['flipped'] === true ? -1 : side;

/**
 * A nose cone's base radius as it flies: the stored one, which `syncAutoRadii`
 * has resolved for an automatic base, or the bridge's default for a cone that
 * states none (`ComponentFactory`, case "nosecone").
 */
const noseBase = (node: ComponentNode): number => num(node, 'aftRadius', KERNEL_DEFAULTS.nosecone.aftRadius);

/**
 * The radius of the end a shoulder sits on, as it flies: a nose cone's base, or
 * a transition's fore or aft end (`syncAutoRadii` has resolved an automatic
 * one). Null for a transition end with no radius on record.
 */
const shoulderEnd = (node: ComponentNode, side: -1 | 1): number | null => {
  if (node.type === 'nosecone') return noseBase(node);
  const r = num(node, side === -1 ? 'foreRadius' : 'aftRadius', NaN);
  return Number.isFinite(r) ? r : null;
};

/**
 * Resolve every auto shoulder in the tree against its current neighbor.
 *
 * Runs after each tree edit (see treeEdit), so widening a body tube updates the
 * nose cone plugged into it in the same keystroke. Returns the same arrays and
 * nodes where nothing changed, so an edit elsewhere in the rocket does not
 * invalidate memos that depend on the parts it did not touch.
 */
export function syncAutoShoulders(tree: RocketTree): RocketTree {
  let neighbors: Map<ComponentNode, Neighbors> | null = null;
  const resolve = (n: ComponentNode, { index, siblings }: MapContext): ComponentNode => {
    let node = n;
    for (const s of SHOULDERS[node.type] ?? []) {
      if (node[s.auto] !== true) continue;
      // The neighbor is read from the original tree: a shoulder never changes
      // the bore it is measured against, so there is no ordering to get wrong.
      neighbors ??= symmetricNeighbors(tree.components);
      const neighbor = neighborOf(neighbors, siblings[index]!, sideOf(node, s.side))?.node ?? null;
      const bore = neighbor ? boreAt(neighbor, sideOf(node, s.side) === -1 ? 'aft' : 'fore') : null;
      // No neighbor yet, or one with no bore to plug: leave the stored value
      // alone rather than zeroing a shoulder somebody typed. Adding the tube
      // later fills it in on that edit.
      // A shoulder stops at the end it plugs into, as desktop's setters clamp it
      // (`Transition.setForeShoulderRadius` and `setAftShoulderRadius`, which
      // `NoseCone.setShoulderRadius` calls for the base).
      const end = shoulderEnd(node, s.side);
      const fit = bore === null ? null : end === null ? bore : Math.min(bore, end);
      if (fit !== null && node[s.radius] !== fit) node = { ...node, [s.radius]: fit };
    }
    // A flipped cone's shoulder, automatic or stated, flies no wider than its
    // resolved base: `ComponentFactory.settleFlippedShoulders` sets it through
    // the clamping `NoseCone.setShoulderRadius`, as desktop's loader does.
    if (node.type === 'nosecone' && node['flipped'] === true) {
      const stated = node['shoulderRadius'];
      const base = noseBase(node);
      if (typeof stated === 'number' && stated > base) node = { ...node, shoulderRadius: base };
    }
    return node;
  };
  // Post-order: a node's children are resolved before the node itself.
  const components = mapTreePreserving(tree.components, resolve, 'post');
  return components === tree.components ? tree : { ...tree, components };
}

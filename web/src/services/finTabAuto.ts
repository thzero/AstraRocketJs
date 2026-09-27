import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import { finRootChord } from '../tree/finPlanform';
import { num, positionOf } from '../tree/nodeProps';
import { startFromPosition } from '../tree/position';
import { stationRadius } from '../tree/shapeProfile';

/**
 * OpenRocket's **Calculate automatically** button for a through-the-wall fin tab.
 *
 * A tab is a tongue on the fin root that passes through a slot in the airframe
 * and is glued to what is inside, so the fin's load goes into the motor mount
 * rather than into the tube skin. Where it can go is decided by what is already
 * in the way: it has to sit BETWEEN two centering rings, reach down to the motor
 * mount tube and no further, and not run past the root chord.
 *
 * That is arithmetic nobody should do by hand, and it is the reason the desktop
 * has a button for it. Ported from `FinSetConfig.calculateAutoTab` and its
 * `computeFinTabLength` helper, including the ring-merging rule and every one of
 * its six cases, because the interesting designs are the ones where a ring
 * straddles an end of the fin root.
 *
 * Returns the patch to apply, or `null` when there is nothing to compute - a fin
 * set on something that is not a symmetric body, which the desktop also does
 * nothing for.
 */

/** A centering ring reduced to what the placement math needs. */
type Ring = {
  /** Distance from the parent's fore end to the ring's fore face. */
  top: number;
  /** The ring's axial thickness (its `length`). */
  thickness: number;
  /** How far out it reaches, which is what decides whether it blocks the tab. */
  outerRadius: number;
};

const ringBottom = (r: Ring): number => r.top + r.thickness;

/** Where a child's fore end sits, measured from its parent's fore end. */
function offsetFromTop(child: ComponentNode, parentLength: number): number {
  return startFromPosition(positionOf(child), num(child, 'length'), parentLength);
}

/**
 * Whether a part inside the body overlaps the fin root at all.
 *
 * `FinSetConfig.isComponentInsideFinSpan`: partial overlap counts, because a
 * mount tube that reaches only halfway under the fin still decides how deep the
 * tab can go over that half.
 */
function overlapsFin(childTop: number, childLength: number, finTop: number, finLength: number): boolean {
  const cMin = childTop;
  const cMax = childTop + childLength;
  const fMin = finTop;
  const fMax = finTop + finLength;
  return (cMin >= fMin && cMin < fMax) || (cMax > fMin && cMax <= fMax) || (cMin <= fMin && cMax >= fMax);
}

/**
 * The tab's length and offset, between the last two rings that qualify.
 *
 * A direct port of `computeFinTabLength`, whose own comment lists the six cases:
 * all rings ahead of the fin, one ring ahead and the second ahead of or behind
 * the fin's trailing edge, the same two with the first ring inside the root, and
 * all rings behind the fin. Returns the offset as well, because upstream writes
 * it into the same model it reads.
 */
function tabBetweenRings(rings: Ring[], finTop: number, finLength: number): { length: number; offset: number } {
  // Merge rings that touch or overlap into one virtual ring: two rings glued
  // face to face are one obstruction, and treating them as two would put a tab
  // of zero length between them.
  const sorted = [...rings].sort((a, b) => a.top - b.top);
  const merged: Ring[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && ringBottom(last) >= r.top) {
      const bottom = Math.max(ringBottom(last), ringBottom(r));
      last.top = Math.min(last.top, r.top);
      last.thickness = bottom - last.top;
    } else {
      merged.push({ ...r });
    }
  }

  // The pair the tab goes between: the LAST two that qualify, walking aft.
  let top: Ring | null = null;
  let bottom: Ring | null = null;
  for (const ring of merged) {
    if (top === null) {
      top = ring;
    } else if (ringBottom(ring) <= finTop) {
      // Entirely ahead of the fin, so it becomes the new upper bound.
      top = ring;
      bottom = null;
    } else if (ringBottom(top) <= finTop) {
      if (bottom === null) {
        // A ring in the FORWARD half of the root is a better upper bound than a
        // lower one; further aft than that and it is the lower bound.
        if (ringBottom(ring) < finTop + finLength / 2) top = ring;
        else bottom = ring;
      } else if (ring.top <= finTop + finLength) {
        top = bottom;
        bottom = ring;
      }
    } else if (bottom === null) {
      bottom = ring;
    }
  }

  let length: number;
  let offset = 0;
  if (top === null || top === bottom) {
    // No usable rings: the tab is the whole root chord.
    length = finLength;
  } else if (bottom === null) {
    if (ringBottom(top) >= finTop) {
      // One ring, its aft face inside the root: start the tab there.
      offset = ringBottom(top) - finTop;
      length = finTop + finLength - ringBottom(top);
    } else {
      const diff = top.top - finTop;
      // The ring is entirely outside the root, so the tab is the whole chord;
      // otherwise it runs from the fin's leading edge to the ring's fore face.
      length = diff < 0 ? finLength : diff;
    }
  } else if (ringBottom(top) < finTop) {
    const toBottomRing = bottom.top - finTop;
    length = toBottomRing > finLength ? finLength : toBottomRing;
  } else {
    offset = ringBottom(top) - finTop;
    length =
      bottom.top > finLength + finTop
        ? // The lower ring is past the trailing edge: stop at the trailing edge.
          finLength + finTop - ringBottom(top)
        : bottom.top - ringBottom(top);
  }
  return { length: Math.max(0, length), offset };
}

/** The types `stationRadius` treats as a body a fin set can be mounted on. */
const SYMMETRIC = new Set(['bodytube', 'nosecone', 'transition']);

/** Whether Calculate automatically has anything to work with on this fin set. */
export function canAutoFinTab(node: ComponentNode | null | undefined, parent: ComponentNode | null): boolean {
  return !!node && node.type.endsWith('finset') && node.type !== 'tubefinset' && !!parent && SYMMETRIC.has(parent.type);
}

/**
 * Work out a through-the-wall tab for this fin set: the patch to apply, or
 * `null` when there is no symmetric parent to measure against.
 *
 * The offset method is forced to **top**, because both numbers it computes are
 * measured from the fin's leading edge. The desktop puts the user's own choice
 * back afterwards, which only matters there because its own spinner shows the
 * offset in that frame; here the patch is the answer and the frame is part of it.
 */
export function autoFinTab(tree: RocketTree, id: string): Partial<ComponentNode> | null {
  const found = locate(tree, id);
  if (!found) return null;
  const { node, parent } = found;
  if (!canAutoFinTab(node, parent) || !parent) return null;

  const parentLength = num(parent, 'length');
  const finLength = finRootChord(node);
  const finTop = offsetFromTop(node, parentLength);

  // What is inside the body under the fin. A mount tube sets how deep the tab
  // can go; the rings set where along the root it can sit.
  let maxTubeRadius = 0;
  let maxRingRadius = 0;
  const rings: Ring[] = [];
  for (const child of (parent.children ?? []) as ComponentNode[]) {
    const top = offsetFromTop(child, parentLength);
    if (child.type === 'innertube') {
      if (!overlapsFin(top, num(child, 'length'), finTop, finLength)) continue;
      maxTubeRadius = Math.max(maxTubeRadius, num(child, 'outerRadius'));
    } else if (child.type === 'centeringring') {
      maxRingRadius = Math.max(maxRingRadius, num(child, 'outerRadius'));
      rings.push({ top, thickness: num(child, 'length'), outerRadius: num(child, 'outerRadius') });
    }
  }
  // A ring no wider than the mount tube is not an obstruction: the tab clears it
  // at the depth the tube already forces.
  const blocking = rings.filter((r) => r.outerRadius > maxTubeRadius);

  const placed =
    maxRingRadius > maxTubeRadius && blocking.length > 0
      ? tabBetweenRings(blocking, finTop, finLength)
      : { length: finLength, offset: 0 };

  const patch: Partial<ComponentNode> = {
    tabOffsetMethod: 'top',
    tabOffset: placed.offset,
    tabLength: placed.length,
  } as Partial<ComponentNode>;

  // How DEEP: down to the mount tube, from whichever end of the tab the body is
  // narrower at. On a boat tail those two differ, and cutting to the wider one
  // would put the tab through the skin.
  const front = finTop + placed.offset;
  const back = front + placed.length;
  const bodyRadius = Math.min(stationRadius(parent, front), stationRadius(parent, back));
  const height = bodyRadius - maxTubeRadius;
  // A negative height means the tube is wider than the body there, which is a
  // broken design rather than a tab; upstream leaves the height alone too.
  if (height >= 0) (patch as Record<string, unknown>)['tabHeight'] = height;
  return patch;
}

/** The node and its parent, in one walk. */
function locate(tree: RocketTree, id: string): { node: ComponentNode; parent: ComponentNode | null } | null {
  const rec = (
    nodes: ComponentNode[],
    parent: ComponentNode | null,
  ): { node: ComponentNode; parent: ComponentNode | null } | null => {
    for (const n of nodes) {
      if (n.id === id) return { node: n, parent };
      const hit = n.children ? rec(n.children as ComponentNode[], n) : null;
      if (hit) return hit;
    }
    return null;
  };
  return rec(tree.components, null);
}

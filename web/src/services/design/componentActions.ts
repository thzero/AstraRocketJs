import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { clusterCount, clusterOffsets, isClusterPattern } from '../../tree/cluster';
import { finPlanformPoints } from '../../tree/finPlanform';
import { num } from '../../tree/nodeProps';
import { scaleNode } from '../../tree/scaleRocket';
import { syncDerived } from './treeEdit';
import { uuid } from '../app/uuid';

/**
 * The buttons on OpenRocket's config dialogs that CHANGE THE TREE rather than
 * set a field: convert a fin set to freeform, split a fin set into single fins,
 * split a pod set or booster into separate ones, split a motor cluster into
 * separate tubes, and put a cluster's spacing back to the default.
 *
 * Pure tree transforms, returning the same tree when there is nothing to do, so
 * the store can skip the undo step. Each one answers a `can*` predicate as well,
 * because a disabled button that says why beats one that does nothing on a fin
 * set with a single fin.
 *
 * All of them replace a node with one or more nodes at the SAME position among
 * its siblings, which is the shape of `splitInstances` upstream.
 */

/** Fin sets whose planform `finPlanformPoints` can hand to a freeform outline. */
const CONVERTIBLE = new Set(['trapezoidfinset', 'ellipticalfinset']);

/** The dimension keys that describe a trapezoid or elliptical planform and
 *  nothing else. A freeform outline replaces all of them. */
const PLANFORM_KEYS = ['rootChord', 'tipChord', 'sweep', 'height'] as const;

/**
 * What a split divides: how many copies, and which key holds the angle they are
 * spread around. A fin set's instance count is its FIN count and its angle is
 * its base rotation; a pod set or booster counts instances and carries an
 * `angleOffset`. Upstream reaches both through `getInstanceCount` and
 * `AnglePositionable`, which our nodes spell differently per type.
 */
const SPLITTABLE: Record<string, { count: string; angle: string }> = {
  trapezoidfinset: { count: 'finCount', angle: 'rotation' },
  ellipticalfinset: { count: 'finCount', angle: 'rotation' },
  freeformfinset: { count: 'finCount', angle: 'rotation' },
  tubefinset: { count: 'finCount', angle: 'rotation' },
  podset: { count: 'instanceCount', angle: 'angleOffset' },
  parallelstage: { count: 'instanceCount', angle: 'angleOffset' },
};

/** Every id in this subtree replaced with a fresh one, so a copy is a new part
 *  rather than a second node claiming the same identity. */
function reid(node: ComponentNode): ComponentNode {
  const out: ComponentNode = { ...node, id: uuid() };
  if (node.children) out.children = node.children.map(reid);
  return out;
}

/**
 * Put `replacements` where `id` was, among its siblings, and resync the derived
 * values. One node replaces it in place; several fan out from its position.
 */
function replaceInPlace(tree: RocketTree, id: string, replacements: ComponentNode[]): RocketTree {
  let done = false;
  const rec = (nodes: ComponentNode[]): ComponentNode[] => {
    const i = nodes.findIndex((n) => n.id === id);
    if (i >= 0) {
      done = true;
      return [...nodes.slice(0, i), ...replacements, ...nodes.slice(i + 1)];
    }
    return nodes.map((n) => {
      if (done || !n.children) return n;
      const kids = rec(n.children);
      return kids === n.children ? n : { ...n, children: kids };
    });
  };
  const components = rec(tree.components);
  return done ? syncDerived({ ...tree, components }) : tree;
}

/** Local lookup, so this module does not depend on treeEdit for a read. */
function findIn(tree: RocketTree, id: string): ComponentNode | null {
  const rec = (nodes: ComponentNode[]): ComponentNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const hit = n.children ? rec(n.children) : null;
      if (hit) return hit;
    }
    return null;
  };
  return rec(tree.components);
}

/** Whether this fin set has a planform a freeform outline can be built from. */
export const canConvertToFreeform = (node: ComponentNode | null | undefined): boolean =>
  !!node && CONVERTIBLE.has(node.type);

/**
 * Turn a trapezoidal or elliptical fin set into a freeform one with the same
 * outline, as `FreeformFinSet.convertFinSet` does.
 *
 * Everything that is not the planform survives: the fin count, thickness, cant,
 * cross section, base rotation, the through-the-wall tab, the fillet, the
 * material, the position, the color and the comment. What goes is the four
 * dimensions the outline now describes, because leaving them would be two
 * descriptions of one shape with nothing keeping them in step.
 *
 * The part keeps its id, so the selection and anything that names it are
 * undisturbed. An UNNAMED fin set relabels itself, because the tree falls back
 * to the type's own name; one the user named keeps that name, which is the
 * intent of upstream's rename-only-if-it-is-still-the-default rule.
 */
export function convertToFreeform(tree: RocketTree, id: string): RocketTree {
  const node = findIn(tree, id);
  if (!node || !canConvertToFreeform(node)) return tree;
  const points = finPlanformPoints(node);
  if (!points || points.length < 3) return tree;
  const out: ComponentNode = { ...node, type: 'freeformfinset', points };
  for (const k of PLANFORM_KEYS) delete out[k];
  return replaceInPlace(tree, id, [out]);
}

/** How many single parts a split would make; 1 means there is nothing to do. */
export const splitCount = (node: ComponentNode | null | undefined): number => {
  if (!node) return 1;
  const spec = SPLITTABLE[node.type];
  return spec ? Math.max(1, Math.round(num(node, spec.count, 1))) : 1;
};

/** Whether this node is more than one instance of something. */
export const canSplit = (node: ComponentNode | null | undefined): boolean => splitCount(node) > 1;

/**
 * Break a multi-instance part into single ones, as `splitInstances` does: a
 * three-fin set becomes three one-fin sets at 0, 120 and 240 degrees, and a
 * two-instance booster becomes two boosters half a turn apart.
 *
 * `baseName` is the name to number - the caller passes the part's display name,
 * because an unnamed part shows its TYPE and this module cannot localize. An
 * override mass is divided between the copies, since it was a figure for the
 * whole set.
 */
export function splitInstances(tree: RocketTree, id: string, baseName: string): RocketTree {
  const node = findIn(tree, id);
  const spec = node ? SPLITTABLE[node.type] : undefined;
  if (!node || !spec) return tree;
  const count = splitCount(node);
  if (count < 2) return tree;
  const angle = num(node, spec.angle, 0);
  const override = node['overrideMass'];
  const copies = Array.from({ length: count }, (_, i) => {
    const copy = reid(node);
    copy[spec.count] = 1;
    copy[spec.angle] = angle + (i * 2 * Math.PI) / count;
    copy.name = baseName + ' #' + String(i + 1);
    if (typeof override === 'number') copy['overrideMass'] = override / count;
    return copy;
  });
  // The first copy keeps the original id, so whatever was selected stays
  // selected rather than the panel emptying under the button just pressed.
  copies[0]!.id = id;
  return replaceInPlace(tree, id, copies);
}

/** Whether this inner tube carries a cluster of more than one motor. */
export const canSplitCluster = (node: ComponentNode | null | undefined): boolean =>
  !!node && node.type === 'innertube' && clusterCount(node['cluster'] as string | undefined) > 1;

/**
 * Break a motor cluster into separate inner tubes, one per tube position, as
 * `InnerTube.makeIndividualClusterComponent` does.
 *
 * Each copy becomes a single tube pinned at the offset the cluster put it at,
 * with the cluster's spacing and roll reset because they no longer describe
 * anything. It duplicates whatever was attached to the tube as well, which is
 * the warning on the desktop's own tooltip: a cluster with an engine block in it
 * becomes four tubes with four engine blocks.
 */
export function splitCluster(tree: RocketTree, id: string, baseName: string): RocketTree {
  const node = findIn(tree, id);
  if (!node || !canSplitCluster(node)) return tree;
  const dir = num(node, 'radialDirection', 0);
  const pos = num(node, 'radialPosition', 0);
  // The kernel rotates the pattern by `clusterRotation - radialDirection` and
  // then adds the tube's own radial offset (InnerTube.getClusterPoints), so a
  // cluster that was already off-center splits into tubes that stay where they
  // were drawn.
  const offsets = clusterOffsets(
    node['cluster'] as string,
    num(node, 'outerRadius'),
    num(node, 'clusterScale', 1),
    num(node, 'clusterRotation', 0) - dir,
  );
  const copies = offsets.map((o, i) => {
    const copy = reid(node);
    const y = o.y + pos * Math.cos(dir);
    const z = o.z + pos * Math.sin(dir);
    copy['cluster'] = 'single';
    copy['clusterScale'] = 1;
    copy['clusterRotation'] = 0;
    // `setRadialShift`: the same y/z offset stated as a distance and a direction.
    copy['radialPosition'] = Math.hypot(y, z);
    copy['radialDirection'] = Math.atan2(z, y);
    copy.name = baseName + ' #' + String(i + 1);
    return copy;
  });
  if (!copies.length) return tree;
  copies[0]!.id = id;
  return replaceInPlace(tree, id, copies);
}

/**
 * The desktop's Reset settings button beside the cluster picker: spacing back to
 * one tube diameter and roll back to zero. Only those two, which is what its own
 * tooltip promises - the pattern itself is left alone.
 */
export function resetCluster(tree: RocketTree, id: string): RocketTree {
  const node = findIn(tree, id);
  if (!node || node.type !== 'innertube' || !isClusterPattern(node['cluster'])) return tree;
  if (num(node, 'clusterScale', 1) === 1 && num(node, 'clusterRotation', 0) === 0) return tree;
  return replaceInPlace(tree, id, [{ ...node, clusterScale: 1, clusterRotation: 0 }]);
}

/**
 * Scale ONE component by a factor: the freeform editor's **Scale fin**.
 *
 * The desktop reaches the general Scale dialog here with only this component
 * selected, so it is the same scale a whole-rocket one would apply, confined to
 * one part - the outline, the wall, the tab and the fillet all together, since a
 * fin scaled without its tab no longer passes through its own slot.
 *
 * A component has no children worth scaling (a fin set has none at all), so this
 * deliberately does NOT recurse: scaling a body tube here would leave everything
 * inside it at its old size, and that is the whole-rocket scale's job.
 */
export function scaleComponent(tree: RocketTree, id: string, factor: number): RocketTree {
  if (!(factor > 0) || !Number.isFinite(factor) || factor === 1) return tree;
  const node = findIn(tree, id);
  if (!node) return tree;
  const scaled = scaleNode(node, factor);
  return replaceInPlace(tree, id, [node.children ? { ...scaled, children: node.children } : scaled]);
}

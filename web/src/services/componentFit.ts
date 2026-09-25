// Reading the geometry AROUND a node, so the part picker can rank the catalog
// against the design instead of listing it flat.
//
// Separate from componentFilter (which scores a candidate against a context and
// knows nothing about trees) and from treeEdit (which edits them). This module
// only looks, and it is where every "what is this part actually up against"
// question is answered once.
import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import { numOpt } from '../tree/nodeProps';
import { findNode, findParent } from './treeEdit';
import type { FitContext } from './componentFilter';

/** Outer diameter of a body component, or undefined if it is not one. */
function outerDiameter(n: ComponentNode): number | undefined {
  if (n.type === 'nosecone' || n.type === 'transition') {
    const r = numOpt(n, 'aftRadius');
    return r == null ? undefined : r * 2;
  }
  if (n.type === 'bodytube' || n.type === 'tubecoupler' || n.type === 'innertube') {
    const r = numOpt(n, 'outerRadius');
    return r == null ? undefined : r * 2;
  }
  return undefined;
}

/**
 * Bore of a tube-like component, or undefined when it has no wall to subtract.
 *
 * A body tube carries an outer radius and a wall thickness rather than a bore,
 * which is why the picker could not previously offer to match one: the number a
 * coupler has to fit is not stored, it is derived.
 */
function innerDiameter(n: ComponentNode): number | undefined {
  if (n.type !== 'bodytube' && n.type !== 'tubecoupler' && n.type !== 'innertube') return undefined;
  const or = numOpt(n, 'outerRadius');
  const th = numOpt(n, 'thickness');
  if (or == null || th == null || th <= 0 || th >= or) return undefined;
  return (or - th) * 2;
}

/** Every distinct airframe outer diameter in the design, largest first. */
function airframeDiameters(tree: RocketTree): number[] {
  const seen = new Set<number>();
  const walk = (nodes: ComponentNode[]) => {
    for (const n of nodes) {
      // Only what a body tube would have to line up with: the airframe itself,
      // not the inner tubes threaded through it.
      if (n.type === 'bodytube' || n.type === 'nosecone' || n.type === 'transition') {
        const d = outerDiameter(n);
        if (d != null && d > 0) seen.add(Math.round(d * 1e6) / 1e6);
      }
      if (n.children) walk(n.children);
    }
  };
  walk(tree.components);
  return [...seen].sort((a, b) => b - a);
}

/**
 * What the part at `nodeId` has to fit, read off the design around it.
 *
 * Every field is optional and a missing one is normal rather than an error: a
 * body tube hanging straight off a stage has no enclosing bore, and a rocket
 * with one part has no airframe to match. `componentFilter.fitRuleFor` decides
 * which of these a given type can actually use, and abstains when none of them
 * applies, so an absent field narrows nothing and hides nothing.
 */
export function fitContextFor(tree: RocketTree, nodeId: string | null): FitContext | undefined {
  if (!nodeId) return undefined;
  const node = findNode(tree, nodeId);
  if (!node) return undefined;
  const parent = findParent(tree, nodeId);

  // What this part has to clear: the widest INNER TUBE sharing its parent. A
  // centering ring's bore is sized to the motor mount it holds, and that mount
  // is the ring's SIBLING, not its child.
  //
  // Inner tubes only. A coupler in the same bay is also a sibling and also has
  // an outer diameter, but nothing centers on it: counting it made the widest
  // part in the bay the constraint rather than the mount, so a 29 mm mount with
  // a 51 mm coupler beside it rejected every ring that actually fits.
  const siblings = (parent?.children ?? []).filter((n) => n.id !== nodeId);
  const mounts = siblings
    .filter((n) => n.type === 'innertube')
    .map(outerDiameter)
    .filter((d): d is number => d != null && d > 0);

  // The node's OWN diameter stays in the airframe list on purpose. Picking a
  // catalog part for a tube you have already sized means you want real parts at
  // that size, so matching yourself is the answer rather than a degenerate case.
  return {
    parentInner: parent ? innerDiameter(parent) : undefined,
    parentOuter: parent ? outerDiameter(parent) : undefined,
    mountOuter: mounts.length > 0 ? Math.max(...mounts) : undefined,
    airframeOuter: airframeDiameters(tree),
  };
}

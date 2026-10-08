import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { findParent } from './treeEdit';

/** Which override: the node's value key and the "all subcomponents" flag beside it. */
export type OverrideKind = 'mass' | 'cg' | 'cd';

const KEYS: Record<OverrideKind, { value: string; sub: string }> = {
  mass: { value: 'overrideMass', sub: 'overrideSubcomponentsMass' },
  cg: { value: 'overrideCGX', sub: 'overrideSubcomponentsCG' },
  cd: { value: 'overrideCD', sub: 'overrideSubcomponentsCD' },
};

/**
 * The ancestor whose override of `kind` also covers this part, or null.
 *
 * The kernel's `getMassOverriddenBy` (and its CG and CD twins): an ancestor
 * that overrides the value AND applies it to all its subcomponents decides it
 * for everything inside it, and the outermost such ancestor wins, since its
 * value replaces the whole subtree's, inner overrides included. Desktop names
 * that ancestor on the part's override tab and locks the part's own override.
 */
export function overriddenBy(tree: RocketTree, id: string, kind: OverrideKind): ComponentNode | null {
  const { value, sub } = KEYS[kind];
  let found: ComponentNode | null = null;
  for (let p = findParent(tree, id); p; p = p.id ? findParent(tree, p.id) : null) {
    if (typeof p[value] === 'number' && p[sub] === true) found = p;
  }
  return found;
}

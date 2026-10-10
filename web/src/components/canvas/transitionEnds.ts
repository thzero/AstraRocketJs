import type { ComponentNode } from '../../engine/openRocketEngine';
import { numOpt } from '../../tree/nodeProps';
import { KERNEL_AUTO_RADIUS } from '../../services/design/autoRadius';

/**
 * A transition's two end radii as the kernel builds them, for the 2D and 3D
 * drawings.
 *
 * ComponentFactory (case "transition") makes an end whose radius key is absent
 * automatic, not a fixed default: the kernel matches it to the part beside it
 * (Transition.getAutoForeRadius / getAutoAftRadius) and, with no part there,
 * takes SymmetricComponent.DEFAULT_RADIUS. `syncAutoRadii` writes the resolved
 * radius onto an end flagged automatic, so this matters for a node that has
 * neither the key nor the flag; without it that node would be drawn at a size
 * the kernel never flies.
 *
 * `prev` and `next` are the parts before and after it on the axial chain.
 */
export function transitionEnds(
  n: ComponentNode,
  prev: ComponentNode | undefined,
  next: ComponentNode | undefined,
): { fore: number; aft: number } {
  const end = (own: number | undefined, neighbor: number | undefined) =>
    own ?? (neighbor !== undefined && neighbor >= 0 ? neighbor : KERNEL_AUTO_RADIUS);
  return {
    fore: end(numOpt(n, 'foreRadius'), prev && facing(prev, 'aft')),
    aft: end(numOpt(n, 'aftRadius'), next && facing(next, 'fore')),
  };
}

/** The radius a part offers at one of its ends, when it has one on record. */
function facing(n: ComponentNode, face: 'fore' | 'aft'): number | undefined {
  switch (n.type) {
    case 'bodytube':
      return numOpt(n, 'outerRadius');
    case 'transition':
      return numOpt(n, face === 'fore' ? 'foreRadius' : 'aftRadius');
    case 'nosecone':
      // The base is aft, or fore on a reversed nose cone; the other end is the tip.
      return (face === 'aft') !== (n['flipped'] === true) ? numOpt(n, 'aftRadius') : undefined;
    default:
      return undefined;
  }
}

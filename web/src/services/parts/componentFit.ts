// Reading the geometry around a node, so the part picker can rank the catalog
// against the design instead of listing it flat.
//
// Separate from componentFilter (which scores a candidate against a context and
// knows nothing about trees) and from treeEdit (which edits them). This module
// only looks, and it is where every "what is this part actually up against"
// question is answered once.
import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { num, numOpt } from '../../tree/nodeProps';
import { ringBore, tubeWall } from '../design/discGeometry';
import { findNode, findParent } from '../design/treeEdit';
import { symmetricNeighbors } from '../design/autoRadius';
import { profileEnds } from '../../tree/shapeProfile';
import { axialFrameOf } from '../../tree/axialRebase';
import { KERNEL_AUTO_RADIUS } from '../../tree/kernelDefaults';
import type { FitContext } from './componentFilter';

/**
 * An airframe part's diameter at one end (`SymmetricComponent.getForeRadius`
 * and `getAftRadius`): a tube's one radius, a cone's profile end, which knows a
 * flipped nose cone's base is its fore end.
 */
function endDiameter(n: ComponentNode, end: 'fore' | 'aft'): number | undefined {
  if (n.type === 'bodytube') return num(n, 'outerRadius', KERNEL_AUTO_RADIUS) * 2;
  if (n.type === 'nosecone' || n.type === 'transition') return profileEnds(n)[end] * 2;
  return undefined;
}

/**
 * Bore of a tube-like component, or undefined when its stated wall leaves none.
 *
 * A body tube carries an outer radius and a wall thickness rather than a bore, so
 * the number a coupler has to fit is not stored but derived here.
 */
function innerDiameter(n: ComponentNode): number | undefined {
  if (n.type !== 'bodytube' && n.type !== 'tubecoupler' && n.type !== 'innertube') return undefined;
  const or = numOpt(n, 'outerRadius');
  // A missing wall is the type's kernel default; a stated one that leaves no
  // bore (zero, or at least the radius) is a bad value and answers nothing.
  const th = numOpt(n, 'thickness') ?? tubeWall(n.type);
  if (or == null || th <= 0 || th >= or) return undefined;
  return (or - th) * 2;
}

/**
 * The diameters an airframe part's two ends have to meet, as desktop's chooser
 * reads them (`ComponentPresetChooserDialog`): the fore end the aft end of the
 * part ahead, the aft end the fore end of the part behind. A flipped nose cone
 * is matched at its aft column against the fore end of the part ahead, as that
 * dialog does. The neighbors are the kernel's (`symmetricNeighbors`), across
 * stages and through in-line pods.
 */
function neighborMatches(tree: RocketTree, node: ComponentNode): Pick<FitContext, 'foreMatch' | 'aftMatch'> {
  if (node.type !== 'bodytube' && node.type !== 'nosecone' && node.type !== 'transition') return {};
  const around = symmetricNeighbors(tree.components).get(node);
  if (!around) return {};
  const flipped = node.type === 'nosecone' && node['flipped'] === true;
  const aftSide = flipped ? around.previous : around.next;
  return {
    foreMatch: around.previous ? endDiameter(around.previous, 'aft') : undefined,
    aftMatch: aftSide ? endDiameter(aftSide, 'fore') : undefined,
  };
}

/**
 * The motor mount a centering ring centers: the widest inner tube beside it
 * whose span overlaps the ring's (`CenteringRing.getInnerRadius`, through
 * `discGeometry.ringBore`), or undefined when none does.
 */
function mountDiameter(tree: RocketTree, node: ComponentNode, parent: ComponentNode | null): number | undefined {
  if (node.type !== 'centeringring' || !parent) return undefined;
  const start = parent.id ? (axialFrameOf(tree, parent.id)?.start ?? 0) : 0;
  const bore = ringBore(node, parent, Infinity, start);
  return bore > 0 ? bore * 2 : undefined;
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
  return {
    parentInner: parent ? innerDiameter(parent) : undefined,
    // What a centering ring has to go over: the mount it holds is its sibling,
    // not its child. Inner tubes only, and only the ones the ring overlaps: a
    // coupler in the same bay centers nothing, and a 54 mm mount further aft
    // says nothing about a ring around the 29 mm one.
    mountOuter: mountDiameter(tree, node, parent),
    ...neighborMatches(tree, node),
  };
}

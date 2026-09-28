import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import { num } from '../tree/nodeProps';
// Shared with the .ork reader and writer, so a part that lost a tag is sized the
// way it was read and saved.
import { COMPONENT_DEFAULTS } from './componentDefaults';

/**
 * Where a disc / ring / tube part's real dimensions come from: the tree walk
 * that finds the tube enclosing a part, and the radius resolution that turns
 * "a centering ring in this body tube, around that motor mount" into an outer
 * radius, a bore and a length.
 *
 * This lives apart from its three consumers because they must agree: the DXF cut
 * sheet (dxfExport), the STL/3MF print solids (componentExport,
 * rocketPrintExport) and the 3D view's internals (rocketPieces). Held inside the
 * DXF writer it could only be reused by dragging the whole R12 serializer into the
 * first-paint bundle. No three.js and no writers here, so anyone can import it.
 */

/** Used when a ring's outer radius can't be resolved from its parent tube. */
const FALLBACK_RADIUS = 0.012;

export interface Tube {
  outerR: number;
  innerR: number;
}
/** The bore a tube offers whatever sits inside it, from its own wall. */
export function tubeRadii(node: ComponentNode): Tube | null {
  const t = node.type;
  if (t === 'bodytube' || t === 'innertube' || t === 'tubecoupler') {
    const or = num(node, 'outerRadius', NaN);
    if (!Number.isNaN(or))
      return { outerR: or, innerR: Math.max(0, or - num(node, 'thickness', COMPONENT_DEFAULTS.bodytube.thickness)) };
  } else if (t === 'nosecone') {
    const ar = num(node, 'aftRadius', NaN);
    if (!Number.isNaN(ar)) {
      return { outerR: ar, innerR: Math.max(0, ar - num(node, 'thickness', COMPONENT_DEFAULTS.nosecone.thickness)) };
    }
  } else if (t === 'transition') {
    const or = Math.max(num(node, 'aftRadius', 0), num(node, 'foreRadius', 0));
    if (or > 0) {
      return { outerR: or, innerR: Math.max(0, or - num(node, 'thickness', COMPONENT_DEFAULTS.transition.thickness)) };
    }
  }
  return null;
}

/** Outer radius of a plate part that fills its parent tube's bore. */
export function plateOuter(node: ComponentNode, enclosing: Tube | null): number {
  const explicit = num(node, 'outerRadius', NaN);
  if (!Number.isNaN(explicit)) return explicit;
  if (enclosing && enclosing.innerR > 0) return enclosing.innerR;
  return FALLBACK_RADIUS;
}

/** The motor-mount bore a centering ring centers — an inner tube among siblings. */
export function mountBore(siblings: ComponentNode[]): number | null {
  const mount = siblings.find((s) => s.type === 'innertube');
  if (!mount) return null;
  const or = num(mount, 'outerRadius', NaN);
  return Number.isNaN(or) ? null : or;
}

/** Locate a node plus the enclosing tube + siblings its cut part needs. */
export function nodeContext(
  tree: RocketTree,
  nodeId: string,
): { node: ComponentNode; enclosing: Tube | null; siblings: ComponentNode[] } | null {
  let found: { node: ComponentNode; enclosing: Tube | null; siblings: ComponentNode[] } | null = null;
  const walk = (node: ComponentNode, enclosing: Tube | null, siblings: ComponentNode[]): boolean => {
    if (node.id === nodeId) {
      found = { node, enclosing, siblings };
      return true;
    }
    const kids = node.children ?? [];
    const childEnclosing = tubeRadii(node) ?? enclosing; // a tube redefines the bore for its children
    for (const kid of kids) if (walk(kid, childEnclosing, kids)) return true;
    return false;
  };
  for (const stage of tree.components) {
    const kids = stage.type === 'stage' ? (stage.children ?? []) : [stage];
    for (const kid of kids) if (walk(kid, tubeRadii(kid) ?? null, kids)) break;
  }
  return found;
}

/**
 * Resolved solid dimensions of a disc / ring / tube part (centering ring,
 * bulkhead, coupler, engine block), for its 3D mesh export — the same radius
 * resolution the DXF uses (explicit radii, else the parent tube's bore, else the
 * mount an inner tube provides). Returns null for any other type.
 */
export function resolveDisc(
  tree: RocketTree,
  nodeId: string,
): { outerR: number; innerR: number; length: number } | null {
  const ctx = nodeContext(tree, nodeId);
  return ctx ? discDims(ctx.node, ctx.enclosing, ctx.siblings) : null;
}

/**
 * The same resolution for a caller that ALREADY has the context, because it is
 * walking the tree itself: the 2D schematic knows the enclosing tube and the
 * siblings by the time it draws a child, and has no tree to look a node up in.
 *
 * It exists so the sketch can size a coupler the way the cut sheet and the 3D
 * model do. Drawing every internal through `internalExtent` instead caps the
 * radius at 85% of the parent, which a coupler hits EVERY time since it fills the
 * bore by definition, so the same part comes out one size in the sketch and
 * another everywhere else.
 */
export function discDims(
  node: ComponentNode,
  enclosing: Tube | null,
  siblings: ComponentNode[],
): { outerR: number; innerR: number; length: number } | null {
  const outerR = plateOuter(node, enclosing);
  if (node.type === 'bulkhead') {
    return { outerR, innerR: 0, length: num(node, 'length', COMPONENT_DEFAULTS.bulkhead.length) };
  }
  if (node.type === 'centeringring') {
    const bore = num(node, 'innerRadius', NaN);
    const innerR = Number.isNaN(bore) ? (mountBore(siblings) ?? 0) : bore;
    return { outerR, innerR, length: num(node, 'length', COMPONENT_DEFAULTS.centeringring.length) };
  }
  if (node.type === 'tubecoupler' || node.type === 'engineblock') {
    const wall = num(
      node,
      'thickness',
      node.type === 'engineblock' ? COMPONENT_DEFAULTS.engineblock.thickness : COMPONENT_DEFAULTS.tubecoupler.thickness,
    );
    const length = num(node, 'length', node.type === 'engineblock' ? COMPONENT_DEFAULTS.engineblock.length : 0.003);
    return { outerR, innerR: Math.max(0, outerR - wall), length };
  }
  return null;
}

/**
 * The bore a part offers AT ONE END: what a shoulder plugging in there has to
 * fit inside.
 *
 * Distinct from {@link tubeRadii}, which answers "what bore does this part
 * offer whatever sits inside it" and takes a transition's WIDER end, because
 * a ring somewhere along it has to clear the whole thing. A shoulder does not
 * go somewhere along it; it goes in one end, and a transition's two ends are
 * different sizes. Asking the wrong one of those two questions gives a boat
 * tail's fore shoulder the aft radius.
 *
 * Returns null when the part has no bore to offer at that end: a nose cone is
 * closed at the tip, and anything that is not airframe has no end to plug.
 */
export function boreAt(node: ComponentNode, end: 'fore' | 'aft'): number | null {
  const wall = (dflt: number) => num(node, 'thickness', dflt);
  const bore = (outer: number, w: number) => (outer > 0 && w < outer ? outer - w : null);
  switch (node.type) {
    case 'bodytube':
    case 'innertube':
    case 'tubecoupler':
      return bore(num(node, 'outerRadius', NaN), wall(COMPONENT_DEFAULTS.bodytube.thickness));
    case 'transition':
      return bore(
        num(node, end === 'fore' ? 'foreRadius' : 'aftRadius', NaN),
        wall(COMPONENT_DEFAULTS.transition.thickness),
      );
    case 'nosecone':
      // Open at its base, closed at the tip.
      return end === 'aft' ? bore(num(node, 'aftRadius', NaN), wall(COMPONENT_DEFAULTS.nosecone.thickness)) : null;
    default:
      return null;
  }
}

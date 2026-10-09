import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { num, positionOf } from '../../tree/nodeProps';
import { partLength, startFromPosition } from '../../tree/position';
import { stationRadius } from '../../tree/shapeProfile';
// Shared with the .ork reader and writer, so a part that lost a tag is sized the
// way it was read and saved.
import { COMPONENT_DEFAULTS } from './componentDefaults';

/**
 * Where a disc / ring / tube part's real dimensions come from: the tree walk
 * that finds the tube enclosing a part, and the radius resolution that turns
 * "a centering ring in this body tube, around that motor mount" into an outer
 * radius, a bore and a length.
 *
 * This lives apart from its consumers because they must agree: the DXF cut
 * sheet (dxfExport), the STL/3MF print solids (componentExport,
 * rocketPrintExport), the 3D view's internals (rocketPieces) and the automatic
 * radius and shoulder resolvers (autoRadius, autoShoulder). Held inside the
 * DXF writer it could only be reused by dragging the whole R12 serializer into the
 * first-paint bundle. No three.js and no writers here, so anyone can import it.
 */

/** Used when a ring's outer radius can't be resolved from its parent tube. */
const FALLBACK_RADIUS = 0.012;

/**
 * Each tube type's own wall when the node states none: the kernel gives an inner
 * tube and a coupler 0.5 mm and a body tube 0.3 mm. Read per type, so a part's
 * bore is the same whether it is asked for as the part or as the tube around
 * something else.
 */
const TUBE_WALL = {
  bodytube: COMPONENT_DEFAULTS.bodytube.thickness,
  innertube: COMPONENT_DEFAULTS.innertube.thickness,
  tubecoupler: COMPONENT_DEFAULTS.tubecoupler.thickness,
} as const;

/** The default wall for a tube type, or the inner tube's for any other (a mount). */
export function tubeWall(type: unknown): number {
  return type === 'bodytube' || type === 'tubecoupler' ? TUBE_WALL[type] : TUBE_WALL.innertube;
}

export interface Tube {
  outerR: number;
  innerR: number;
}
/** The bore a tube offers whatever sits inside it, from its own wall. */
export function tubeRadii(node: ComponentNode): Tube | null {
  const t = node.type;
  if (t === 'bodytube' || t === 'innertube' || t === 'tubecoupler') {
    const or = num(node, 'outerRadius', NaN);
    // A filled body tube is solid: `BodyTube.getInnerRadius` is 0.
    if (t === 'bodytube' && node['filled'] === true && !Number.isNaN(or)) return { outerR: or, innerR: 0 };
    if (!Number.isNaN(or)) return { outerR: or, innerR: Math.max(0, or - num(node, 'thickness', TUBE_WALL[t])) };
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

/** The motor-mount bore a centering ring centers: an inner tube among siblings. */
export function mountBore(siblings: ComponentNode[]): number | null {
  const mount = siblings.find((s) => s.type === 'innertube');
  if (!mount) return null;
  const or = num(mount, 'outerRadius', NaN);
  return Number.isNaN(or) ? null : or;
}

/** Where a child sits along its parent, from the parent's front, clamped into the parent (m). */
function spanIn(child: ComponentNode, parent: ComponentNode): [number, number] {
  const len = partLength(parent);
  const start = startFromPosition(positionOf(child), partLength(child), len);
  const clamp = (x: number) => Math.min(Math.max(x, 0), len);
  return [clamp(start), clamp(start + partLength(child))];
}

/**
 * The bore a part offers at one station along it: `RadialParent.getInnerRadius(x)`.
 * A tube is one bore end to end (none when filled); a nose cone or transition
 * is its profile at that station less its wall.
 */
function innerRadiusAt(parent: ComponentNode, x: number): number | null {
  if (parent.type === 'nosecone' || parent.type === 'transition') {
    const wall = num(parent, 'thickness', COMPONENT_DEFAULTS[parent.type].thickness);
    return Math.max(stationRadius(parent, x) - wall, 0);
  }
  return tubeRadii(parent)?.innerR ?? null;
}

/**
 * The automatic outer radius of a ring, bulkhead, coupler or engine block: the
 * narrower of its parent's bores at the part's fore and aft faces
 * (`RadiusRingComponent.getOuterRadius`, `ThicknessRingComponent.getOuterRadius`).
 * Null when the parent offers no bore.
 */
export function boreAround(child: ComponentNode, parent: ComponentNode): number | null {
  const [x0, x1] = spanIn(child, parent);
  const a = innerRadiusAt(parent, x0);
  const b = innerRadiusAt(parent, x1);
  return a === null || b === null ? null : Math.min(a, b);
}

/**
 * A centering ring's automatic bore: the widest inner tube beside it whose span
 * overlaps the ring's, 0 when none does, and never wider than the ring
 * (`CenteringRing.getInnerRadius`).
 */
export function ringBore(ring: ComponentNode, parent: ComponentNode, ringOuter: number): number {
  const [r0, r1] = spanIn(ring, parent);
  let bore = 0;
  for (const sib of parent.children ?? []) {
    if (sib.type !== 'innertube') continue;
    const [t0, t1] = spanIn(sib, parent);
    if (r1 < t0 || r0 > t1) continue;
    bore = Math.max(bore, num(sib, 'outerRadius', 0));
  }
  return Math.min(bore, ringOuter);
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
 * bulkhead, coupler, engine block), for its 3D mesh export: the same radius
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
 * The same resolution for a caller that already has the context, because it is
 * walking the tree itself: the 2D schematic knows the enclosing tube and the
 * siblings by the time it draws a child, and has no tree to look a node up in.
 *
 * It exists so the sketch can size a coupler the way the cut sheet and the 3D
 * model do. Drawing every internal through `internalExtent` instead caps the
 * radius at 85% of the parent, which a coupler hits every time since it fills the
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
    // The fallback length comes from the shared table, which holds the kernel's
    // own default (a tube coupler is 50 mm in ComponentFactory.java), so a
    // coupler whose `length` key is absent is sketched, cut and printed at the
    // length it flies.
    const length = num(
      node,
      'length',
      node.type === 'engineblock' ? COMPONENT_DEFAULTS.engineblock.length : COMPONENT_DEFAULTS.tubecoupler.length,
    );
    // A wall at least as thick as the radius leaves no bore, and `discSolid`
    // would then fall through to its no-bore branch and lathe a solid rod: a
    // coupler printed as a plug, with nothing saying so. `discDims` also feeds
    // the DXF sheet and the 3D internals, so refusing here keeps all three from
    // agreeing on the wrong part. Reachable from a units slip in a hand-edited
    // .ork (thickness 0.02 against radius 0.012).
    if (!(wall < outerR)) return null;
    return { outerR, innerR: outerR - wall, length };
  }
  return null;
}

/**
 * The bore a part offers at one end: what a shoulder plugging in there has to
 * fit inside.
 *
 * Distinct from {@link tubeRadii}, which answers "what bore does this part
 * offer whatever sits inside it" and takes a transition's wider end, because
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
      return bore(num(node, 'outerRadius', NaN), wall(TUBE_WALL[node.type]));
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

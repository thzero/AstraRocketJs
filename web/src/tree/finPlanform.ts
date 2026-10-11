import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import { num, positionOf } from './nodeProps';
import { findWithParent } from './treeWalk';
import { parentStartOf } from './axialRebase';
import { axialLength, freeformPoints, freeformRootChord, partLength, startFromPosition } from './position';
import { stationRadius } from './shapeProfile';
import { isPlanarFinSet } from './tubefins';
import { FIN_DEFAULTS, KERNEL_BODYTUBE_OUTER_RADIUS } from './kernelDefaults';

/**
 * Re-exported for convenience. The value itself lives in `kernelDefaults.ts`,
 * the one table verified against the real engine.
 *
 * `FIN_DEFAULTS` is deliberately not re-exported. A consumer that wants fin
 * dimensions takes them from `kernelDefaults`; what it gets from here is a
 * planform, so it never assembles its own trapezoid or elliptical arc from
 * dimensions.
 */
export { KERNEL_BODYTUBE_OUTER_RADIUS };

/**
 * The fin planform. One source of truth for every consumer that draws, prints,
 * cuts or exports a fin: the 3D view, the 2D schematic, the PDF template and
 * side view, the DXF writer and the solid-mesh exporter.
 *
 * ## Why this module exists
 *
 * No consumer may sample a fin outline itself. Call this module. A sampler
 * written independently is easy to get plausibly wrong: an elliptical outline
 * sampled as a sine arch (`x = root*t`, `y = height*sin(pi*t)`) looks right but
 * is a different part from the one the kernel flies. On a 50 x 30 mm fin the
 * height at the x = 5 mm station is 18.0 mm vs 9.3 mm, 94% off, and the
 * printed fin, the 1:1 PDF template and the laser-cut DXF would each disagree.
 *
 * Copies checked against each other can agree while all being wrong; the
 * reference is `EllipticalFinSet.java`. The companion
 * `finPlanform.kernel.test.ts` re-derives every formula here straight from the
 * committed Java under `engine-java/src/java` and fails if either side drifts,
 * so a kernel bump cannot silently desync the port.
 */

/**
 * Sample count of the kernel's elliptical outline (`EllipticalFinSet.POINTS`).
 *
 * Deliberately not a caller-tunable resolution. The kernel flies a 31-point
 * polygon, so 31 points is the fin; a consumer rendering a "smoother" 48-point
 * version would be drawing a shape the simulation never saw, which is the
 * class of divergence this module exists to end.
 */
export const KERNEL_ELLIPSE_POINTS = 31;

/**
 * Field fallbacks for a node missing a dimension: `FIN_DEFAULTS`, from
 * `kernelDefaults.ts`.
 *
 * Every creation path sets these (`treeEdit.defaultNode` and `orkImport`), so
 * they only apply to a hand-edited or truncated node. Every consumer must use
 * the same ones, or one fin comes out with a different tip chord in the STL and
 * in the DXF. They are the kernel's own trapezoid defaults (ComponentFactory,
 * case "trapezoidfinset"), which is what the engine flies for such a node, and
 * the kernel test pins them.
 */

/**
 * Outline for a freeform fin with too few points to form a polygon: a token
 * swept quad, so a half-built fin still draws as something rather than
 * vanishing. Shared so the 3D view and the PDF agree on the placeholder too.
 */
export const FREEFORM_FALLBACK: [number, number][] = [
  [0, 0],
  [0.02, 0.03],
  [0.05, 0],
];

/** The kernel's lower bound on a fin's root chord (`MathUtil.max(length, 0.0001)`). */
const MIN_ROOT = 0.0001;

/**
 * The elliptical planform, exactly as `EllipticalFinSet` builds it.
 *
 * The kernel's static table is
 *
 *     a = PI * (POINTS - 1 - i) / (POINTS - 1)
 *     POINT_X[i] = (cos(a) + 1) / 2
 *     POINT_Y[i] = sin(a)
 *
 * with the first and last entries then pinned to exactly (0,0) and (1,0), and
 * `getFinPoints()` scales them by `(max(length, 0.0001), height)`.
 *
 * Note `x` is not linear in `i`: it is `(1 - cos(pi*t))/2`, which bunches the
 * samples toward the leading and trailing edges where the curve turns. Reading
 * it as `x = root*t` gives the sine arch described above.
 *
 * @returns points from the leading root corner to the trailing one, root on
 *   `y = 0` and span toward `+y`, in meters.
 */
export function ellipticalFinPoints(rootChord: number, height: number): [number, number][] {
  const len = Math.max(rootChord, MIN_ROOT);
  const n = KERNEL_ELLIPSE_POINTS;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * (n - 1 - i)) / (n - 1);
    pts.push([((Math.cos(a) + 1) / 2) * len, Math.sin(a) * height]);
  }
  // The kernel pins the endpoints rather than trusting cos(pi) / sin(0).
  pts[0] = [0, 0];
  pts[n - 1] = [len, 0];
  return pts;
}

/** A trapezoid fin's four dimensions, with the one agreed set of fallbacks. */
export function trapezoidDims(node: ComponentNode): { root: number; tip: number; sweep: number; height: number } {
  return {
    root: num(node, 'rootChord', FIN_DEFAULTS.rootChord),
    tip: num(node, 'tipChord', FIN_DEFAULTS.tipChord),
    sweep: num(node, 'sweep', FIN_DEFAULTS.sweep),
    height: num(node, 'height', FIN_DEFAULTS.height),
  };
}

/**
 * The trapezoidal planform, as `TrapezoidFinSet.getFinPoints()` builds it.
 *
 * Including the kernel's collapse rule: a tip chord at or below 0.0001 m emits
 * a triangle (three points), not a trapezoid with a zero-length tip edge.
 */
export function trapezoidFinPoints(node: ComponentNode): [number, number][] {
  const { root, tip, sweep, height } = trapezoidDims(node);
  return trapezoidPoints(root, tip, sweep, height);
}

/**
 * The `TrapezoidFinSet.getFinPoints()` outline from explicit dimensions (m),
 * for a caller whose fallbacks differ from `FIN_DEFAULTS` (RockSim's are zero).
 * Same collapse rule: a tip chord at or below 0.0001 m emits a triangle.
 */
export function trapezoidPoints(root: number, tip: number, sweep: number, height: number): [number, number][] {
  const pts: [number, number][] = [
    [0, 0],
    [sweep, height],
  ];
  if (tip > 0.0001) pts.push([sweep + tip, height]);
  pts.push([Math.max(root, MIN_ROOT), 0]);
  return pts;
}

/**
 * The span-up planform of any planar fin set (root on `y = 0`, span toward
 * `+y`), in meters, without the through-the-wall tab. `null` when the outline
 * is degenerate and nothing should be drawn or cut.
 *
 * Freeform outlines come back kernel-normalized (translated so the first point
 * is the origin), which is what `FreeformFinSet.setPoints()` stores and
 * therefore what the fin's own root-relative tab coordinates are measured
 * against.
 */
export function finPlanformPoints(node: ComponentNode): [number, number][] | null {
  if (node.type === 'freeformfinset') {
    const ff = freeformPoints(node);
    return ff.length >= 3 ? ff : null;
  }
  if (node.type === 'ellipticalfinset') {
    return ellipticalFinPoints(finRootChord(node), finSpan(node));
  }
  if (node.type === 'trapezoidfinset') return trapezoidFinPoints(node);
  return null; // tube fins have no planform
}

/**
 * A fin's root chord (m): the axial span its root occupies on the body.
 *
 * For a freeform fin this is `last.x - first.x`, which is what the kernel uses
 * (`FreeformFinSet.length`), not the furthest-aft point. A fin whose tip
 * trailing corner overhangs the root reaches further aft than its root chord
 * does, and using that overhang puts a bottom- or middle-anchored fin, and its
 * tab, forward of its true station. See {@link freeformRootChord}.
 */
export function finRootChord(node: ComponentNode, fallback: number = FIN_DEFAULTS.rootChord): number {
  if (node.type === 'freeformfinset') {
    const ff = freeformPoints(node);
    if (ff.length) return freeformRootChord(ff, fallback);
  }
  return num(node, 'rootChord', fallback);
}

/**
 * A fin's span (m): how far it reaches above the body surface.
 *
 * A freeform fin carries no `height` key, so its span is its outline's y-max,
 * measured from the kernel-normalized points (translated by -p0 in both axes).
 * Floored at 0 so a degenerate outline reads as "no span" rather than a
 * negative one that would invert a silhouette or a lathe.
 *
 * Tube fins are not planar and have no span in this sense; they reach one tube
 * diameter and need the body radius to say so (see `tubeFinRadius`).
 */
export function finSpan(node: ComponentNode): number {
  if (node.type === 'freeformfinset') {
    const ff = freeformPoints(node);
    if (ff.length) {
      // A loop, not `Math.max(...ff.map())`: spreading a hostile 200k-point
      // outline into a call overflows the stack before any consumer's own
      // guard is reached, and this is the first thing the PDF report asks.
      let max = 0;
      for (const p of ff) if (Number.isFinite(p[1]) && p[1] > max) max = p[1];
      return max;
    }
  }
  return num(node, 'height', FIN_DEFAULTS.height);
}

/**
 * The through-the-wall tab, in the fin's own root-relative coordinates, or
 * `null` when there is no tab to cut.
 *
 * `height` is clamped to the depth the kernel allows: `FinSet.setTabHeight()`
 * applies `min(tabHeight, getMaxTabHeight())`, the body radius at the tab's
 * two ends (see {@link finTabLimit}). A tab taller than that would pass through
 * the airframe's axis and out the other side. A limit of zero or less leaves no
 * tab, as in the kernel.
 *
 * Clamped here rather than in each writer, so the DXF, the STL and the 1:1 PDF
 * template cannot cut a 20 mm tab on a 12 mm-radius body to three different
 * depths.
 *
 * @param parentRadius the tab depth limit from {@link parentRadiusOf} or
 *   {@link finTabLimit}, or `null` when the caller genuinely has no parent
 *   (then no clamp is applied).
 */
export function finTabSpan(
  node: ComponentNode,
  rootChord: number,
  parentRadius: number | null,
): { x0: number; x1: number; height: number } | null {
  const maxH = parentRadius != null && Number.isFinite(parentRadius) ? parentRadius : Infinity;
  const height = Math.min(num(node, 'tabHeight', 0), maxH);
  const length = num(node, 'tabLength', 0);
  if (!(height > 0) || !(length > 0)) return null;
  const x0 = Math.max(0, Math.min(rootChord, finTabFrontEdge(node, rootChord)));
  const x1 = Math.max(0, Math.min(rootChord, x0 + length));
  if (!(x1 - x0 > 1e-9)) return null;
  return { x0, x1, height };
}

/**
 * The tab's leading edge in root-relative coordinates: `FinSet.getTabFrontEdge()`,
 * the `tabPosition` that `AxialMethod.getAsPosition(tabOffset, tabLength,
 * length)` sets. Not clamped into the root chord: the kernel reads the parent
 * radius at this station as it stands.
 *
 * Lives here rather than in `schematicGeometry` so that a consumer computing a
 * tab never has to reach into a canvas module for half of it.
 */
function finTabFrontEdge(node: ComponentNode, rootChord: number): number {
  const method = typeof node['tabOffsetMethod'] === 'string' ? node['tabOffsetMethod'] : 'middle';
  return tabPosition(num(node, 'tabOffset', 0), num(node, 'tabLength', 0), rootChord, method);
}

/** `AxialMethod.getAsPosition(offset, tabLength, rootChord)` for one tab offset method. */
function tabPosition(offset: number, tabLen: number, rootChord: number, method: string): number {
  if (method === 'top' || method === 'absolute') return offset;
  if (method === 'after') return rootChord + offset;
  if (method === 'bottom') return offset + (rootChord - tabLen);
  return offset + (rootChord - tabLen) / 2;
}

/**
 * The closed cut contour for one fin: planform plus tab, ready to extrude, cut
 * or print. Walks the top edge leading→trailing, then back along the root,
 * dipping down for the tab. `null` when there is nothing printable.
 */
export function finCutContour(node: ComponentNode, parentRadius: number | null): [number, number][] | null {
  const top = finPlanformPoints(node);
  if (!top) return null;
  const tab = finTabSpan(node, finRootChord(node), parentRadius);
  if (!tab) return top;
  return [...top, [tab.x1, 0], [tab.x1, -tab.height], [tab.x0, -tab.height], [tab.x0, 0]];
}

/**
 * The radius (m) a fin set's tab is clamped to, or `null` when the part has no
 * symmetric parent.
 *
 * For a planar fin set this is {@link finTabLimit}, the limit {@link finTabSpan}
 * clamps against. For any other child it is the body tube radius, which a tube
 * fin set (mounted only on a body tube) sizes its automatic tubes from.
 *
 * Provided here, beside the clamp that consumes it, so that no exporter has to
 * invent its own answer; exporters that each pick a radius would cut the same
 * fin's tab to different depths.
 */
export function parentRadiusOf(tree: RocketTree, nodeId: string): number | null {
  // Searched below each top-level node, which is never itself the fin.
  for (const stage of tree.components) {
    const hit = findWithParent(stage.children ?? [], nodeId, stage);
    if (!hit) continue;
    if (!hit.parent) return null;
    if (isPlanarFinSet(hit.node.type)) return finTabLimit(hit.node, hit.parent, parentStartOf(tree, hit.parent));
    return hit.parent.type === 'bodytube' ? bodyTubeRadius(hit.parent) : null;
  }
  return null;
}

/**
 * The deepest tab the kernel allows on this fin set, `FinSet.getMaxTabHeight()`:
 * the smaller of the parent's radius at the tab's front edge and at its
 * trailing edge. Each station is measured from the parent's fore end as the
 * fin's own front (`getFinFront()`, its axial position in the parent) plus the
 * tab edge (`getTabFrontEdge()`, `getTabTrailingEdge()`), and read through
 * `SymmetricComponent.getRadius(x)`.
 *
 * On a body tube both stations read the same radius. On a transition or a nose
 * cone, where a freeform fin set also mounts (`Transition.isCompatible`), they
 * differ, and the narrower one bounds the tab. `stationRadius` clamps a station
 * into the part as `Transition.getRadius` does and puts a flipped nose cone's
 * base at its fore end.
 *
 * Meaningful for a fin set that carries a tab: without one the bridge leaves
 * the kernel's initial tab in place, and nothing here cuts a tab to clamp.
 * `null` when the parent is not a symmetric body.
 *
 * `parentStart` is the parent's leading edge in the rocket frame, which an
 * `absolute` fin set is placed against.
 */
export function finTabLimit(fin: ComponentNode, parent: ComponentNode, parentStart: number): number | null {
  if (parent.type === 'bodytube') return bodyTubeRadius(parent);
  if (parent.type !== 'nosecone' && parent.type !== 'transition') return null;
  const lead = finTabFrontEdge(fin, finRootChord(fin));
  const trail = lead + num(fin, 'tabLength', 0);
  const finFront = startFromPosition(positionOf(fin), axialLength(fin), partLength(parent), parentStart);
  return Math.min(stationRadius(parent, finFront + lead), stationRadius(parent, finFront + trail));
}

/** A body tube's radius, the same at every station (`BodyTube.getRadius(x)`). */
function bodyTubeRadius(node: ComponentNode): number {
  // 0.012 is the kernel's body-tube default (ComponentFactory bodytube
  // outerRadius), so a radius-less tube clamps the tab the way it is flown. Note
  // it is a radius: FIN_DEFAULTS.rootChord is a chord and does not belong here.
  return num(node, 'outerRadius', KERNEL_BODYTUBE_OUTER_RADIUS);
}

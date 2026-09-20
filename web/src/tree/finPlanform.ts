import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import { num } from './nodeProps';
import { freeformPoints, freeformRootChord } from './position';

/**
 * THE fin planform. One source of truth for every consumer that draws, prints,
 * cuts or exports a fin: the 3D view, the 2D schematic, the PDF template and
 * side view, the DXF writer and the solid-mesh exporter.
 *
 * ## Why this module exists
 *
 * It did not, and the cost was a fin that was the wrong shape for twelve days
 * across three audits. `solidMesh`, `reportGeometry` and `Rocket3D` each had
 * their own elliptical sampler generating a SINE ARCH (`x = root*t`,
 * `y = height*sin(pi*t)`); `dxfExport` had a fourth, independently written and
 * correct. So the printed fin, the 1:1 PDF template and the laser-cut DXF of
 * the same component were three different parts, and none of the three wrong
 * ones matched the rocket the kernel flew. On a 50 x 30 mm fin the error at
 * the x = 5 mm station is 18.0 mm vs 9.3 mm — 94%.
 *
 * It survived because every audit compared the copies to EACH OTHER and took
 * the oldest as ground truth. Nothing compared any of them to
 * `EllipticalFinSet.java`. A fix in one round even propagated the wrong curve
 * into a new module and labeled it "A true half-ellipse".
 *
 * So: no consumer may sample a fin outline itself. Call this module. The
 * companion `finPlanform.kernel.test.ts` re-derives every formula here
 * straight from the committed Java under `engine-java/src/java` and fails if
 * either side drifts, so a future kernel bump cannot silently desync the port.
 */

/**
 * Sample count of the kernel's elliptical outline (`EllipticalFinSet.POINTS`).
 *
 * Deliberately not a caller-tunable resolution. The kernel flies a 31-point
 * polygon, so 31 points IS the fin; a consumer rendering a "smoother" 48-point
 * version would be drawing a shape the simulation never saw, which is the
 * class of divergence this module exists to end.
 */
export const KERNEL_ELLIPSE_POINTS = 31;

/**
 * Field fallbacks for a node missing a dimension.
 *
 * Every creation path sets these (`treeEdit.newNode` and `orkImport`), so they
 * only bite on a hand-edited or truncated node — but they were the SECOND
 * drift: `tipChord` fell back to `0.03` in the mesh and PDF paths and to
 * `root * 0.6` in the DXF and schematic ones, so one fin was a 30 mm tip in
 * the STL and a 60 mm tip in the DXF. These match what `treeEdit.ts` and
 * `orkImport.ts` actually write.
 */
/** Kernel body-tube outer radius when the key is absent (ComponentFactory). */
export const KERNEL_BODYTUBE_OUTER_RADIUS = 0.012;

export const FIN_DEFAULTS = {
  rootChord: 0.05,
  height: 0.03,
  tipChord: 0.03,
  sweep: 0.02,
} as const;

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
 * Note `x` is NOT linear in `i`: it is `(1 - cos(pi*t))/2`, which bunches the
 * samples toward the leading and trailing edges where the curve turns. Reading
 * it as `x = root*t` is precisely the bug described above.
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
function trapezoidDims(node: ComponentNode): { root: number; tip: number; sweep: number; height: number } {
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
 * a TRIANGLE (three points), not a trapezoid with a zero-length tip edge.
 */
export function trapezoidFinPoints(node: ComponentNode): [number, number][] {
  const { root, tip, sweep, height } = trapezoidDims(node);
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
 * `+y`), in meters, WITHOUT the through-the-wall tab. `null` when the outline
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
 * (`FreeformFinSet.length`) — NOT the furthest-aft point. A fin whose tip
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
 * measured from the KERNEL-normalized points (translated by -p0 in both axes).
 * Floored at 0 so a degenerate outline reads as "no span" rather than a
 * negative one that would invert a silhouette or a lathe.
 *
 * Tube fins are not planar and have no span in this sense; they reach one tube
 * diameter and need the body radius to say so (see `tubeFinRadius`).
 */
export function finSpan(node: ComponentNode): number {
  if (node.type === 'freeformfinset') {
    const ff = freeformPoints(node);
    if (ff.length) return Math.max(0, ...ff.map((p) => (Number.isFinite(p[1]) ? p[1] : 0)));
  }
  return num(node, 'height', FIN_DEFAULTS.height);
}

/**
 * The through-the-wall tab, in the fin's own root-relative coordinates, or
 * `null` when there is no tab to cut.
 *
 * `height` is clamped to the parent's radius because the kernel clamps it:
 * `FinSet.setTabHeight()` applies `min(tabHeight, getMaxTabHeight())`, and
 * `getMaxTabHeight()` is `min(parentFrontRadius, parentTrailingRadius)`. A tab
 * taller than the body radius would pass through the airframe's axis and out
 * the other side.
 *
 * Only the DXF writer used to clamp. The STL and the 1:1 PDF template did not,
 * so a 20 mm tab on a 12 mm-radius body was cut three different depths
 * depending on which export the user opened.
 *
 * @param parentRadius body radius at the fin, or a non-positive value / `null`
 *   when the caller genuinely has no parent (then no clamp is applied).
 */
export function finTabSpan(
  node: ComponentNode,
  rootChord: number,
  parentRadius: number | null,
): { x0: number; x1: number; height: number } | null {
  const maxH = parentRadius != null && parentRadius > 0 ? parentRadius : Infinity;
  const height = Math.min(num(node, 'tabHeight', 0), maxH);
  const length = num(node, 'tabLength', 0);
  if (!(height > 0) || !(length > 0)) return null;
  const x0 = Math.max(0, Math.min(rootChord, finTabFrontEdge(node, rootChord)));
  const x1 = Math.max(0, Math.min(rootChord, x0 + length));
  if (!(x1 - x0 > 1e-9)) return null;
  return { x0, x1, height };
}

/**
 * The tab's leading edge in root-relative coordinates (`FinSet.getTabFrontEdge()`
 * via `AxialMethod.getAsPosition`).
 *
 * Lives here rather than in `schematicGeometry` so that a consumer computing a
 * tab never has to reach into a canvas module for half of it.
 */
function finTabFrontEdge(node: ComponentNode, rootChord: number): number {
  const offset = num(node, 'tabOffset', 0);
  const tabLen = num(node, 'tabLength', 0);
  const method = typeof node['tabOffsetMethod'] === 'string' ? (node['tabOffsetMethod'] as string) : 'middle';
  if (method === 'top') return offset;
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
 * The radius (m) of the body a fin set is mounted on, or `null` when the fin
 * has no symmetric parent.
 *
 * This is what {@link finTabSpan} clamps against. The kernel takes
 * `min(getParentFrontRadius(), getParentTrailingRadius())`, so a tapered
 * parent contributes its NARROWER end: that is the station where a tab of the
 * full height would break through first.
 *
 * Provided here, beside the clamp that consumes it, so that no exporter has to
 * invent its own answer — `dxfExport` used the enclosing tube's bore while the
 * mesh and PDF paths used nothing at all, and the same fin came out with three
 * different tab depths.
 */
export function parentRadiusOf(tree: RocketTree, nodeId: string): number | null {
  let found: number | null = null;
  const walk = (parent: ComponentNode): boolean => {
    for (const child of parent.children ?? []) {
      if (child.id === nodeId) {
        found = symmetricRadius(parent);
        return true;
      }
      if (walk(child)) return true;
    }
    return false;
  };
  for (const stage of tree.components) if (walk(stage)) break;
  return found;
}

/** The mounting radius of a symmetric body component, or `null` if it is not one. */
function symmetricRadius(node: ComponentNode): number | null {
  // 0.012 is the kernel's body-tube default (ComponentFactory bodytube
  // outerRadius), so a radius-less tube clamps the tab the way it is flown.
  // It used to fall back to FIN_DEFAULTS.rootChord, a chord, not a radius.
  if (node.type === 'bodytube') return num(node, 'outerRadius', KERNEL_BODYTUBE_OUTER_RADIUS) || null;
  if (node.type === 'nosecone') return num(node, 'aftRadius', 0) || null;
  if (node.type === 'transition') {
    // The kernel's min(front, trailing): the narrow end bounds the tab.
    const fore = num(node, 'foreRadius', 0);
    const aft = num(node, 'aftRadius', 0);
    const r = Math.min(fore || Infinity, aft || Infinity);
    return Number.isFinite(r) && r > 0 ? r : null;
  }
  return null;
}

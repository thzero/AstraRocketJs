import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import { bodyTubeRadius, finCant, num, positionOf } from './nodeProps';
import { findWithParent } from './treeWalk';
import { parentStartOf } from './axialRebase';
import { axialLength, freeformPoints, freeformRootChord, partLength, startFromPosition } from './position';
import { nodeShape, stationRadius } from './shapeProfile';
import { isFinSet, isPlanarFinSet } from './tubefins';
import { FIN_DEFAULTS, KERNEL_DEFAULTS } from './kernelDefaults';
import { isZero } from '../services/motors/mathEquals';

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
 *
 * ## A fin on its parent
 *
 * A fin's root is not a straight line at y = 0. The kernel stands the fin on
 * the body radius under its front (`FinSet.getFinFront`) and runs the root
 * along the parent's own profile from there (`FinSet.getRootPoints`); every
 * planar fin's first and last outline points sit on that root
 * (`getFinPoints`); and the tab starts at the body surface at each of its own
 * stations (`getTabPoints`). On a body tube the root is flat and these reduce
 * to the planform; on a nose cone or transition they do not. A
 * {@link FinMount} carries what those methods read from the parent, and
 * {@link finMountOf} / {@link finMount} build one. Every reader that places,
 * draws or cuts a planar fin takes its root, outline and tab from here:
 * {@link finRootPoints}, {@link finOutlinePoints}, {@link finTabPoints},
 * {@link finPointsWithRoot} (a drawing) and {@link finCutContour} (a cut).
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
 * A freeform fin carries no `height` key. Given its parent, its span is
 * `FreeformFinSet.getSpan`: the highest point of the outline as the kernel
 * stores it, with the trailing point moved onto the parent's surface
 * (`clampLastPoint`) and interior points raised out of it
 * (`clampInteriorPoint`), less the trailing point's depth below the root's
 * front. Those stored points are the outline {@link finOutlinePoints} gives
 * for the fin uncanted, since the stored points do not turn with the cant.
 * Without a parent it is the y-max of the kernel-normalized points (translated
 * by -p0 in both axes). Floored at 0 so a degenerate outline reads as "no
 * span" rather than a negative one that would invert a silhouette or a lathe.
 *
 * Tube fins are not planar and have no span in this sense; they reach one tube
 * diameter and need the body radius to say so (see `tubeFinRadius`).
 */
export function finSpan(node: ComponentNode, parent: FinParent = null): number {
  if (node.type === 'freeformfinset') {
    const stored = parent === null ? null : finOutlinePoints({ ...node, cant: 0 }, parent);
    if (stored) {
      let max = 0;
      for (const p of stored) if (Number.isFinite(p[1]) && p[1] > max) max = p[1];
      const last = stored[stored.length - 1]![1];
      return max - Math.min(Number.isFinite(last) ? last : 0, 0);
    }
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
  // Each planar set's own constructor height: EllipticalFinSet() starts at
  // 0.05 m where TrapezoidFinSet() starts at 0.03 m, and the bridge flies the
  // same per-type fallback for a node with no height.
  return num(
    node,
    'height',
    node.type === 'ellipticalfinset' ? KERNEL_DEFAULTS.ellipticalfinset.height : FIN_DEFAULTS.height,
  );
}

/**
 * The through-the-wall tab's span along the root and its depth, in the fin's
 * own root-relative coordinates, or `null` when there is no tab to cut. The
 * tab's outline, which on a tapered parent starts at the body surface at each
 * end rather than at y = 0, is {@link finTabPoints}.
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
 * The span is where the tab stands, `getTabFrontEdge()` to
 * `getTabTrailingEdge()`, not clamped into the root chord: the kernel never
 * moves a tab back onto the root, so one offset past the fin's front or
 * trailing edge flies and is exported where it stands.
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
  const x0 = finTabFrontEdge(node, rootChord);
  const x1 = x0 + length;
  if (!(x1 - x0 > 1e-9) || !Number.isFinite(x0)) return null;
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
export function tabPosition(offset: number, tabLen: number, rootChord: number, method: string): number {
  if (method === 'top' || method === 'absolute') return offset;
  if (method === 'after') return rootChord + offset;
  if (method === 'bottom') return offset + (rootChord - tabLen);
  return offset + (rootChord - tabLen) / 2;
}

/** `AxialMethod.getAsOffset(position, tabLength, rootChord)`: the inverse of {@link tabPosition}. */
export function tabOffsetAt(position: number, tabLen: number, rootChord: number, method: string): number {
  if (method === 'top' || method === 'absolute') return position;
  if (method === 'after') return position - rootChord;
  if (method === 'bottom') return position + (tabLen - rootChord);
  return position + (tabLen - rootChord) / 2;
}

/** A point in a fin's own frame: x from the fin front, y from the body surface under it (m). */
type Pt = [number, number];

/**
 * What a planar fin set reads from the body it stands on.
 *
 * The kernel's `FinSet` asks its `SymmetricComponent` parent for the radius at
 * a station (`getRadius(x)`) and for the parent's length, and stands at
 * `getFinFront().getX()` along it. Built by {@link finMount} or
 * {@link finMountOf}.
 */
export interface FinMount {
  /**
   * The parent's outer radius (m) at a station `x` measured from its fore end,
   * as `SymmetricComponent.getRadius(x)` reads it: a station outside the part
   * reads the nearer end.
   */
  radiusAt: (x: number) => number;
  /** The parent's length (m). */
  length: number;
  /** The fin's front, measured from the parent's fore end (m). */
  front: number;
  /**
   * True when the parent is a nose cone or transition whose profile is not a
   * cone. The kernel samples a root along such a parent every 2.5 mm, and along
   * a cone or a tube draws it as one straight segment.
   */
  curved: boolean;
}

/**
 * A fin's parent as a reader may hold it: a mount, a body tube radius (the
 * parent is a tube of that radius), or `null` when there is no parent (a flat
 * root and no limit on the tab).
 */
export type FinParent = FinMount | number | null;

/** `FinSet.MAX_ROOT_DIVISIONS`: the most intervals a root is sampled at. */
const MAX_ROOT_DIVISIONS = 100;
/** `getMountPoints`'s sampling step along a curved parent or under a canted fin (m). */
const ROOT_STEP = 0.0025;
/** `MathUtil.EPSILON`. */
const EPSILON = 1e-8;

/** The same point to within float noise. */
const samePoint = (a: Pt, b: Pt): boolean => Math.abs(a[0] - b[0]) <= 1e-12 && Math.abs(a[1] - b[1]) <= 1e-12;

/**
 * The outer radius (m) of a fin's parent at a station `x` from its fore end,
 * `SymmetricComponent.getRadius(x)`: a body tube is one radius end to end, a
 * nose cone or transition follows its profile (a flipped nose cone's base is
 * its fore end). `null` for a parent that is not a symmetric body.
 *
 * This is the radius a child stands on at its own station. A view that places
 * a fin set on a nose cone or transition reads it at the fin's front
 * (`mount.radiusAt(mount.front)`), not at the parent's widest end.
 */
export function bodyRadiusAt(parent: ComponentNode, x: number): number | null {
  if (parent.type === 'bodytube') return bodyTubeRadius(parent);
  if (parent.type === 'nosecone' || parent.type === 'transition') return stationRadius(parent, x);
  return null;
}

/**
 * Where a fin set stands on `parent`, or `null` when the parent is not a
 * symmetric body.
 *
 * `parentStart` is the parent's leading edge in the rocket frame, which an
 * `absolute` fin set is placed against (`parentStartOf`).
 */
export function finMount(fin: ComponentNode, parent: ComponentNode, parentStart: number): FinMount | null {
  if (bodyRadiusAt(parent, 0) === null) return null;
  const length = partLength(parent);
  return {
    radiusAt: (x) => bodyRadiusAt(parent, x) ?? 0,
    length,
    front: startFromPosition(positionOf(fin), axialLength(fin), length, parentStart),
    curved: parent.type !== 'bodytube' && nodeShape(parent) !== 'conical',
  };
}

/**
 * Where the fin set `nodeId` stands, read from the tree, or `null` when it is
 * not a fin set or its parent is not a symmetric body. The cut readers (the
 * STL, the DXF, the 1:1 template) pass this to {@link finCutContour}.
 */
export function finMountOf(tree: RocketTree, nodeId: string): FinMount | null {
  // Searched below each top-level node, which is never itself the fin.
  for (const stage of tree.components) {
    const hit = findWithParent(stage.children ?? [], nodeId, stage);
    if (!hit) continue;
    if (!hit.parent || !isFinSet(hit.node.type)) return null;
    return finMount(hit.node, hit.parent, parentStartOf(tree, hit.parent));
  }
  return null;
}

/** The mount a {@link FinParent} stands for, and whether its tab is clamped. */
function resolveMount(parent: FinParent): { mount: FinMount; clamp: boolean } {
  if (parent !== null && typeof parent === 'object') return { mount: parent, clamp: true };
  const finite = typeof parent === 'number' && Number.isFinite(parent);
  const r = finite ? parent : 0;
  return { mount: { radiusAt: () => r, length: Infinity, front: 0, curved: false }, clamp: finite };
}

/** The body radius (m) under a fin set's front, or `null` without a parent. */
export function mountRadius(parent: FinParent): number | null {
  if (parent === null) return null;
  return typeof parent === 'number' ? parent : parent.radiusAt(parent.front);
}

/**
 * `FinSet.getFinCantYOffset`: how far a canted fin's root drops at the station
 * `xCurr` to stay on the body, with the fin turned about its root's midpoint.
 * Where the turned root reaches the radius aft of the midpoint the kernel
 * leaves the root where it is. Ahead of the midpoint its guard never trips and
 * it takes the square root of a negative number, so the kernel's points are
 * NaN there; this leaves the root in place on that side too, so the drawing
 * stays finite, and `overturnedFins` keeps such a fin set from flying.
 */
function cantYOffset(mount: FinMount, cant: number, xStart: number, xEnd: number, xCurr: number): number {
  const L = mount.length;
  if (isZero(cant) || (xStart > L && xEnd > L) || (xStart < 0 && xEnd < 0)) return 0;
  const x = Math.min(Math.max(xCurr, 0), L);
  const xCenter = (xStart + xEnd) / 2;
  const dx = x - xCenter;
  const r = mount.radiusAt(xCenter + dx * Math.abs(Math.cos(cant)));
  const dz = Math.abs(Math.sin(cant)) * dx;
  if (Math.abs(dz) >= r) return 0;
  return -(r - Math.sqrt(r * r - dz * dz));
}

/**
 * The fin's root along its parent, `FinSet.getRootPoints()`: from the fin
 * front to its trailing edge, in the fin's own frame (x from the fin front, y
 * from the body surface there). A flat pair on a body tube; on a nose cone or
 * transition the root follows the profile, sampled as `getMountPoints` samples
 * it, and a canted fin's root drops to stay on the body.
 */
export function finRootPoints(fin: ComponentNode, parent: FinParent): Pt[] {
  const { mount } = resolveMount(parent);
  const xStart = mount.front;
  // A chord below zero is sampled as zero. `TrapezoidFinSet.setLength` floors
  // it there (TrapezoidFinSet.java:90); `EllipticalFinSet.setLength` keeps it
  // (EllipticalFinSet.java:93) but the bridge refuses a negative `rootChord`
  // before the kernel sees one, so zero is the nearest chord it flies; a
  // freeform chord is its outline's own span (`freeformRootChord`). Sampled as
  // stored, a negative interval on a canted fin yields no root point at all.
  const len = Math.max(finRootChord(fin), 0);
  const xEnd = xStart + len;
  // Clamped as `FinSet.setCantAngle` clamps it: a file's cant past the limit flies at the limit.
  const cant = finCant(fin);
  // The interval as the kernel takes it, end less start: a root of 40 mm at a
  // 40.05 mm station spans 40.000000000000004 mm there, which is 17 steps of
  // 2.5 mm, not 16.
  const interval = xEnd - xStart;
  const divisions = !isZero(cant) || mount.curved ? Math.min(MAX_ROOT_DIVISIONS, Math.ceil(interval / ROOT_STEP)) : 1;
  const step = interval / divisions;
  const points: Pt[] = [];
  // Stepped by repeated addition, as the kernel steps it, so each station is
  // the kernel's to the last bit.
  let x = xStart;
  for (let i = 0; i < divisions + 1; i++) {
    points.push([x, mount.radiusAt(x) + cantYOffset(mount, cant, xStart, xEnd, x)]);
    x += step;
  }
  // A root that starts ahead of the parent or runs past its end takes a point
  // at that end, so the root turns the corner there.
  const insertAt = (at: number, y: number) => {
    if (points.some(([px]) => Math.abs(px - at) < EPSILON)) return;
    let i = 0;
    while (i < points.length && points[i]![0] < at) i++;
    points.splice(i, 0, [at, y]);
  };
  if (xStart < 0 && xEnd > 0) insertAt(0, points[0]![1]);
  if (xEnd > mount.length && xStart < mount.length) insertAt(mount.length, points[points.length - 1]![1]);
  const last = points[points.length - 1]!;
  if (Math.abs(last[0] - mount.length) < EPSILON) last[0] = mount.length;
  const yFront = mount.radiusAt(xStart);
  if (Math.abs(xStart) + Math.abs(yFront) <= EPSILON) return points;
  return points.map(([px, py]) => [px - xStart, py - yFront]);
}

/**
 * The outline the kernel flies, `getFinPoints()`: the planform with its first
 * and last points moved onto the ends of the root ({@link finRootPoints}). On
 * a body tube the planform's ends already lie there, so this is the planform.
 * A freeform point between the ends that lies inside the parent is raised to
 * its surface, as `FreeformFinSet.clampInteriorPoint` raises it. `null` when
 * the planform is degenerate.
 */
export function finOutlinePoints(fin: ComponentNode, parent: FinParent): Pt[] | null {
  const top = finPlanformPoints(fin);
  if (!top) return null;
  const root = finRootPoints(fin, parent);
  const out = top.map(([x, y]): Pt => [x, y]);
  const { mount, clamp } = resolveMount(parent);
  if (fin.type === 'freeformfinset' && clamp) {
    const yFin = mount.radiusAt(mount.front);
    for (let i = 1; i < out.length - 1; i++) {
      const [x, y] = out[i]!;
      if (x < -mount.front || x > -mount.front + mount.length) continue;
      const yBody = mount.radiusAt(x + mount.front) - yFin;
      if (yBody > y) out[i] = [x, yBody];
    }
  }
  // An end already on the root to within float noise keeps its own value: the
  // root's trailing station is (front + root) - front, a last-bit rounding of
  // the root chord that would otherwise move every flat-rooted fin.
  const onto = (i: number, p: Pt) => {
    if (!samePoint(out[i]!, p)) out[i] = [p[0], p[1]];
  };
  if (root.length > 1) {
    onto(0, root[0]!);
    onto(out.length - 1, root[root.length - 1]!);
  }
  return out;
}

/**
 * The tab, `FinSet.getTabPoints()`: down from the body surface at its front
 * station, along its bottom, and up to the body surface at its trailing
 * station, in the fin's own frame. Its bottom is the tab depth below the
 * shallower of the two surface points. `null` when there is no tab to cut.
 */
export function finTabPoints(fin: ComponentNode, parent: FinParent): Pt[] | null {
  const { mount, clamp } = resolveMount(parent);
  const tab = finTabSpan(fin, finRootChord(fin), clamp ? mountTabLimit(fin, mount) : null);
  if (!tab) return null;
  const yFin = mount.radiusAt(mount.front);
  const yFront = mount.radiusAt(mount.front + tab.x0) - yFin;
  const yTrail = mount.radiusAt(mount.front + tab.x1) - yFin;
  const yBottom = Math.min(yFront, yTrail) - tab.height;
  return [
    [tab.x0, yFront],
    [tab.x0, yBottom],
    [tab.x1, yBottom],
    [tab.x1, yTrail],
  ];
}

/**
 * Append root points to an outline, each unless it repeats the point before
 * it, and drop a last one that closes back onto the outline's first point.
 */
function appendRoot(out: Pt[], pts: readonly Pt[]): void {
  const before = out.length;
  for (const p of pts) if (!samePoint(out[out.length - 1]!, p)) out.push(p);
  if (out.length > before && samePoint(out[0]!, out[out.length - 1]!)) out.pop();
}

/**
 * A fin's closed outline for drawing, `getFinPointsWithRoot()`: the outline
 * ({@link finOutlinePoints}), then back along the root to the front, in the
 * fin's own frame. To place it, add the fin's front station to x and the body
 * radius under that front (`mount.radiusAt(mount.front)`) to y. Points the root
 * shares with the outline are not repeated. `null` when the planform is
 * degenerate.
 */
export function finPointsWithRoot(fin: ComponentNode, parent: FinParent): Pt[] | null {
  const outline = finOutlinePoints(fin, parent);
  if (!outline) return null;
  const out = [...outline];
  appendRoot(out, [...finRootPoints(fin, parent)].reverse());
  return out;
}

/**
 * Where one fin of a planar fin set stands: what {@link finBodyPoint} turns a
 * point of its outline by. `front` is the fin front's station along the rocket
 * axis, `radius` the body radius under it, `chord` the set's root chord (the
 * kernel's `FinSet.length`, which the cant turns about the middle of), `cant`
 * the cant as the kernel flies it ({@link finCant}), and `angle` the fin's
 * whole turn about its parent's axis: its own instance angle
 * (`FinSet.getInstanceAngles`) plus every enclosing pod or booster instance's
 * (`RocketComponent.getComponentAngles`), and a view's roll.
 */
export interface FinPose {
  front: number;
  radius: number;
  chord: number;
  cant: number;
  angle: number;
}

/**
 * A point of a fin's outline, in its own frame (`x` from the fin front, `y`
 * from the body surface there, `z` across its thickness), carried into the
 * rocket frame of its parent's axis: `[x, y, z]`, x aft along the axis.
 *
 * The kernel's own placement, `FinSet.getInstanceOffsets`
 * (FinSet.java:1783-1791): the fin is turned by `getCantRotation()`, a
 * `rotate_y(cant)` (FinSet.java:252-260, Transformation.java:279-287) about
 * the middle of its root chord, then by `rotate_x(angle)`
 * (Transformation.java:263-271), which is also the axial rotation an
 * enclosing pod or booster instance adds (FlightConfiguration.java:466-472).
 */
export function finBodyPoint(x: number, y: number, z: number, pose: FinPose): [number, number, number] {
  const mid = pose.chord / 2;
  const cc = Math.cos(pose.cant);
  const sc = Math.sin(pose.cant);
  const ca = Math.cos(pose.angle);
  const sa = Math.sin(pose.angle);
  const r = pose.radius + y;
  const across = -(x - mid) * sc + z * cc;
  return [pose.front + mid + (x - mid) * cc + z * sc, r * ca - across * sa, r * sa + across * ca];
}

/**
 * The closed cut contour for one fin: outline plus tab, ready to extrude, cut
 * or print, in the fin's own frame. Walks the outline from the leading to the
 * trailing edge, then back along the root ({@link finRootPoints}), dipping down
 * for the tab ({@link finTabPoints}) where the root passes it; root points
 * inside the tab span are left out, as `FinSet.getTabPointsWithRoot` leaves
 * them out. A tab wholly ahead of the fin or wholly behind it is left off,
 * as `FinSet.generateContinuousFinAndTabShape` leaves it off: it does not join
 * the fin. `null` when there is nothing printable.
 *
 * `parent` is the fin's {@link FinMount} ({@link finMountOf}), a body tube
 * radius, or `null` for no parent (a flat root and an unclamped tab).
 */
export function finCutContour(node: ComponentNode, parent: FinParent): Pt[] | null {
  const outline = finOutlinePoints(node, parent);
  if (!outline) return null;
  const back = [...finRootPoints(node, parent)].reverse();
  const len = finRootChord(node);
  const points = finTabPoints(node, parent);
  const beyond = points && ((points[0]![0] > len && points[3]![0] > len) || (points[0]![0] < 0 && points[3]![0] < 0));
  const tab = beyond ? null : points;
  const out = [...outline];
  if (!tab) {
    appendRoot(out, back);
    return out;
  }
  const x0 = tab[0]![0];
  const x1 = tab[3]![0];
  appendRoot(
    out,
    back.filter(([x]) => x > x1),
  );
  out.push(tab[3]!, tab[2]!, tab[1]!, tab[0]!);
  appendRoot(
    out,
    back.filter(([x]) => x < x0),
  );
  return out;
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
function finTabLimit(fin: ComponentNode, parent: ComponentNode, parentStart: number): number | null {
  const mount = finMount(fin, parent, parentStart);
  return mount ? mountTabLimit(fin, mount) : null;
}

/** {@link finTabLimit} for a fin already placed on its parent. */
function mountTabLimit(fin: ComponentNode, mount: FinMount): number {
  const lead = finTabFrontEdge(fin, finRootChord(fin));
  const trail = lead + num(fin, 'tabLength', 0);
  return Math.min(mount.radiusAt(mount.front + lead), mount.radiusAt(mount.front + trail));
}

import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { KERNEL_DEFAULTS } from '../../tree/kernelDefaults';
import { countOf, num } from '../../tree/nodeProps';
import { finRootChord } from '../../tree/finPlanform';
import { isFinSet, isPlanarFinSet } from '../../tree/tubefins';

/**
 * THE fin marking guide's arithmetic: which body tube gets a guide, how long
 * the wrapped strip is, where its seam falls, and how far along it each fin,
 * tube fin, launch lug and rail button is marked.
 *
 * Ported from OpenRocket's `FinMarkingGuide.java`
 * (`swing/src/main/java/info/openrocket/swing/gui/print/`) at the ref pinned in
 * `engine-java/extract/UPSTREAM`. That file is NOT in `engine-java/src/java`:
 * the extraction is sparse to `core/src/main/java`, and the marking guide lives
 * in the swing module, so there is no committed Java for a kernel test to
 * re-derive these numbers from. Every formula below therefore carries the Java
 * line it came from, and the companion test pins the cases that formula has to
 * get right.
 *
 * Kept free of jsPDF, the way `layout.ts` is: a drift in the seam rule or the
 * circumference prints a guide that looks entirely plausible and puts the fins
 * in the wrong place, and it is only found after someone has glued to it.
 *
 * `markingSection.ts` draws what this module returns.
 */

export const TWO_PI = 2 * Math.PI;

/**
 * Printer paper, 0.1 mm (`FinMarkingGuide.PAPER_THICKNESS_IN_METERS`).
 *
 * Wrapping the strip around the tube puts the printed marks one paper
 * thickness OUT from the tube surface, so the strip has to be cut to the
 * circumference of that slightly larger circle or its ends will not meet.
 * Upstream's note: the smaller the tube, the larger the error as a fraction of
 * the circumference. On a 13 mm tube it is 0.8%, which on four fins is nearly
 * 3 degrees of accumulated skew by the last one.
 */
export const PAPER_THICKNESS_M = 0.0001;

/**
 * The strip's width across the body axis, 3 in (`DEFAULT_GUIDE_WIDTH`).
 *
 * Arbitrary, and upstream says so: it only has to be wide enough to rule a
 * line along. It is NOT the page width — the width is fixed so that two guides
 * sit side by side on a page.
 */
export const GUIDE_WIDTH_MM = 76.2;

/** One mark on a strip: where a single fin, tube, lug or button goes. */
export interface GuideMark {
  /** Distance from the seam edge, along the wrap (mm). */
  posMm: number;
  /** The component's own name; '' falls back to its type in the drawing. */
  name: string;
  type: string;
  /** Fin cant (rad). 0 for tube fins, lugs and rail buttons, which cannot cant. */
  cant: number;
  /** Root chord (mm) — the cant marks are laid out from it. 0 when not canted. */
  rootChordMm: number;
}

export interface MarkingGuide {
  tubeId: string;
  /** The tube's own name; '' falls back to its type in the drawing. */
  name: string;
  /** Wrap length (mm): the circumference the paper actually takes, not the tube's. */
  circumferenceMm: number;
  /** The seam angle (rad): the angle the strip's two ends meet at. */
  origin: number;
  /** Marks, nearest the seam edge first. */
  marks: GuideMark[];
}

/** Why an angular part carries no mark, so the drawing can say so rather than drop it. */
export type OmitReason = 'noWrap' | 'noFins';

export interface OmittedPart {
  name: string;
  type: string;
  reason: OmitReason;
}

export interface MarkingGuideSet {
  guides: MarkingGuide[];
  omitted: OmittedPart[];
}

/** Anything that sits at an angle around the body: what a guide can mark. */
const isAngular = (type: string): boolean => isFinSet(type) || type === 'launchlug' || type === 'railbutton';

/**
 * The wrapped length of the strip (mm).
 *
 * `(getOuterRadius() + PAPER_THICKNESS_IN_METERS) * TWO_PI`, in millimeters
 * because the report document is in millimeters and draws 1:1.
 */
export const guideCircumferenceMm = (outerRadiusM: number): number =>
  (outerRadiusM + PAPER_THICKNESS_M) * TWO_PI * 1000;

/**
 * An angle folded into [0, 2π) (`FinMarkingGuide.makeZeroTwoPi`).
 *
 * Upstream loops `while (v > TWO_PI)`, so an angle of exactly 2π stays at 2π
 * there and folds to 0 here. That is the only difference, and 0 is the right
 * answer: a mark at 2π is the same mark as one at 0, and leaving it at the far
 * end makes {@link radialOrigin} see a gap that is not there.
 */
export const zeroTwoPi = (v: number): number => {
  const r = v % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
};

/**
 * Where to put the strip's seam (rad) — `FinMarkingGuide.findRadialOrigin`.
 *
 * The seam is the one place on the wrap that cannot be marked: it is where the
 * two ends butt together and where the tape goes. So the origin is chosen as
 * the MIDDLE OF THE WIDEST GAP between marks, which puts every mark as far
 * from the seam as the design allows. A single mark has no gap, so it goes
 * half a turn away (`pos[0] + PI`).
 *
 * The wrap-around gap (from the last mark, over 2π, to the first) is seeded
 * before the loop; it is the widest one whenever the marks are bunched, which
 * is exactly the asymmetric case the rule exists for.
 */
export function radialOrigin(angles: number[]): number {
  const pos = angles.map(zeroTwoPi).sort((a, b) => a - b);
  if (pos.length === 0) return 0;
  if (pos.length === 1) return zeroTwoPi(pos[0]! + Math.PI);

  let biggest = TWO_PI - pos[pos.length - 1]! + pos[0]!;
  let center = zeroTwoPi(pos[0]! - biggest / 2);
  for (let i = 1; i < pos.length; i++) {
    const d = pos[i]! - pos[i - 1]!;
    if (d > biggest) {
      biggest = d;
      center = zeroTwoPi(pos[i - 1]! + d / 2);
    }
  }
  return center;
}

const finCountDefault = (type: string): number => {
  const d = (KERNEL_DEFAULTS as Record<string, { finCount?: number }>)[type];
  return d?.finCount ?? 3;
};

/**
 * Every angle (rad) one component is mounted at.
 *
 * A fin set is `finCount` marks evenly spaced from its base rotation
 * (`getBaseRotation() + fin * TWO_PI / finCount`); a lug or rail button is a
 * single mark at its `getAngleOffset()`. The property names and their
 * fallbacks are the ones the 3D view places the same parts at
 * (`rocketPieces.ts:141`, `:166`, `:203`) and the ones the `.ork` writer saves
 * (`exportWriters.ts:278`, `:291`), so the guide cannot mark a fin somewhere
 * the app does not draw it.
 */
export function mountAngles(node: ComponentNode): number[] {
  const type = String(node.type);
  if (!isFinSet(type)) return [num(node, 'angleOffset', Math.PI)];
  const count = countOf(node, 'finCount', finCountDefault(type));
  const base = num(node, 'rotation', 0);
  return Array.from({ length: count }, (_, i) => base + (i * TWO_PI) / count);
}

/**
 * Where to cut a strip too long for one page, as distances along the wrap:
 * always `[0, …, circumference]`, so consecutive pairs are the pieces.
 *
 * Upstream never faces this — it rasterizes the guide and crops it across
 * pages, so its joins fall wherever the page edge does. Ours are butt joints
 * the reader tapes, and a join is no better to mark on than the seam is: the
 * tape covers it and the two pieces can shift against each other. So a cut is
 * placed at the point of its legal window FURTHEST FROM ANY MARK, with the gap
 * midpoints as the candidates, the way {@link radialOrigin} picks the seam.
 *
 * The window is what keeps every piece printable: a cut may not leave this
 * piece longer than `maxLengthMm`, nor leave more than the remaining pieces can
 * hold.
 */
export function cutPoints(markPositions: number[], circumferenceMm: number, maxLengthMm: number): number[] {
  const parts = Math.max(1, Math.ceil(circumferenceMm / maxLengthMm - 1e-9));
  if (parts === 1) return [0, circumferenceMm];

  // Every gap midpoint on the wrap, the strip's own two ends included.
  const sorted = [...markPositions].sort((a, b) => a - b);
  const edges = [0, ...sorted, circumferenceMm];
  const candidates = edges.slice(1).map((e, i) => (e + edges[i]!) / 2);
  const clearance = (at: number) => sorted.reduce((best, m) => Math.min(best, Math.abs(m - at)), Infinity);

  const cuts = [0];
  for (let k = 1; k < parts; k++) {
    const prev = cuts[k - 1]!;
    const lo = Math.max(prev, circumferenceMm - (parts - k) * maxLengthMm);
    const hi = Math.min(circumferenceMm, prev + maxLengthMm);
    const even = Math.min(hi, Math.max(lo, (k * circumferenceMm) / parts));
    let best = even;
    let bestClear = clearance(even);
    // The window's own ends count as candidates too, and they are what wins
    // when the window falls entirely inside one gap or straddles a single mark:
    // the farthest-from-any-mark point of an interval is always either a gap
    // midpoint or an end of the interval.
    for (const c of [lo, hi, ...candidates]) {
      if (c < lo || c > hi) continue;
      const clear = clearance(c);
      // Ties go to the cut nearer the even split, which keeps the pieces from
      // drifting to wildly different lengths when the marks are symmetric.
      if (clear > bestClear || (clear === bestClear && Math.abs(c - even) < Math.abs(best - even))) {
        best = c;
        bestClear = clear;
      }
    }
    cuts.push(best);
  }
  cuts.push(circumferenceMm);
  return cuts;
}

function buildGuide(tube: ComponentNode, angular: ComponentNode[]): MarkingGuide {
  const circumferenceMm = guideCircumferenceMm(num(tube, 'outerRadius', KERNEL_DEFAULTS.bodytube.outerRadius));
  const raw = angular.flatMap((c) => mountAngles(c).map((angle) => ({ angle, node: c })));
  const origin = radialOrigin(raw.map((r) => r.angle));
  const marks = raw
    .map(({ angle, node }) => {
      // The linear map upstream documents on paintComponent: radialOrigin -> 0,
      // radialOrigin + TWO_PI -> circumference.
      const posMm = (zeroTwoPi(angle - origin) / TWO_PI) * circumferenceMm;
      const planar = isPlanarFinSet(String(node.type));
      const cant = planar ? num(node, 'cant', 0) : 0;
      return {
        posMm,
        name: String(node.name ?? ''),
        type: String(node.type),
        cant,
        // `finRootChord`, which is `FinSet.getLength()`: the axial span of the
        // ROOT, so a freeform fin measures its outline rather than reading a
        // `rootChord` key it does not carry.
        rootChordMm: cant !== 0 ? finRootChord(node) * 1000 : 0,
      };
    })
    // Upstream draws in component order; sorting makes the strip read top to
    // bottom and keeps the drawn output stable for a design whose tree order
    // changed but whose geometry did not.
    .sort((a, b) => a.posMm - b.posMm);

  return { tubeId: String(tube.id), name: String(tube.name ?? ''), circumferenceMm, origin, marks };
}

/**
 * One guide per body tube that carries at least one fin set, with everything
 * angular on that tube consolidated onto it.
 *
 * Two upstream rules are kept:
 *
 * - **A tube with no fin set gets no guide.** "Don't draw the lug if there are
 *   no fins" (`hasFins`): this is a FIN marking guide, and a lone lug line has
 *   nothing to be square to.
 * - **Body tubes only.** A nose cone or transition changes radius along its
 *   length, so there is no single circumference to wrap.
 *
 * One is not. Upstream groups by "the last BodyTube the iterator walked past",
 * so a fin set mounted on a nose cone is marked on the PREVIOUS tube, at that
 * tube's circumference — a wrong guide rather than no guide. Here anything a
 * guide cannot carry comes back in `omitted` and the drawing names it, because
 * a part that silently vanishes from the guide is one that silently does not
 * get glued on.
 */
export function markingGuides(tree: RocketTree): MarkingGuideSet {
  const guides: MarkingGuide[] = [];
  const omitted: OmittedPart[] = [];

  const visit = (node: ComponentNode): void => {
    const kids = node.children ?? [];
    const angular = kids.filter((c) => isAngular(String(c.type)));
    if (angular.length) {
      const reason: OmitReason | null =
        node.type !== 'bodytube' ? 'noWrap' : angular.some((c) => isFinSet(String(c.type))) ? null : 'noFins';
      if (reason === null) guides.push(buildGuide(node, angular));
      else for (const c of angular) omitted.push({ name: String(c.name ?? ''), type: String(c.type), reason });
    }
    for (const c of kids) visit(c);
  };
  for (const stage of tree.components) visit(stage);

  return { guides, omitted };
}

import type { ComponentNode, RocketTree, StaticInfo } from '../../engine/openRocketEngine';
import { num, numOpt } from '../../tree/nodeProps';
import { axialLength, axialStart } from '../../tree/position.js';
import { finSpan } from '../../tree/finPlanform.js';
import { outerProfile } from '../../tree/shapeProfile.js';
import { tubeFinRadius } from '../../tree/tubefins.js';
import { assemblyBoundingRadius, isAssembly, resolveAssemblyRadius } from '../../tree/assembly.js';
import type { StabilityState } from '../../services/simReport.js';

export interface Ctx {
  scale: number;
  cy: number;
  x0: number;
}

/** Height (viewBox px) reserved on the top & bottom for the length rulers.
 *  Sized so the edge-pinned number labels clear the (12px) major tick tips with
 *  a ~5px gap, rather than the ticks running up into the numbers. */
export const RULER_H = 32;
/** Width (viewBox px) reserved on the left & right for the radial rulers. */
export const RULER_W = 46;

export const MARKER_R = 9;
/** Total viewBox px of height reserved for the two callout lanes (S2). */
export const CALLOUT_LANES = 34;
/** Lane-center distance from the airframe edge (or marker edge, if wider). */
const LANE_GAP = 13;

/** A "nice" ruler tick step (meters) giving ~8 marks across `totalM`. */
/**
 * A nice RULER graduation for a drawing that spans `totalM`.
 *
 * Divides by 8 before rounding and has a 2.5 rung, unlike
 * `prefs/units.niceStep`, which rounds its argument directly on a 1-2-5
 * ladder. Renamed from `niceStep` because the two were indistinguishable at
 * an import site and are not interchangeable.
 */
export function niceRulerStep(totalM: number): number {
  const target = Math.max(totalM, 1e-6) / 8;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  for (const c of [1, 2, 2.5, 5, 10]) if (c * pow >= target) return c * pow;
  return 10 * pow;
}

/** Snap `raw` to the nearest value in `snaps` within `eps`, else return `raw`. */
export function snapNear(raw: number, snaps: number[], eps: number): number {
  let best = eps,
    out = raw;
  for (const s of snaps) {
    const d = Math.abs(s - raw);
    if (d < best) {
      best = d;
      out = s;
    }
  }
  return out;
}
/** CP label footprint in the lower lane, relative to cpX: dot (r 4) plus
 *  the "CP" text to its right — the margin text must not land on it. */
const CP_LABEL_L = 6;
// Wide enough for "CP · 22.4 cm" (was 27 for a bare "CP") so the margin text
// is nudged clear of the longer label.
const CP_LABEL_R = 92;
/** Rough half-width of the margin text (13 px bold ≈ 7.2 px per char). */
const marginHalfW = (text: string) => (text.length * 7.2) / 2;

export interface CalloutLayout {
  cg: { x: number; leaderY1: number; leaderY2: number } | null;
  cp: { x: number; leaderY1: number; leaderY2: number } | null;
  margin: { x: number; y: number } | null;
}

/**
 * Leader-line callout geometry (S2): dashed leaders run from the centerline
 * markers to labeled dots in clear lanes above (CG) and below (CP) the drawn
 * airframe; the margin text sits in the LOWER lane midway between the two —
 * the upper-right corner belongs to the export/zoom control strip, which the
 * text collided with the moment the canvas became the hero (batch 08-21c) —
 * clamped inside the viewBox and nudged off the CP label when they'd collide
 * (leftward as the fallback when the right side has no room).
 *
 * @param halfPx drawn vertical half-extent (viewBox px) = vHalf * scale
 */
export function calloutLayout(
  cgX: number | null,
  cpX: number | null,
  cy: number,
  halfPx: number,
  w: number,
  h: number,
  marginText: string | null,
): CalloutLayout {
  const laneTop = Math.max(10, cy - Math.max(halfPx, MARKER_R) - LANE_GAP);
  const laneBottom = Math.min(h - 10, cy + Math.max(halfPx, MARKER_R) + LANE_GAP);
  const cg = cgX === null ? null : { x: cgX, leaderY1: cy - MARKER_R, leaderY2: laneTop };
  const cp = cpX === null ? null : { x: cpX, leaderY1: cy + MARKER_R, leaderY2: laneBottom };
  let margin: { x: number; y: number } | null = null;
  if (marginText !== null && cgX !== null && cpX !== null) {
    const halfW = marginHalfW(marginText);
    const clamp = (x: number) => Math.min(w - halfW - 2, Math.max(halfW + 2, x));
    const collides = (x: number) => x + halfW > cpX - CP_LABEL_L && x - halfW < cpX + CP_LABEL_R;
    let x = clamp((cgX + cpX) / 2);
    if (collides(x)) {
      const right = clamp(cpX + CP_LABEL_R + halfW);
      x = collides(right) ? clamp(cpX - CP_LABEL_L - halfW) : right;
    }
    margin = { x, y: laneBottom };
  }
  return { cg, cp, margin };
}

/** Tab front edge from the fin's leading edge (AxialMethod.getAsPosition). */
export function finTabFront(n: ComponentNode, finLen: number): number {
  const offset = num(n, 'tabOffset', 0);
  const tabLen = num(n, 'tabLength', 0);
  const method = typeof n['tabOffsetMethod'] === 'string' ? (n['tabOffsetMethod'] as string) : 'middle';
  if (method === 'top') return offset;
  if (method === 'bottom') return offset + (finLen - tabLen);
  return offset + (finLen - tabLen) / 2;
}

// One implementation, in the tree layer. This file carried its own copy
// (and Rocket3D a third, which disagreed on `absolute`); the canvas re-exports
// so its importers keep working.
export { axialStart };

export function collect<T>(nodes: ComponentNode[], f: (n: ComponentNode) => T): T[] {
  const out: T[] = [];
  const walk = (ns: ComponentNode[]) => {
    for (const n of ns) {
      out.push(f(n));
      walk(n.children ?? []);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Closed side-view outline of a nose cone (foreR = 0) or transition, sampled
 * from the kernel-exact profile: top edge fore→aft, aft edge down, bottom
 * edge aft→fore, Z closes the fore edge.
 */
export function profilePath(
  ctx: Ctx,
  n: ComponentNode,
  x: number,
  len: number,
  foreR: number,
  aftR: number,
  baseY: number,
): string {
  const shape = typeof n['shape'] === 'string' ? (n['shape'] as string) : n.type === 'transition' ? 'conical' : 'ogive';
  const param = numOpt(n, 'shapeParameter');
  // node['clipped'] (.ork <shapeclipped>) rides along so an unclipped
  // transition draws the way it simulates; absent = kernel default (clipped).
  const pts = outerProfile(
    shape,
    param,
    len,
    foreR,
    aftR,
    24,
    undefined,
    typeof n['clipped'] === 'boolean' ? (n['clipped'] as boolean) : undefined,
  );
  const px = (xi: number) => ctx.x0 + (x + xi) * ctx.scale;
  const top = pts.map(([xi, r]) => `${px(xi)} ${baseY - r * ctx.scale}`);
  const bottom = pts
    .slice()
    .reverse()
    .map(([xi, r]) => `${px(xi)} ${baseY + r * ctx.scale}`);
  return `M ${top.join(' L ')} L ${bottom.join(' L ')} Z`;
}

/**
 * Pure geometry derived from the tree, info and container size, so the
 * frequently-changing state (hover, zoom, calipers, roll) no longer
 * recomputes the whole layout on every render.
 */
export function computeSchematicLayout(
  tree: RocketTree,
  info: StaticInfo | null,
  dims: {
    vertical?: boolean;
    chPx: number;
    cw: number;
    maxHeight: number;
    fillHeight?: boolean;
    /** Which sides carry a ruler; each present side reserves a lane. Absent = all. */
    rulers?: { top: boolean; bottom: boolean; left: boolean; right: boolean };
  },
): {
  chain: ComponentNode[];
  totalLen: number;
  maxR: number;
  vHalf: number;
  snapXs: number[];
  radialSnaps: number[];
  /** Reserved ruler-lane thickness (viewBox px) per side; 0 when that side is off. */
  rTop: number;
  rBot: number;
  rLeft: number;
  rRight: number;
  w: number;
  h: number;
  scale: number;
  ctx: Ctx;
} {
  const { vertical, chPx, cw, maxHeight, fillHeight } = dims;
  // Stages flatten into one nose-to-tail chain (sustainer first, boosters
  // after — the desktop's stacking order); legacy flat trees pass through.
  const chain = tree.components.flatMap((n) => (n.type === 'stage' ? (n.children ?? []) : [n]));
  let totalLen = 0;
  let maxR = 0.001;
  for (const n of chain) {
    if (n.type === 'nosecone' || n.type === 'bodytube' || n.type === 'transition') {
      totalLen += num(n, 'length', 0);
      maxR = Math.max(maxR, num(n, 'aftRadius', 0), num(n, 'outerRadius', 0), num(n, 'foreRadius', 0));
    }
  }
  // A fin set's vertical span: freeform fins carry no 'height' key — their
  // reach is the outline's y-max (the 0.03 default clipped tall freeform fins
  // out of the adaptive-height frame).
  const spanOf = (n: ComponentNode, bodyR: number): number => {
    if (!n.type.endsWith('finset')) return 0;
    // Tube fins reach one tube diameter above the body surface; every planar
    // fin defers to the shared span (tree/finPlanform.ts) so this view cannot
    // drift from the exports about how tall a fin is.
    if (n.type === 'tubefinset') return 2 * tubeFinRadius(n, bodyR);
    return finSpan(n);
  };
  /**
   * Fin spans under `nodes`, each measured against the radius of the body it is
   * actually ATTACHED to, narrowing as the walk descends.
   *
   * Only tube fins care, and they care a lot: carrying no explicit outerRadius
   * they auto-size to the body they ring (tubefins.ts `tubeFinRadius`), so the
   * radius handed in decides the answer. A plain `collect` over the tree
   * measured every one of them against the WHOLE rocket's largest radius —
   * tube fins on a 25 mm aft tube behind a 60 mm forward section claimed 2.4×
   * the vertical reach they need, and the entire schematic shrank to leave room
   * for space they never used.
   */
  const collectFinSpans = (nodes: ComponentNode[], bodyR: number): number[] => {
    const out: number[] = [];
    const walk = (ns: ComponentNode[], r: number) => {
      for (const n of ns) {
        out.push(spanOf(n, r));
        if (n.children?.length) {
          const own = Math.max(num(n, 'aftRadius', 0), num(n, 'outerRadius', 0), num(n, 'foreRadius', 0));
          walk(n.children, own > 0 ? own : r);
        }
      }
    };
    walk(nodes, bodyR);
    return out;
  };

  const protuberanceSpan = (n: ComponentNode): number => (n.type === 'fairing' ? num(n, 'height', 0.02) : 0);
  const finH = Math.max(0, ...collectFinSpans(tree.components, maxR), ...collect(tree.components, protuberanceSpan));
  totalLen = Math.max(totalLen, 0.05);

  // Vertical half-extent (m): the core body + fins, plus any off-axis pod's
  // reach (its centerline radius + its own body + its fins) so pods don't clip.
  let vHalf = maxR + finH;
  const scanRadial = (nodes: ComponentNode[], parentR: number) => {
    for (const n of nodes) {
      if (isAssembly(n.type)) {
        const podFin = Math.max(0, ...collectFinSpans(n.children ?? [], assemblyBoundingRadius(n)));
        vHalf = Math.max(vHalf, resolveAssemblyRadius(n, parentR) + assemblyBoundingRadius(n) + podFin);
        scanRadial(n.children ?? [], assemblyBoundingRadius(n));
      } else {
        const r = Math.max(num(n, 'aftRadius', 0), num(n, 'outerRadius', 0), num(n, 'foreRadius', 0)) || parentR;
        scanRadial(n.children ?? [], r);
      }
    }
  };
  scanRadial(chain, maxR);

  // Caliper snap targets: axial component + child edges (horizontal), and radial
  // magnitudes — each component's radius, the body, the full span (vertical).
  const snapXs: number[] = [];
  const radialSet = new Set<number>([0, maxR, vHalf]);
  {
    let cx = 0;
    for (const n of chain) {
      if (n.type === 'nosecone' || n.type === 'bodytube' || n.type === 'transition') {
        const len = num(n, 'length', 0);
        snapXs.push(cx, cx + len);
        for (const child of n.children ?? []) {
          const clen = axialLength(child);
          if (clen > 0) {
            const cs = axialStart(child, clen, cx, len);
            snapXs.push(cs, cs + clen);
          }
        }
        const r = Math.max(num(n, 'aftRadius', 0), num(n, 'outerRadius', 0), num(n, 'foreRadius', 0));
        if (r > 0) radialSet.add(r);
        cx += len;
      }
    }
  }
  const radialSnaps = [...radialSet];

  // Vertical mode swaps the container roles BEFORE layout: all layout math
  // stays horizontal (length along x) and the finished drawing rotates
  // nose-up as one group, so the length axis fits the container HEIGHT and
  // the cross extent its width.
  const w = Math.max(320, vertical ? chPx : cw);
  const pad = 26;
  // Height follows the rocket's own proportions (clamped): a long thin
  // rocket gets a wide low band, not a fixed frame of empty sky. When info
  // is present the CG/CP callout lanes need sky of their own, so their
  // allowance is added to the height AND kept out of the vertical fit —
  // otherwise a height-limited short/fat rocket would fill it and clip them.
  const lanes = info ? CALLOUT_LANES : 0;
  // Side view reserves a ruler lane per requested side (length top/bottom, radial
  // left/right); each kept out of the fit so the drawing centers inside the frame.
  // A side that's toggled off reserves nothing, so the drawing reclaims that space.
  const R = dims.rulers ?? { top: true, bottom: true, left: true, right: true };
  const rTop = vertical || !R.top ? 0 : RULER_H;
  const rBot = vertical || !R.bottom ? 0 : RULER_H;
  const rLeft = vertical || !R.left ? 0 : RULER_W;
  const rRight = vertical || !R.right ? 0 : RULER_W;
  const crossCap = vertical ? Math.max(160, cw) : maxHeight;
  const h =
    vertical || !fillHeight
      ? Math.round(
          Math.min(
            crossCap,
            Math.max(200, 2 * vHalf * ((w - 2 * pad - rLeft - rRight) / totalLen) + 2 * pad + lanes + rTop + rBot),
          ),
        )
      : Math.max(200, chPx);
  // Horizontal headroom: `totalLen` covers only the axial chain (nose+body), so
  // aft-swept fins overhang past it and the CG/CP labels reach right of the aft.
  // Fit to ~12% more than the bare length so nothing sits flush to the edge, and
  // center the drawing between the left/right ruler lanes.
  const scale = Math.min(
    (w - 2 * pad - rLeft - rRight) / (totalLen * 1.12),
    (h - 2 * pad - lanes - rTop - rBot) / (2 * vHalf),
  );
  // Center the rocket between the left/right ruler lanes, and vertically between
  // the top/bottom ones — the centerline shifts by half the top/bottom imbalance
  // so an asymmetric set of rulers still frames the drawing evenly.
  const x0 = Math.max(pad + rLeft, (w - totalLen * scale) / 2);
  const ctx: Ctx = { scale, cy: (h + rTop - rBot) / 2, x0 };
  return { chain, totalLen, maxR, vHalf, snapXs, radialSnaps, rTop, rBot, rLeft, rRight, w, h, scale, ctx };
}

/**
 * A component's own `color` override, else the caller's default. The 2D side
 * view, the aft view and the 3D builder each carried a private copy of this
 * one-liner; one definition means one place for the override rule to change.
 */
export const colorOf = (n: ComponentNode, dflt: string): string =>
  typeof n['color'] === 'string' ? (n['color'] as string) : dflt;

/** Loaded motor case dimensions (m) keyed by mount node id. The one shape every
 *  view takes; Rocket3D re-exports it for the store's import site. */
export type MotorDims = Record<string, { length: number; diameter: number; label?: string }>;

/** Same tiered glyphs for the stability verdict wherever a view prints one:
 *  warning sign (under), triangle (over), check mark (ok). */
export const STABILITY_GLYPH: Record<StabilityState, string> = {
  under: '⚠',
  over: '△',
  ok: '✓',
};

/** View transform of a zoomable SVG drawing: scale `k` about the origin, then
 *  translate by (x, y), all in viewBox units. Identity = whole drawing fits. */
export interface ZoomState {
  k: number;
  x: number;
  y: number;
}

export const ZOOM_IDENTITY: ZoomState = { k: 1, x: 0, y: 0 };

/**
 * Rescale a view to `k` keeping the drawing point under (px, py) fixed on
 * screen; snaps back to identity at k = 1 so a fully zoomed-out view is also
 * un-panned. Returns the same object when nothing changes so a state setter
 * can bail out.
 */
export function zoomAbout(z: ZoomState, px: number, py: number, k: number): ZoomState {
  if (k === z.k) return z;
  if (k === 1) return ZOOM_IDENTITY;
  const mx = (px - z.x) / z.k;
  const my = (py - z.y) / z.k;
  return { k, x: px - mx * k, y: py - my * k };
}

/** Drawn extent (layout px) of one component, unioned across its instances. */
export interface HoverBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const unionBox = (a: HoverBox, b: HoverBox): HoverBox => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

/**
 * Where the hover name tag sits for a hovered box: centered over it, clamped
 * inside the viewBox, above the component unless that leaves the viewBox and
 * then below. Pure so the hover decoration can be derived per render from a
 * memoized extent map instead of rebuilding the whole scene per hover.
 */
export function hoverTagFor(box: HoverBox, name: string, w: number, h: number): { x: number; y: number; tw: number } {
  const tw = name.length * 6.2 + 14;
  return {
    x: Math.min(w - tw / 2 - 2, Math.max(tw / 2 + 2, (box.x0 + box.x1) / 2)),
    y: box.y0 - 22 >= 2 ? box.y0 - 13 : Math.min(h - 11, box.y1 + 13),
    tw,
  };
}

/** The four graduation arrays a TreeSchematic ruler frame draws. */
export interface RulerGraduations {
  /** Labeled majors along the length rulers, model meters from the nose. */
  rulerMarks: number[];
  /** Labeled majors along the radial rulers: viewBox y plus the label (meters). */
  vTicks: { y: number; label: number }[];
  /** Minor subdivisions of the above (5 per major), model meters. */
  rulerMinorMarks: number[];
  vMinorTicks: number[];
}

/**
 * The ruler graduations: labeled majors every `rulerStep` meters across the
 * viewport, plus minor subdivisions at a fifth of that. Pure so the schematic
 * can memoize it on primitives; `x0` is the datum (model 0) in viewBox px,
 * `rulerX0..rulerX1` the length baseline's extent, `vTop` and `vSpanM` the
 * radial ruler's start (viewBox px) and length (meters).
 */
export function rulerGraduations({
  showLen,
  showRad,
  rulerStep,
  rulerX0,
  rulerX1,
  x0,
  scale,
  vSpanM,
  vTop,
}: {
  showLen: boolean;
  showRad: boolean;
  rulerStep: number;
  rulerX0: number;
  rulerX1: number;
  x0: number;
  scale: number;
  vSpanM: number;
  vTop: number;
}): RulerGraduations {
  const marks: number[] = [];
  if (showLen) {
    const mLo = Math.ceil((rulerX0 - x0) / scale / rulerStep - 1e-6) * rulerStep;
    const mHi = (rulerX1 - x0) / scale;
    for (let m = mLo; m <= mHi + 1e-6; m += rulerStep) marks.push(m);
  }
  const ticks: { y: number; label: number }[] = [];
  if (showRad) for (let m = 0; m <= vSpanM + 1e-6; m += rulerStep) ticks.push({ y: vTop + m * scale, label: m });
  // Minor subdivisions: 10 per labeled major, plus a taller "medium" tick at
  // the half-major, for a properly graduated ruler.
  const minorMarks: number[] = [];
  const minorTicks: number[] = [];
  if (showLen) {
    const minorX = rulerStep / 5;
    const mLo = Math.ceil((rulerX0 - x0) / scale / minorX - 1e-6) * minorX;
    const mHi = (rulerX1 - x0) / scale;
    for (let m = mLo; m <= mHi + 1e-6; m += minorX) minorMarks.push(m);
  }
  if (showRad) {
    const minorV = rulerStep / 5;
    for (let m = 0; m <= vSpanM + 1e-6; m += minorV) minorTicks.push(m);
  }
  return { rulerMarks: marks, vTicks: ticks, rulerMinorMarks: minorMarks, vMinorTicks: minorTicks };
}

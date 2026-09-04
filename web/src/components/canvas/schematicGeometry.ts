import type { ComponentNode, ComponentPosition } from '../../engine/openRocketEngine';
import { num, numOpt } from '../../tree/nodeProps';
import { startFromPosition } from '../../tree/position.js';
import { outerProfile } from '../../tree/shapeProfile.js';

export interface Ctx {
  scale: number;
  cy: number;
  x0: number;
}

export const MARKER_R = 9;
/** Total viewBox px of height reserved for the two callout lanes (S2). */
export const CALLOUT_LANES = 34;
/** Lane-center distance from the airframe edge (or marker edge, if wider). */
const LANE_GAP = 13;

/** A "nice" ruler tick step (metres) giving ~8 marks across `totalM`. */
export function niceStep(totalM: number): number {
  const target = Math.max(totalM, 1e-6) / 8;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  for (const c of [1, 2, 2.5, 5, 10]) if (c * pow >= target) return c * pow;
  return 10 * pow;
}

/** Snap `raw` to the nearest value in `snaps` within `eps`, else return `raw`. */
export function snapNear(raw: number, snaps: number[], eps: number): number {
  let best = eps, out = raw;
  for (const s of snaps) { const d = Math.abs(s - raw); if (d < best) { best = d; out = s; } }
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
  cgX: number | null, cpX: number | null,
  cy: number, halfPx: number, w: number, h: number,
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

export function axialStart(child: ComponentNode, childLen: number, pStart: number, pLen: number): number {
  const pos = (child.position ?? { method: 'top', offset: 0 }) as ComponentPosition;
  return pStart + startFromPosition(pos, childLen, pLen);
}

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
  ctx: Ctx, n: ComponentNode, x: number, len: number,
  foreR: number, aftR: number, baseY: number,
): string {
  const shape = typeof n['shape'] === 'string' ? (n['shape'] as string)
    : n.type === 'transition' ? 'conical' : 'ogive';
  const param = numOpt(n, 'shapeParameter');
  // node['clipped'] (.ork <shapeclipped>) rides along so an unclipped
  // transition draws the way it simulates; absent = kernel default (clipped).
  const pts = outerProfile(shape, param, len, foreR, aftR, 24, undefined,
    typeof n['clipped'] === 'boolean' ? (n['clipped'] as boolean) : undefined);
  const px = (xi: number) => ctx.x0 + (x + xi) * ctx.scale;
  const top = pts.map(([xi, r]) => `${px(xi)} ${baseY - r * ctx.scale}`);
  const bottom = pts.slice().reverse().map(([xi, r]) => `${px(xi)} ${baseY + r * ctx.scale}`);
  return `M ${top.join(' L ')} L ${bottom.join(' L ')} Z`;
}

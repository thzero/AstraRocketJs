import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import { num, numOpt } from '../tree/nodeProps';
import { outerProfile } from '../tree/shapeProfile';
import { finTabFront, axialStart } from '../components/canvas/schematicGeometry';

/**
 * Geometry for the PDF report — all in MILLIMETRES, so the PDF (built in mm)
 * can draw templates at true 1:1 and the side view to scale. Vector only.
 */

export type Pt = [number, number];
const M_TO_MM = 1000;

/** A fin's planform outline (mm), root along the bottom, tab folded in below. */
export function finPlanformMm(node: ComponentNode): { pts: Pt[]; count: number } | null {
  const ff = node.type === 'freeformfinset' ? ((node['points'] as [number, number][] | undefined) ?? []) : [];
  const root = node.type === 'freeformfinset' && ff.length ? Math.max(...ff.map((p) => p[0])) : num(node, 'rootChord', 0.05);
  const height = node.type === 'freeformfinset' && ff.length ? Math.max(...ff.map((p) => p[1])) : num(node, 'height', 0.03);
  let top: Pt[];
  if (node.type === 'freeformfinset') {
    const raw = ff.length ? ff : ([[0, 0], [0.02, 0.03], [0.05, 0]] as [number, number][]);
    top = raw.map(([x, y]) => [x * M_TO_MM, height * M_TO_MM - y * M_TO_MM]);
  } else if (node.type === 'ellipticalfinset') {
    top = [];
    const N = 40;
    for (let i = 0; i <= N; i++) top.push([root * (i / N) * M_TO_MM, height * M_TO_MM - height * Math.sin(Math.PI * (i / N)) * M_TO_MM]);
  } else {
    const tip = num(node, 'tipChord', 0.03);
    const sweep = num(node, 'sweep', 0.02);
    top = [[0, height * M_TO_MM], [sweep * M_TO_MM, 0], [(sweep + tip) * M_TO_MM, 0], [root * M_TO_MM, height * M_TO_MM]];
  }
  const tabH = num(node, 'tabHeight', 0);
  const tabLen = num(node, 'tabLength', 0);
  const pts = [...top];
  if (tabH > 0 && tabLen > 0) {
    const x0 = Math.max(0, Math.min(root, finTabFront(node, root)));
    const x1 = Math.max(0, Math.min(root, x0 + tabLen));
    const baseY = height * M_TO_MM;
    pts.push([x1 * M_TO_MM, baseY], [x1 * M_TO_MM, baseY + tabH * M_TO_MM], [x0 * M_TO_MM, baseY + tabH * M_TO_MM], [x0 * M_TO_MM, baseY]);
  }
  return { pts, count: Math.max(1, Math.round(num(node, 'finCount', 3))) };
}

/** A revolved part's side outline (mm), centred on its own centreline. */
export function profileMm(node: ComponentNode, foreR: number, aftR: number, shapeDefault: string): { w: number; h: number; pts: Pt[] } | null {
  const len = num(node, 'length', 0);
  if (len <= 0) return null;
  const shape = typeof node['shape'] === 'string' ? (node['shape'] as string) : shapeDefault;
  const clipped = typeof node['clipped'] === 'boolean' ? (node['clipped'] as boolean) : undefined;
  const prof = outerProfile(shape, numOpt(node, 'shapeParameter'), len, foreR, aftR, 80, undefined, clipped);
  const maxR = Math.max(...prof.map(([, r]) => r), aftR, foreR);
  const h = maxR * 2 * M_TO_MM;
  const cy = h / 2;
  const top: Pt[] = prof.map(([x, r]) => [x * M_TO_MM, cy - r * M_TO_MM]);
  const bot: Pt[] = [...prof].reverse().map(([x, r]) => [x * M_TO_MM, cy + r * M_TO_MM]);
  return { w: len * M_TO_MM, h, pts: [...top, ...bot] };
}

/**
 * Whole-rocket side view (mm) about the centreline (y = 0, +up): one closed
 * airframe silhouette (nose → body → transition, top edge then mirrored bottom)
 * plus a filled fin polygon on the top and bottom of each fin set. Filled, so
 * it reads as a solid rocket rather than loose lines.
 */
export function rocketSideView(tree: RocketTree): { w: number; h: number; body: Pt[]; fins: Pt[][] } {
  const chain = tree.components.flatMap((n) => (n.type === 'stage' ? (n.children ?? []) : [n]));
  const topEdge: Pt[] = []; // forward → aft, y = +radius (mm)
  const fins: Pt[][] = [];
  let maxR = 0.001, maxUp = 0.001, x = 0;

  const addFins = (node: ComponentNode, pStart: number, pLen: number, R: number) => {
    const ff = node.type === 'freeformfinset' ? ((node['points'] as [number, number][] | undefined) ?? []) : [];
    const root = node.type === 'freeformfinset' && ff.length ? Math.max(...ff.map((p) => p[0])) : num(node, 'rootChord', 0.05);
    const height = node.type === 'freeformfinset' && ff.length ? Math.max(...ff.map((p) => p[1])) : num(node, 'height', 0.03);
    const start = axialStart(node, root, pStart, pLen);
    let plan: Pt[];
    if (node.type === 'trapezoidfinset') {
      const tip = num(node, 'tipChord', 0.03), sweep = num(node, 'sweep', 0.02);
      plan = [[start, R], [start + sweep, R + height], [start + sweep + tip, R + height], [start + root, R]];
    } else if (node.type === 'freeformfinset' && ff.length) {
      plan = ff.map(([px, py]) => [start + px, R + py] as Pt);
    } else if (node.type === 'ellipticalfinset') {
      // A true half-ellipse (height·sin(π·t)), matching finPlanformMm's template
      // and oneFinSolid's 3D — not the old crude 4-point trapezoid.
      plan = [];
      const N = 40;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        plan.push([start + root * t, R + height * Math.sin(Math.PI * t)]);
      }
    } else {
      plan = [[start, R], [start + root * 0.15, R + height], [start + root * 0.7, R + height], [start + root, R]];
    }
    fins.push(plan.map(([px, py]) => [px * M_TO_MM, py * M_TO_MM]));
    fins.push(plan.map(([px, py]) => [px * M_TO_MM, -py * M_TO_MM])); // mirror below
    maxUp = Math.max(maxUp, R + height);
  };

  const revolveTop = (node: ComponentNode, foreR: number, aftR: number, shapeDefault: string, len: number) => {
    const shape = typeof node['shape'] === 'string' ? (node['shape'] as string) : shapeDefault;
    const clipped = typeof node['clipped'] === 'boolean' ? (node['clipped'] as boolean) : undefined;
    for (const [px, r] of outerProfile(shape, numOpt(node, 'shapeParameter'), len, foreR, aftR, 60, undefined, clipped)) {
      topEdge.push([(x + px) * M_TO_MM, r * M_TO_MM]);
      maxR = Math.max(maxR, r);
    }
  };

  for (const n of chain) {
    const len = num(n, 'length', 0);
    if (n.type === 'nosecone') {
      const R = num(n, 'aftRadius', 0.012);
      revolveTop(n, 0, R, 'ogive', len);
      for (const c of n.children ?? []) if (String(c.type).endsWith('finset')) addFins(c, x, len, R);
      x += len;
    } else if (n.type === 'bodytube') {
      const R = num(n, 'outerRadius', 0.012);
      topEdge.push([x * M_TO_MM, R * M_TO_MM], [(x + len) * M_TO_MM, R * M_TO_MM]);
      maxR = Math.max(maxR, R);
      for (const c of n.children ?? []) if (String(c.type).endsWith('finset')) addFins(c, x, len, R);
      x += len;
    } else if (n.type === 'transition') {
      revolveTop(n, num(n, 'foreRadius', 0.012), num(n, 'aftRadius', 0.009), 'conical', len);
      x += len;
    }
  }
  // Close the silhouette: top edge forward→aft, then the mirrored bottom aft→forward.
  const body: Pt[] = [...topEdge, ...[...topEdge].reverse().map(([px, py]) => [px, -py] as Pt)];
  maxUp = Math.max(maxUp, maxR);
  return { w: x * M_TO_MM, h: 2 * maxUp * M_TO_MM, body, fins };
}

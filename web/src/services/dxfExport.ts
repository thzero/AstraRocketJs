import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import { num } from '../tree/nodeProps';
import { finTabFront } from '../components/canvas/schematicGeometry';

/**
 * DXF export — the 2D CNC/laser boundary for a rocket's FLAT, plate-cut parts:
 * fins (with any through-the-wall tab folded into the outline), centering
 * rings, bulkheads, couplers and engine blocks. Nose cones and body tubes are
 * not plate parts and are not offered — that is what the STL/OBJ/GLB export is
 * for.
 *
 * Format is AutoCAD R12 (AC1009) ASCII, the maximum-compatibility target that
 * LightBurn, Carbide Create, Easel and Fusion 360's DXF sketch import all read.
 * Units are millimetres (`$INSUNITS = 4`); the metres→mm conversion lives only
 * in the writer. Geometry sits on a CUT layer; centre cross-hairs and root-chord
 * marks sit on a REFERENCE layer the operator does not cut. Parts are laid out
 * left-to-right so none overlap, and `$EXTMIN`/`$EXTMAX` are written so "zoom
 * extents" frames the sheet.
 *
 * DXF Y grows upward, so a fin's span points up and its root sits on y = 0.
 */

export const DXF_MIME = 'image/vnd.dxf';

/**
 * Component types offered for DXF — flat, plate-cut parts only (fins, centring
 * rings, bulkheads). Tube couplers and engine blocks are tubes, not plate, so
 * they export as 3D solids (STL/OBJ/GLB) instead.
 */
export const DXF_CUTTABLE = new Set([
  'trapezoidfinset',
  'ellipticalfinset',
  'freeformfinset',
  'centeringring',
  'bulkhead',
]);

const M_TO_MM = 1000;
const EPS = 1e-6;
/** Used when a ring's outer radius can't be resolved from its parent tube. */
const FALLBACK_RADIUS = 0.012;
/** Centre cross-hair arm as a fraction of the outer radius. */
const CROSS_FRAC = 0.6;
const TEXT_H = 0.003;
const LABEL_GAP = 0.004;

type Layer = 'CUT' | 'REFERENCE' | 'TEXT';
interface Pt {
  x: number;
  y: number;
}
type Ent =
  | { kind: 'poly'; layer: Layer; pts: Pt[] }
  | { kind: 'circle'; layer: Layer; c: Pt; r: number }
  | { kind: 'line'; layer: Layer; a: Pt; b: Pt }
  | { kind: 'text'; layer: Layer; at: Pt; h: number; s: string };

interface Part {
  label: string;
  ents: Ent[];
}

// --- geometry (all in metres; the writer alone knows millimetres) ----------

/** Fold a through-the-wall tab into a fin's root edge as one closed contour. */
function withTab(top: Pt[], node: ComponentNode, rootChord: number, pRadius: number): Pt[] {
  const tabH = Math.min(num(node, 'tabHeight', 0), pRadius > 0 ? pRadius : Infinity);
  const tabLen = num(node, 'tabLength', 0);
  if (!(tabH > 0) || !(tabLen > 0)) return top;
  const x0 = Math.max(0, Math.min(rootChord, finTabFront(node, rootChord)));
  const x1 = Math.max(0, Math.min(rootChord, x0 + tabLen));
  if (x1 - x0 <= EPS) return top;
  // top ends at the trailing root corner (rootChord, 0); walk back along y = 0,
  // dip down for the tab, and return to the leading corner (0, 0).
  const loop = [...top, { x: x1, y: 0 }, { x: x1, y: -tabH }, { x: x0, y: -tabH }, { x: x0, y: 0 }];
  return dedupe(loop);
}

/** Drop consecutive duplicate points (degenerate zero-length edges break cutters). */
function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > EPS || Math.abs(last.y - p.y) > EPS) out.push(p);
  }
  // Also drop a closing duplicate (poly is implicitly closed).
  while (out.length > 1 && Math.abs(out[0].x - out[out.length - 1].x) <= EPS && Math.abs(out[0].y - out[out.length - 1].y) <= EPS) {
    out.pop();
  }
  return out;
}

/** The span-up planform (root on y = 0), before any tab is folded in. */
function finTopEdge(node: ComponentNode): Pt[] | null {
  if (node.type === 'freeformfinset') {
    const raw = node['points'];
    if (!Array.isArray(raw) || raw.length < 3) return null;
    const pts = raw.map((p) => ({ x: Number((p as number[])[0]) || 0, y: Number((p as number[])[1]) || 0 }));
    return pts;
  }
  const root = num(node, 'rootChord', 0.05);
  const height = num(node, 'height', 0.03);
  if (node.type === 'ellipticalfinset') {
    // Half-ellipse: centre (root/2, 0), semi-axes (root/2, height), theta pi..0.
    const N = 48;
    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const th = Math.PI * (1 - i / N);
      pts.push({ x: root / 2 + (root / 2) * Math.cos(th), y: height * Math.sin(th) });
    }
    return pts;
  }
  // Trapezoidal: sweep is a LENGTH offset of the leading tip corner.
  const tip = num(node, 'tipChord', root * 0.6);
  const sweep = num(node, 'sweep', 0.02);
  return [
    { x: 0, y: 0 },
    { x: sweep, y: height },
    { x: sweep + tip, y: height },
    { x: root, y: 0 },
  ];
}

function finPart(node: ComponentNode, pRadius: number): Part | null {
  const top = finTopEdge(node);
  if (!top) return null;
  const root = node.type === 'freeformfinset' ? Math.max(...top.map((p) => p.x)) : num(node, 'rootChord', 0.05);
  const outline = withTab(top, node, root, pRadius);
  if (outline.length < 3) return null;
  const ents: Ent[] = [{ kind: 'poly', layer: 'CUT', pts: outline }];
  // Root-chord reference mark on y = 0.
  ents.push({ kind: 'line', layer: 'REFERENCE', a: { x: 0, y: 0 }, b: { x: root, y: 0 } });
  const label =
    node.type === 'trapezoidfinset'
      ? 'Trapezoidal fin'
      : node.type === 'ellipticalfinset'
        ? 'Elliptical fin'
        : 'Freeform fin';
  const span = Math.max(...outline.map((p) => p.y));
  const count = Math.round(num(node, 'finCount', 3));
  const thickness = num(node, 'thickness', 0.003);
  const labels = [
    `${node.name || label}${count ? ` (cut ${count})` : ''}`,
    `root ${dim(root)} mm | span ${dim(span)} mm | stock ${dim(thickness)} mm`,
  ];
  return { label, ents: [...ents, ...textBlock(ents, labels)] };
}

function discPart(node: ComponentNode, outerR: number, boreR: number | null, label: string): Part {
  const ents: Ent[] = [{ kind: 'circle', layer: 'CUT', c: { x: 0, y: 0 }, r: outerR }];
  if (boreR !== null && boreR > EPS && boreR < outerR - EPS) {
    ents.push({ kind: 'circle', layer: 'CUT', c: { x: 0, y: 0 }, r: boreR });
  }
  const arm = outerR * CROSS_FRAC;
  ents.push(
    { kind: 'line', layer: 'REFERENCE', a: { x: -arm, y: 0 }, b: { x: arm, y: 0 } },
    { kind: 'line', layer: 'REFERENCE', a: { x: 0, y: -arm }, b: { x: 0, y: arm } },
  );
  const bore = boreR !== null && boreR > EPS && boreR < outerR - EPS ? ` | bore Ø${dim(boreR * 2)} mm` : '';
  const labels = [node.name || label, `Ø${dim(outerR * 2)} mm${bore}`];
  return { label, ents: [...ents, ...textBlock(ents, labels)] };
}

// --- tree walk: resolve each cuttable part against its enclosing tube -------

interface Tube {
  outerR: number;
  innerR: number;
}
function tubeRadii(node: ComponentNode): Tube | null {
  const t = node.type;
  if (t === 'bodytube' || t === 'innertube' || t === 'tubecoupler') {
    const or = num(node, 'outerRadius', NaN);
    if (!Number.isNaN(or)) return { outerR: or, innerR: Math.max(0, or - num(node, 'thickness', 0.001)) };
  } else if (t === 'nosecone') {
    const ar = num(node, 'aftRadius', NaN);
    if (!Number.isNaN(ar)) return { outerR: ar, innerR: Math.max(0, ar - num(node, 'thickness', 0.002)) };
  } else if (t === 'transition') {
    const or = Math.max(num(node, 'aftRadius', 0), num(node, 'foreRadius', 0));
    if (or > 0) return { outerR: or, innerR: Math.max(0, or - num(node, 'thickness', 0.002)) };
  }
  return null;
}

/** Outer radius of a plate part that fills its parent tube's bore. */
function plateOuter(node: ComponentNode, enclosing: Tube | null): number {
  const explicit = num(node, 'outerRadius', NaN);
  if (!Number.isNaN(explicit)) return explicit;
  if (enclosing && enclosing.innerR > 0) return enclosing.innerR;
  return FALLBACK_RADIUS;
}

/** The motor-mount bore a centering ring centres — an inner tube among siblings. */
function mountBore(siblings: ComponentNode[]): number | null {
  const mount = siblings.find((s) => s.type === 'innertube');
  if (!mount) return null;
  const or = num(mount, 'outerRadius', NaN);
  return Number.isNaN(or) ? null : or;
}

/** The flat cut part for one cuttable node, given its enclosing-tube context. */
function partForNode(node: ComponentNode, enclosing: Tube | null, siblings: ComponentNode[]): Part | null {
  switch (node.type) {
    case 'trapezoidfinset':
    case 'ellipticalfinset':
    case 'freeformfinset':
      return finPart(node, enclosing ? enclosing.innerR : 0);
    case 'bulkhead':
      return discPart(node, plateOuter(node, enclosing), null, 'Bulkhead');
    case 'centeringring': {
      const outer = plateOuter(node, enclosing);
      const bore = num(node, 'innerRadius', NaN);
      return discPart(node, outer, Number.isNaN(bore) ? mountBore(siblings) : bore, 'Centering ring');
    }
    // Tube couplers and engine blocks are tubes, not plate — they export as 3D
    // solids, not a DXF cut.
    default:
      return null;
  }
}

/** Locate a node plus the enclosing tube + siblings its cut part needs. */
function nodeContext(
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

// --- layout + R12 serialization --------------------------------------------

function bounds(ents: Ent[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  for (const e of ents) {
    if (e.kind === 'poly') for (const p of e.pts) add(p.x, p.y);
    else if (e.kind === 'circle') { add(e.c.x - e.r, e.c.y - e.r); add(e.c.x + e.r, e.c.y + e.r); }
    else if (e.kind === 'line') { add(e.a.x, e.a.y); add(e.b.x, e.b.y); }
    else { add(e.at.x, e.at.y - e.h); add(e.at.x + e.h * 0.7 * e.s.length, e.at.y + e.h); }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Stack label lines under a part's geometry, left-aligned. */
function textBlock(geom: Ent[], lines: string[]): Ent[] {
  const b = bounds(geom);
  return lines.map((s, i) => ({
    kind: 'text' as const,
    layer: 'TEXT' as const,
    at: { x: b.minX, y: b.minY - LABEL_GAP - (i + 1) * (TEXT_H * 1.6) },
    h: TEXT_H,
    s,
  }));
}

function translate(ents: Ent[], dx: number, dy: number): Ent[] {
  const t = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  return ents.map((e) =>
    e.kind === 'poly' ? { ...e, pts: e.pts.map(t) }
      : e.kind === 'circle' ? { ...e, c: t(e.c) }
        : e.kind === 'line' ? { ...e, a: t(e.a), b: t(e.b) }
          : { ...e, at: t(e.at) },
  );
}

/** R12 needs 7-bit ASCII on a single line for every text value. */
function ascii(s: string): string {
  return s
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/·/g, '-')
    .replace(/×/g, 'x')
    .replace(/Ø/g, 'dia ')
    .replace(/°/g, ' deg')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?')
    .trim();
}

const toMm = (m: number) => (m * M_TO_MM).toFixed(4);
const dim = (m: number) => (m * M_TO_MM).toFixed(1);

function serialize(ents: Ent[]): string {
  const out: string[] = [];
  const p = (code: number, val: string | number) => out.push(String(code), String(val));

  const b = bounds(ents);
  p(0, 'SECTION'); p(2, 'HEADER');
  p(9, '$ACADVER'); p(1, 'AC1009');
  p(9, '$INSUNITS'); p(70, 4); // 4 = millimetres
  p(9, '$EXTMIN'); p(10, toMm(b.minX)); p(20, toMm(b.minY));
  p(9, '$EXTMAX'); p(10, toMm(b.maxX)); p(20, toMm(b.maxY));
  p(0, 'ENDSEC');

  p(0, 'SECTION'); p(2, 'TABLES');
  p(0, 'TABLE'); p(2, 'LAYER'); p(70, 3);
  const layer = (name: string, aci: number) => {
    p(0, 'LAYER'); p(2, name); p(70, 0); p(62, aci); p(6, 'CONTINUOUS');
  };
  layer('CUT', 7); layer('REFERENCE', 5); layer('TEXT', 3);
  p(0, 'ENDTAB'); p(0, 'ENDSEC');

  p(0, 'SECTION'); p(2, 'ENTITIES');
  for (const e of ents) {
    if (e.kind === 'circle') {
      p(0, 'CIRCLE'); p(8, e.layer); p(10, toMm(e.c.x)); p(20, toMm(e.c.y)); p(40, toMm(e.r));
    } else if (e.kind === 'line') {
      p(0, 'LINE'); p(8, e.layer); p(10, toMm(e.a.x)); p(20, toMm(e.a.y)); p(11, toMm(e.b.x)); p(21, toMm(e.b.y));
    } else if (e.kind === 'text') {
      p(0, 'TEXT'); p(8, e.layer); p(10, toMm(e.at.x)); p(20, toMm(e.at.y)); p(40, toMm(e.h)); p(1, ascii(e.s));
    } else {
      p(0, 'POLYLINE'); p(8, e.layer); p(66, 1); p(70, 1); // 70 bit 1 = closed
      for (const v of e.pts) { p(0, 'VERTEX'); p(8, e.layer); p(10, toMm(v.x)); p(20, toMm(v.y)); }
      p(0, 'SEQEND');
    }
  }
  p(0, 'ENDSEC');
  p(0, 'EOF');
  return out.join('\n') + '\n';
}

/**
 * Resolved solid dimensions of a disc / ring / tube part (centring ring,
 * bulkhead, coupler, engine block), for its 3D mesh export — the same radius
 * resolution the DXF uses (explicit radii, else the parent tube's bore, else the
 * mount an inner tube provides). Returns null for any other type.
 */
export function resolveDisc(tree: RocketTree, nodeId: string): { outerR: number; innerR: number; length: number } | null {
  const ctx = nodeContext(tree, nodeId);
  if (!ctx) return null;
  const { node, enclosing, siblings } = ctx;
  const length = num(node, 'length', 0.003);
  const outerR = plateOuter(node, enclosing);
  if (node.type === 'bulkhead') return { outerR, innerR: 0, length };
  if (node.type === 'centeringring') {
    const bore = num(node, 'innerRadius', NaN);
    const innerR = Number.isNaN(bore) ? (mountBore(siblings) ?? 0) : bore;
    return { outerR, innerR, length };
  }
  if (node.type === 'tubecoupler' || node.type === 'engineblock') {
    const wall = num(node, 'thickness', node.type === 'engineblock' ? 0.00095 : 0.0005);
    return { outerR, innerR: Math.max(0, outerR - wall), length };
  }
  return null;
}

/**
 * DXF cut sheet for ONE component (fin, ring, bulkhead, coupler or engine
 * block), normalised to the origin. Returns null when the node isn't a flat
 * plate part or can't be found.
 */
export function componentToDxf(tree: RocketTree, nodeId: string): string | null {
  const ctx = nodeContext(tree, nodeId);
  if (!ctx) return null;
  const part = partForNode(ctx.node, ctx.enclosing, ctx.siblings);
  if (!part) return null;
  const b = bounds(part.ents);
  return serialize(translate(part.ents, -b.minX, -b.minY));
}

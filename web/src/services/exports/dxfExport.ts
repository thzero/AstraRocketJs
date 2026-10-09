import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { num } from '../../tree/nodeProps';
import { finCutContour, finRootChord } from '../../tree/finPlanform';
// Shared with the .ork reader and writer, so a part that lost a tag is cut at the
// size it was read and saved as.
import { COMPONENT_DEFAULTS } from '../design/componentDefaults';
// The enclosing-tube walk and the ring radius resolution live in their own
// module, shared with the 3D view and the 2D schematic: importing them from
// here would pull the R12 serializer into the first-paint bundle.
import { mountBore, nodeContext, plateOuter, type Tube } from '../design/discGeometry';

/**
 * DXF export: the 2D CNC/laser boundary for a rocket's flat, plate-cut parts:
 * fins (with any through-the-wall tab folded into the outline), centering
 * rings and bulkheads. Nose cones, body tubes, couplers and engine blocks are
 * not plate parts and are not offered; that is what the STL/OBJ/GLB export is
 * for.
 *
 * Format is AutoCAD R12 (AC1009) ASCII, the maximum-compatibility target that
 * LightBurn, Carbide Create, Easel and Fusion 360's DXF sketch import all read.
 * Units are millimeters (`$INSUNITS = 4`); the meters→mm conversion lives only
 * in the writer. Geometry sits on a CUT layer; center cross-hairs and root-chord
 * marks sit on a REFERENCE layer the operator does not cut. Parts are laid out
 * left-to-right so none overlap, and `$EXTMIN`/`$EXTMAX` are written so "zoom
 * extents" frames the sheet.
 *
 * DXF Y grows upward, so a fin's span points up and its root sits on y = 0.
 */

export const DXF_MIME = 'image/vnd.dxf';

// Imported, not redeclared: this is the unit constant for every dimensional
// export.
import { M_TO_MM } from '../../prefs/units';
const EPS = 1e-6;
/** Center cross-hair arm as a fraction of the outer radius. */
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

// --- geometry (all in meters; the writer alone knows millimeters) ----------

/** Drop consecutive duplicate points (degenerate zero-length edges break cutters). */
function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > EPS || Math.abs(last.y - p.y) > EPS) out.push(p);
  }
  // Also drop a closing duplicate (poly is implicitly closed).
  while (
    out.length > 1 &&
    Math.abs(out[0]!.x - out[out.length - 1]!.x) <= EPS &&
    Math.abs(out[0]!.y - out[out.length - 1]!.y) <= EPS
  ) {
    out.pop();
  }
  return out;
}

function finPart(node: ComponentNode, pRadius: number): Part | null {
  // Outline and tab both come from the one fin-geometry module
  // (tree/finPlanform.ts), so the DXF, the STL and the 1:1 PDF template are
  // guaranteed to be the same part. `root` in particular is the kernel's root
  // chord (last.x - first.x for a freeform), not the furthest-aft point: the
  // furthest-aft point would put the tab of an overhanging freeform fin up to
  // 20 mm out of place against the airframe slot.
  const contour = finCutContour(node, pRadius > 0 ? pRadius : null);
  if (!contour) return null;
  const root = finRootChord(node);
  const outline = dedupe(contour.map(([x, y]) => ({ x, y })));
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
  // `reduce`, not a spread: the .ork reader puts no cap on <finpoints><point>
  // count, and spreading a >100k-point freeform fin into Math.max dies with an
  // opaque "Maximum call stack size exceeded" instead of exporting.
  const span = outline.reduce((m, p) => (p.y > m ? p.y : m), -Infinity);
  const count = Math.round(num(node, 'finCount', COMPONENT_DEFAULTS.finset.finCount));
  const thickness = num(node, 'thickness', COMPONENT_DEFAULTS.finset.thickness);
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

/** The flat cut part for one cuttable node, given its enclosing-tube context. */
function partForNode(node: ComponentNode, enclosing: Tube | null, siblings: ComponentNode[]): Part | null {
  switch (node.type) {
    case 'trapezoidfinset':
    case 'ellipticalfinset':
    case 'freeformfinset':
      // The kernel clamps tab height to the parent's outer radius
      // (FinSet.getMaxTabHeight); the bore is not the limit a tab breaks through.
      return finPart(node, enclosing ? enclosing.outerR : 0);
    case 'bulkhead':
      return discPart(node, plateOuter(node, enclosing), null, 'Bulkhead');
    case 'centeringring': {
      const outer = plateOuter(node, enclosing);
      const bore = num(node, 'innerRadius', NaN);
      return discPart(node, outer, Number.isNaN(bore) ? mountBore(siblings) : bore, 'Centering ring');
    }
    // Tube couplers and engine blocks are tubes, not plate; they export as 3D
    // solids, not a DXF cut.
    default:
      return null;
  }
}

// --- layout + R12 serialization --------------------------------------------

function bounds(ents: Ent[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const e of ents) {
    if (e.kind === 'poly') for (const p of e.pts) add(p.x, p.y);
    else if (e.kind === 'circle') {
      add(e.c.x - e.r, e.c.y - e.r);
      add(e.c.x + e.r, e.c.y + e.r);
    } else if (e.kind === 'line') {
      add(e.a.x, e.a.y);
      add(e.b.x, e.b.y);
    } else {
      add(e.at.x, e.at.y - e.h);
      add(e.at.x + e.h * 0.7 * e.s.length, e.at.y + e.h);
    }
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
    e.kind === 'poly'
      ? { ...e, pts: e.pts.map(t) }
      : e.kind === 'circle'
        ? { ...e, c: t(e.c) }
        : e.kind === 'line'
          ? { ...e, a: t(e.a), b: t(e.b) }
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
  p(0, 'SECTION');
  p(2, 'HEADER');
  p(9, '$ACADVER');
  p(1, 'AC1009');
  p(9, '$INSUNITS');
  p(70, 4); // 4 = millimeters
  p(9, '$EXTMIN');
  p(10, toMm(b.minX));
  p(20, toMm(b.minY));
  p(9, '$EXTMAX');
  p(10, toMm(b.maxX));
  p(20, toMm(b.maxY));
  p(0, 'ENDSEC');

  p(0, 'SECTION');
  p(2, 'TABLES');
  p(0, 'TABLE');
  p(2, 'LAYER');
  p(70, 3);
  const layer = (name: string, aci: number) => {
    p(0, 'LAYER');
    p(2, name);
    p(70, 0);
    p(62, aci);
    p(6, 'CONTINUOUS');
  };
  layer('CUT', 7);
  layer('REFERENCE', 5);
  layer('TEXT', 3);
  p(0, 'ENDTAB');
  p(0, 'ENDSEC');

  p(0, 'SECTION');
  p(2, 'ENTITIES');
  for (const e of ents) {
    if (e.kind === 'circle') {
      p(0, 'CIRCLE');
      p(8, e.layer);
      p(10, toMm(e.c.x));
      p(20, toMm(e.c.y));
      p(40, toMm(e.r));
    } else if (e.kind === 'line') {
      p(0, 'LINE');
      p(8, e.layer);
      p(10, toMm(e.a.x));
      p(20, toMm(e.a.y));
      p(11, toMm(e.b.x));
      p(21, toMm(e.b.y));
    } else if (e.kind === 'text') {
      p(0, 'TEXT');
      p(8, e.layer);
      p(10, toMm(e.at.x));
      p(20, toMm(e.at.y));
      p(40, toMm(e.h));
      p(1, ascii(e.s));
    } else {
      p(0, 'POLYLINE');
      p(8, e.layer);
      p(66, 1);
      p(70, 1); // 70 bit 1 = closed
      for (const v of e.pts) {
        p(0, 'VERTEX');
        p(8, e.layer);
        p(10, toMm(v.x));
        p(20, toMm(v.y));
      }
      p(0, 'SEQEND');
    }
  }
  p(0, 'ENDSEC');
  p(0, 'EOF');
  return out.join('\n') + '\n';
}

/**
 * DXF cut sheet for one component (fin, centering ring or bulkhead),
 * normalized to the origin. Returns null when the node isn't a flat plate part
 * or can't be found.
 */
export function componentToDxf(tree: RocketTree, nodeId: string): string | null {
  const ctx = nodeContext(tree, nodeId);
  if (!ctx) return null;
  const part = partForNode(ctx.node, ctx.enclosing, ctx.siblings);
  if (!part) return null;
  const b = bounds(part.ents);
  return serialize(translate(part.ents, -b.minX, -b.minY));
}

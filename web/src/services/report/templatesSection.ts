import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { finPlanformMm, profileMm, type Pt } from './reportGeometry';
import { finMountOf } from '../../tree/finPlanform';
import { profileEnds } from '../../tree/shapeProfile';
import { num } from '../../tree/nodeProps';
import { KERNEL_DEFAULTS } from '../../tree/kernelDefaults';
import { fmtNum } from '../../i18n/format';
import { pageFrame, templateFits } from './layout';
import {
  drawText,
  ensure,
  fillPolygon,
  heading,
  paragraph,
  sectionBreak,
  setStyle,
  sub,
  writeRuler,
  type PdfPage,
} from './pdfPage';

/**
 * The 1:1 templates: the hint and the printed scale bar, then a cutting
 * outline for each selected fin set, nose cone and transition. A template
 * that does not fit the page is replaced by the `report.tooLarge` note,
 * never shrunk.
 */
export function writeTemplatesSection(
  p: PdfPage,
  tree: RocketTree,
  finSets: ComponentNode[],
  noses: ComponentNode[],
  transitions: ComponentNode[],
): void {
  const { t } = p;
  sectionBreak(p);
  heading(p, t('report.templates'));
  paragraph(p, t('report.templatesHint'));

  writeRuler(p);
  writeFinTemplates(p, tree, finSets);
  for (const n of noses) {
    const prof = profileMm(n, 0, num(n, 'aftRadius', KERNEL_DEFAULTS.nosecone.aftRadius));
    if (prof)
      template(p, (n.name as string) || t('report.noseCone'), prof.pts, { minX: 0, minY: 0, w: prof.w, h: prof.h });
  }
  for (const n of transitions) {
    const { fore, aft } = profileEnds(n);
    const prof = profileMm(n, fore, aft);
    if (prof)
      template(p, (n.name as string) || t('report.transition'), prof.pts, { minX: 0, minY: 0, w: prof.w, h: prof.h });
  }
}

function writeFinTemplates(p: PdfPage, tree: RocketTree, finSets: ComponentNode[]): void {
  for (const n of finSets) {
    // Pass where the fin stands so the printed template's root follows its
    // parent and its tab is clamped to the depth the kernel allows, matching
    // the DXF and the STL of the same fin. Without it a 20 mm tab on a 12 mm
    // body would print at full depth.
    const f = finPlanformMm(n, finMountOf(tree, String(n.id)));
    template(p, `${(n.name as string) || p.t('report.finSet')} × ${f.count}`, f.pts, outlineBox(f.pts));
  }
}

/** The box a template drawing occupies, in its own millimeters. */
interface TemplateBox {
  minX: number;
  minY: number;
  w: number;
  h: number;
}

/**
 * The bounds of a fin outline, on both sides of its origin. A forward-swept fin
 * puts its tip ahead of the root's leading edge (negative x), and a root along
 * a taper or a tab can reach past either end of the span, so neither edge of
 * the drawing is known to be zero.
 *
 * A loop, not `Math.max(...pts)`: a freeform outline is file-sourced and
 * spreading a huge one into a call overflows the stack.
 */
function outlineBox(pts: Pt[]): TemplateBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

function template(p: PdfPage, label: string, pts: Pt[], box: TemplateBox): void {
  const { t, M } = p;
  const { minX, minY, w, h } = box;
  const fits = templateFits(w, h, pageFrame(p.PW, p.PH));
  // The label (6 mm) and what it names break to a new page together, so a
  // label never sits at the foot of a page with its outline on the next.
  ensure(p, 6 + (fits ? h + 6 : 6));
  sub(p, label, 9);
  if (!fits) {
    setStyle(p, 'italic').setFontSize(8).setTextColor(120);
    drawText(p, t('report.tooLarge', { w: fmtNum(w, 0), h: fmtNum(h, 0) }), M, p.y + 3);
    p.y += 6;
    return;
  }
  // The drawing's left and top edges land on the margin and the cursor.
  fillPolygon(p, pts, M - minX, p.y - minY);
  p.y += h + 6;
}

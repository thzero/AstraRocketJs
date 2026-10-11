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
    if (prof) template(p, (n.name as string) || t('report.noseCone'), prof.pts, prof.w, prof.h);
  }
  for (const n of transitions) {
    const { fore, aft } = profileEnds(n);
    const prof = profileMm(n, fore, aft);
    if (prof) template(p, (n.name as string) || t('report.transition'), prof.pts, prof.w, prof.h);
  }
}

function writeFinTemplates(p: PdfPage, tree: RocketTree, finSets: ComponentNode[]): void {
  for (const n of finSets) {
    // Pass where the fin stands so the printed template's root follows its
    // parent and its tab is clamped to the depth the kernel allows, matching
    // the DXF and the STL of the same fin. Without it a 20 mm tab on a 12 mm
    // body would print at full depth.
    const f = finPlanformMm(n, finMountOf(tree, String(n.id)));
    // A loop, not `Math.max(...pts)`: a freeform outline is file-sourced and
    // spreading a huge one into a call overflows the stack (dxfExport.ts
    // avoids the same thing the same way).
    let w = -Infinity;
    let h = -Infinity;
    for (const pt of f.pts) {
      if (pt[0] > w) w = pt[0];
      if (pt[1] > h) h = pt[1];
    }
    template(p, `${(n.name as string) || p.t('report.finSet')} × ${f.count}`, f.pts, w, h);
  }
}

function template(p: PdfPage, label: string, pts: Pt[], w: number, h: number): void {
  const { t, M } = p;
  sub(p, label, 9);
  if (!templateFits(w, h, pageFrame(p.PW, p.PH))) {
    setStyle(p, 'italic').setFontSize(8).setTextColor(120);
    drawText(p, t('report.tooLarge', { w: fmtNum(w, 0), h: fmtNum(h, 0) }), M, p.y + 3);
    p.y += 6;
    return;
  }
  ensure(p, h + 6);
  fillPolygon(p, pts, M, p.y);
  p.y += h + 6;
}

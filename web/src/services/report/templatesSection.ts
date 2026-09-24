import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { finPlanformMm, profileMm, type Pt } from '../reportGeometry';
import { parentRadiusOf } from '../../tree/finPlanform';
import { num } from '../../tree/nodeProps';
import { fmtNum } from '../../i18n/format';
import { pageFrame, templateFits } from './layout';
import { ensure, fillPolygon, heading, sectionBreak, sub, writeRuler, type PdfPage } from './pdfPage';

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
  const { doc, t, M, CW } = p;
  sectionBreak(p);
  heading(p, t('report.templates'));
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(90);
  const hint = doc.splitTextToSize(t('report.templatesHint'), CW) as string[];
  doc.text(hint, M, p.y + 3);
  p.y += 4 + hint.length * 3.5;

  writeRuler(p);
  writeFinTemplates(p, tree, finSets);
  for (const n of noses) {
    const prof = profileMm(n, 0, num(n, 'aftRadius', 0.012), 'ogive');
    if (prof) template(p, (n.name as string) || t('report.noseCone'), prof.pts, prof.w, prof.h);
  }
  for (const n of transitions) {
    const prof = profileMm(n, num(n, 'foreRadius', 0.012), num(n, 'aftRadius', 0.009), 'conical');
    if (prof) template(p, (n.name as string) || t('report.transition'), prof.pts, prof.w, prof.h);
  }
}

function writeFinTemplates(p: PdfPage, tree: RocketTree, finSets: ComponentNode[]): void {
  for (const n of finSets) {
    // Pass the mounting radius so the printed template's tab is clamped to
    // the depth the kernel allows, matching the DXF and the STL of the same
    // fin. Without it a 20 mm tab on a 12 mm body printed at full depth.
    const f = finPlanformMm(n, parentRadiusOf(tree, String(n.id)));
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
  const { doc, t, M } = p;
  sub(p, label, 9);
  if (!templateFits(w, h, pageFrame(p.PW, p.PH))) {
    doc
      .setFont('helvetica', 'italic')
      .setFontSize(8)
      .setTextColor(120)
      .text(t('report.tooLarge', { w: fmtNum(w, 0), h: fmtNum(h, 0) }), M, p.y + 3);
    p.y += 6;
    return;
  }
  ensure(p, h + 6);
  fillPolygon(p, pts, M, p.y);
  p.y += h + 6;
}

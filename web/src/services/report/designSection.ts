import type { RocketTree } from '../../engine/openRocketEngine';
import type { ReportModel } from '../reportModel';
import { rocketSideView } from '../reportGeometry';
import { pageFrame, sideViewOrigin, sideViewScale } from './layout';
import { ensure, fillScaled, heading, kvGrid, sectionBreak, sub, summaryRows, type PdfPage } from './pdfPage';

/**
 * The design report: the title, the fit-to-page side view, the rocket's
 * name and stage count, and the summary grid for the whole rocket and (by
 * stage) each stage.
 */
export function writeDesignSection(p: PdfPage, model: ReportModel, tree: RocketTree): void {
  sectionBreak(p);
  heading(p, p.t('report.title'));
  writeSideView(p, tree);
  writeDesignHeader(p, model);
  writeSummary(p, model);
}

function writeSideView(p: PdfPage, tree: RocketTree): void {
  const sv = rocketSideView(tree);
  if (sv.body.length <= 2) return;
  const frame = pageFrame(p.PW, p.PH);
  const scale = sideViewScale(sv.w, sv.h, frame);
  ensure(p, sv.h * scale + 6);
  // ensure() may have broken to a new page, so the origin is taken from the
  // y that survived it, not the one the scale was computed against.
  const { ox, oy } = sideViewOrigin(sv.w, sv.h, scale, p.y, frame);
  const line: [number, number, number] = [30, 30, 30];
  // +radius points up, and PDF y grows down, so y-scale is negated.
  for (const f of sv.fins) fillScaled(p, f, ox, oy, scale, -scale, [205, 205, 205], line);
  // Strap-on boosters and pods, drawn beside the airframe exactly as the 2D
  // schematic draws them. Before the body, so the core reads as in front.
  for (const pod of sv.pods) fillScaled(p, pod, ox, oy, scale, -scale, [218, 218, 218], line);
  fillScaled(p, sv.body, ox, oy, scale, -scale, [232, 232, 232], line);
  p.y += sv.h * scale + 6;
}

function writeDesignHeader(p: PdfPage, model: ReportModel): void {
  const { doc, M, t } = p;
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(16)
    .setTextColor(20)
    .text(model.name, M, p.y + 4);
  p.y += 6;
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(9)
    .setTextColor(90)
    .text(`${t('report.stages')}: ${model.stages.length}`, M, p.y + 2);
  p.y += 6;
}

function writeSummary(p: PdfPage, model: ReportModel): void {
  kvGrid(p, summaryRows(p, model.whole.info));
  if (p.opts.showByStage)
    for (const st of model.stageSummaries) {
      sub(p, st.label);
      kvGrid(p, summaryRows(p, st.info));
    }
}

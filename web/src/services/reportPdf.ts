import { saveBlob, safeFilename } from './saveFile';
import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import type { ReportModel } from './reportModel';
import type { UnitSelection } from '../prefs/units';
import { finSetsOf } from './report/layout';
import type { ReportOptions } from './report/options';
import { createPdfPage, heading, type T } from './report/pdfPage';
import { writeDesignSection } from './report/designSection';
import { writeMotorsSection } from './report/motorsSection';
import { writePartsSection } from './report/partsSection';
import { writeTemplatesSection } from './report/templatesSection';

export type * from './report/options';
export * from './report/layout';

/**
 * Build the rocket report as a real PDF (vector) and download it. Which sections
 * appear, the paper size/orientation, and the template colors all come from
 * {@link ReportOptions} (the export dialog). Every 1:1 template is drawn in
 * millimeters, so it prints true scale — the printed scale bar stays in mm/cm
 * for the same reason, since it measures the PAGE, not the rocket. Everything
 * the report READS OUT follows the user's unit preference.
 *
 * This module decides WHICH sections appear and in what order; each section
 * draws itself under `report/` against the shared page cursor (`PdfPage`).
 */

// `safeFilename` from saveFile.ts, not a local copy: this one fell to the bug
// that helper documents -- a name of only separators ("///") collapses to "_",
// which is truthy and so survives the `|| 'rocket'` fallback as a useless
// filename.
const safe = (name: string) => safeFilename(name, 'rocket');

export async function downloadReportPdf(
  model: ReportModel,
  tree: RocketTree,
  t: T,
  opts: ReportOptions,
  units: UnitSelection,
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: opts.paper, orientation: opts.orientation });
  const page = createPdfPage(doc, t, opts, units);

  // --- Design report (summary + side view) ---
  if (opts.designReport) writeDesignSection(page, model, tree);

  // --- Motors ---
  if (opts.includeMotors && model.configs.some((c) => c.motors.length)) writeMotorsSection(page, model);

  // --- Parts detail (per selected stage) ---
  const partsStages = model.partsByStage.filter((_, i) => opts.stages[i]?.parts);
  if (partsStages.length) writePartsSection(page, partsStages);

  // --- Templates (1:1) ---
  const finStages = model.stages.filter((_, i) => opts.stages[i]?.finTemplates);
  const finSets = finStages.flatMap((st) => finSetsOf(st));
  const allNodes: ComponentNode[] = [];
  (function walk(ns: ComponentNode[]) {
    for (const n of ns) {
      allNodes.push(n);
      if (n.children) walk(n.children);
    }
  })(tree.components);
  const noses = opts.noseTemplates ? allNodes.filter((n) => n.type === 'nosecone') : [];
  const transitions = opts.transitionTemplates ? allNodes.filter((n) => n.type === 'transition') : [];
  if (finSets.length || noses.length || transitions.length) {
    writeTemplatesSection(page, tree, finSets, noses, transitions);
  }

  if (!page.started) heading(page, t('report.title')); // nothing selected — an empty-ish page beats a corrupt file
  // saveBlob, not jsPDF's doc.save(): that uses its own `<a download>` click,
  // which "silently does nothing and the file simply never appears" on
  // iOS/iPadOS installed as a PWA (saveFile.ts:5-13). Every other export in the
  // app routes through saveBlob; the PDF report was the one that did not.
  await saveBlob(doc.output('blob'), `${safe(model.name)}.pdf`);
}

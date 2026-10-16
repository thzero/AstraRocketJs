import { saveBlob, exportFilename } from '../files/saveFile';
import { useWorkspaceStore } from '../../state/store';
import type { RocketTree } from '../../engine/openRocketEngine';
import { walkNodes } from '../../tree/treeWalk';
import { launcherKind, withLauncher } from '../design/launcher';
import type { ReportModel } from './reportModel';
import type { UnitSelection } from '../../prefs/units';
import { finSetsOf } from './layout';
import type { ReportOptions } from './options';
import { createPdfPage, heading, type PdfPage, type T } from './pdfPage';
import { loadReportFonts, registerReportFonts, type ReportFontFiles } from './reportFonts';
import { writeDesignSection } from './designSection';
import { writeMotorsSection } from './motorsSection';
import { writePartsSection } from './partsSection';
import { writeTemplatesSection } from './templatesSection';
import { markingGuides } from './markingGuide';
import { writeMarkingGuideSection } from './markingSection';

export type * from './options';
export * from './layout';

/**
 * Build the rocket report as a real PDF (vector) and download it. Which sections
 * appear, the paper size/orientation, and the template colors all come from
 * {@link ReportOptions} (the export dialog). Every 1:1 template is drawn in
 * millimeters, so it prints true scale; the printed scale bar stays in mm/cm
 * for the same reason, since it measures the page, not the rocket. Everything
 * the report reads out follows the user's unit preference.
 *
 * This module decides which sections appear and in what order; each section
 * draws itself under `report/` against the shared page cursor (`PdfPage`).
 *
 * The report is drawn in Helvetica first. When some of its text is outside
 * what Helvetica can write, the Unicode font it needs is fetched and the report
 * drawn again with it, so a report in Latin-1 fetches nothing. When the font
 * cannot be fetched, the Helvetica copy is saved, with ASCII stand-ins where
 * there are obvious ones, and `notice` says when some text could not be
 * printed at all. A character neither Unicode font has a glyph for (Hangul,
 * Arabic, an emoji) prints as `?`, and `notice` says that too.
 */

export interface ReportPdfHooks {
  /** Fetches a font file; the browser's `fetch` by default. */
  fetch?: (url: string) => Promise<Response>;
  /** Shown when some text could not be printed; the app's message bar by default. */
  notice?: (message: string) => void;
  /**
   * Asked after the font fetch, the one wait in here: true means the export was
   * abandoned meanwhile, and nothing is saved.
   */
  canceled?: () => boolean;
}

/** The app's message bar. */
const appNotice = (message: string): void => useWorkspaceStore.getState().setErr(message);

export async function downloadReportPdf(
  model: ReportModel,
  tree: RocketTree,
  t: T,
  opts: ReportOptions,
  units: UnitSelection,
  hooks: ReportPdfHooks = {},
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const draw = (fonts: ReportFontFiles): PdfPage => {
    const doc = new jsPDF({ unit: 'mm', format: opts.paper, orientation: opts.orientation });
    // Names the launcher the way this design's guides do (design/launcher).
    const page = createPdfPage(doc, withLauncher(t, launcherKind(tree)), opts, units, registerReportFonts(doc, fonts));
    writeReport(page, model, tree, t, opts);
    return page;
  };

  let page = draw({});
  if (page.needs.size) {
    const fonts = await loadReportFonts(page.needs, hooks.fetch);
    if (hooks.canceled?.()) return;
    if (Object.keys(fonts).length) page = draw(fonts);
  }
  const notice = hooks.notice ?? appNotice;
  if (page.lost) notice(t('report.fontFallback'));
  else if (page.uncovered) notice(t('report.scriptUncovered'));
  // saveBlob, not jsPDF's doc.save(): that uses its own `<a download>` click,
  // which silently does nothing on iOS/iPadOS installed as a PWA (see the
  // saveFile.ts header). Every export in the app routes through saveBlob.
  await saveBlob(page.doc.output('blob'), exportFilename([model.name, 'report'], 'pdf'));
}

/** Every section the options ask for, in order, onto one page cursor. */
function writeReport(page: PdfPage, model: ReportModel, tree: RocketTree, t: T, opts: ReportOptions): void {
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
  const allNodes = [...walkNodes(tree.components)];
  const noses = opts.noseTemplates ? allNodes.filter((n) => n.type === 'nosecone') : [];
  const transitions = opts.transitionTemplates ? allNodes.filter((n) => n.type === 'transition') : [];
  if (finSets.length || noses.length || transitions.length) {
    writeTemplatesSection(page, tree, finSets, noses, transitions);
  }

  // --- Fin marking guides (1:1) ---
  // Not per-stage like the cutting templates: a marking guide belongs to a
  // body tube, and the tube is what the reader wraps it around.
  if (opts.finMarkingGuide) {
    const guides = markingGuides(tree);
    if (guides.guides.length) writeMarkingGuideSection(page, guides);
  }

  if (!page.started) heading(page, t('report.title')); // nothing selected: an empty-ish page beats a corrupt file
}

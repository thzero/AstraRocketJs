import { saveBlob, safeFilename } from './saveFile';
import type { ComponentNode, RocketTree, StaticInfo } from '../engine/openRocketEngine';
import type { ReportModel } from './reportModel';
import { rocketSideView, finPlanformMm, profileMm, type Pt } from './reportGeometry';
import { num } from '../tree/nodeProps';
import { isPlanarFinSet } from '../tree/tubefins';
import { fmtNum } from '../i18n/format';
import { siToUi, type Quantity, type UnitSelection } from '../prefs/units';

/**
 * Build the rocket report as a real PDF (vector) and download it. Which sections
 * appear, the paper size/orientation, and the template colours all come from
 * {@link ReportOptions} (the export dialog). Every 1:1 template is drawn in
 * millimetres, so it prints true scale — the printed scale bar stays in mm/cm
 * for the same reason, since it measures the PAGE, not the rocket. Everything
 * the report READS OUT follows the user's unit preference.
 */

type T = (key: string, opts?: Record<string, unknown>) => string;

/** Per-stage include flags, mirrored by the export dialog's tree. */
export interface StageOption {
  include: boolean;
  parts: boolean;
  finTemplates: boolean;
}

export interface ReportOptions {
  designReport: boolean;
  includeMotors: boolean;
  showByStage: boolean;
  noseTemplates: boolean;
  transitionTemplates: boolean;
  stages: StageOption[];
  paper: 'letter' | 'a4';
  orientation: 'portrait' | 'landscape';
  /** Template fill colour (hex), or '' for outline only. */
  templateFill: string;
  templateStroke: string;
}

// `safeFilename` from saveFile.ts, not a local copy: this one fell to the bug
// that helper documents -- a name of only separators ("///") collapses to "_",
// which is truthy and so survives the `|| 'rocket'` fallback as a useless
// filename.
const safe = (name: string) => safeFilename(name, 'rocket');
/** Exported for test: a malformed colour silently becomes near-black otherwise. */
export const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [17, 24, 39];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Exported for test: this decides WHICH fin templates get printed at all.
 *
 * `isPlanarFinSet`, not `endsWith('finset')` — a tube fin has no planform to
 * cut, and OpenRocket's FinSetPrintStrategy cannot reach one either
 * (`instanceof FinSet`, and TubeFinSet extends Tube). The broad match handed
 * finPlanformMm a tube and got back a fabricated 50 × 30 mm trapezoid, printed
 * 1:1 and labelled with the tube fin set's own name and count.
 */
export const finSetsOf = (stage: ComponentNode): ComponentNode[] => {
  const out: ComponentNode[] = [];
  const walk = (nodes: ComponentNode[]) => {
    for (const n of nodes) {
      if (isPlanarFinSet(String(n.type))) out.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(stage.children ?? []);
  return out;
};

/**
 * The mm box every section lays out inside. Split out of downloadReportPdf so
 * the arithmetic below it is reachable without driving jsPDF — none of it was,
 * and a drift here prints a 1:1 template at the wrong size, which looks entirely
 * plausible on paper and is only found after someone has cut to it.
 */
export interface PageFrame {
  /** Page margin (mm), all four sides. */
  margin: number;
  /** Drawable width between the margins (mm). */
  contentWidth: number;
  /** y past which a block must break to a new page (mm). */
  bottom: number;
}

export const PAGE_MARGIN_MM = 12;

export function pageFrame(pageWidthMm: number, pageHeightMm: number): PageFrame {
  const margin = PAGE_MARGIN_MM;
  return { margin, contentWidth: pageWidthMm - 2 * margin, bottom: pageHeightMm - margin };
}

/** The side view's band height (mm) — it is fit-to-page, not 1:1. */
export const SIDE_VIEW_BAND_MM = 34;

/**
 * Fit the rocket side view to the content width AND the band height, whichever
 * binds first. `Math.max(h, 1)` keeps a zero-height silhouette (a design that is
 * all zero radii) from yielding Infinity and a blank page.
 */
export function sideViewScale(svWidthMm: number, svHeightMm: number, frame: PageFrame): number {
  return Math.min(frame.contentWidth / svWidthMm, SIDE_VIEW_BAND_MM / Math.max(svHeightMm, 1));
}

/** Centre the scaled side view across the content width; oy is its midline. */
export function sideViewOrigin(
  svWidthMm: number,
  svHeightMm: number,
  scale: number,
  y: number,
  frame: PageFrame,
): { ox: number; oy: number } {
  return {
    ox: frame.margin + (frame.contentWidth - svWidthMm * scale) / 2,
    oy: y + (svHeightMm * scale) / 2,
  };
}

/**
 * Does a 1:1 template fit the page? Templates are NEVER scaled down — a shrunk
 * cutting template is worse than none — so one that does not fit is replaced by
 * the `report.tooLarge` note telling the reader to pick a bigger paper or
 * landscape.
 */
export function templateFits(widthMm: number, heightMm: number, frame: PageFrame): boolean {
  return widthMm <= frame.contentWidth && heightMm <= frame.bottom - frame.margin;
}

export async function downloadReportPdf(
  model: ReportModel,
  tree: RocketTree,
  t: T,
  opts: ReportOptions,
  units: UnitSelection,
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: opts.paper, orientation: opts.orientation });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const { margin: M, contentWidth: CW, bottom: BOTTOM } = pageFrame(PW, PH);
  let y = M;
  let started = false; // has anything been drawn (for page breaks between sections)

  const ensure = (h: number) => {
    if (y + h > BOTTOM) {
      doc.addPage();
      y = M;
    }
  };
  const sectionBreak = () => {
    if (started) {
      doc.addPage();
      y = M;
    }
    started = true;
  };
  const heading = (text: string) => {
    doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(20);
    doc.text(text, M, y + 5);
    doc
      .setDrawColor(20)
      .setLineWidth(0.4)
      .line(M, y + 7, M + CW, y + 7);
    y += 12;
  };
  const sub = (text: string, size = 10) => {
    ensure(7);
    doc.setFont('helvetica', 'bold').setFontSize(size).setTextColor(20);
    doc.text(text, M, y + 4);
    y += 6;
  };
  /** Fill + outline a closed polygon, scaled and offset (for the side view). */
  const fillScaled = (
    pts: Pt[],
    ox: number,
    oy: number,
    sx: number,
    sy: number,
    fill: [number, number, number] | null,
    stroke: [number, number, number],
  ) => {
    if (pts.length < 3) return;
    const P = pts.map(([px, py]) => [ox + px * sx, oy + py * sy] as [number, number]);
    const deltas = P.slice(1).map((p, i) => [p[0] - P[i]![0], p[1] - P[i]![1]] as [number, number]);
    doc.setDrawColor(...stroke).setLineWidth(0.3);
    if (fill) {
      doc.setFillColor(...fill);
      doc.lines(deltas, P[0]![0], P[0]![1], [1, 1], 'FD', true);
    } else {
      doc.lines(deltas, P[0]![0], P[0]![1], [1, 1], 'S', true);
    }
  };
  const fillPolygon = (pts: Pt[], ox: number, oy: number) => {
    if (pts.length < 3) return;
    const deltas = pts.slice(1).map((p, i) => [p[0] - pts[i]![0], p[1] - pts[i]![1]] as [number, number]);
    doc.setDrawColor(...hexToRgb(opts.templateStroke)).setLineWidth(0.3);
    if (opts.templateFill) {
      doc.setFillColor(...hexToRgb(opts.templateFill));
      doc.lines(deltas, ox + pts[0]![0], oy + pts[0]![1], [1, 1], 'FD', true);
    } else {
      doc.lines(deltas, ox + pts[0]![0], oy + pts[0]![1], [1, 1], 'S', true);
    }
  };

  const kvGrid = (rows: [string, string][]) => {
    const colW = CW / 2;
    doc.setFontSize(9);
    for (let i = 0; i < rows.length; i += 2) {
      ensure(5.5);
      for (const [j, off] of [
        [i, 0],
        [i + 1, colW],
      ] as const) {
        const r = rows[j];
        if (!r) continue;
        doc
          .setFont('helvetica', 'bold')
          .setTextColor(20)
          .text(r[0], M + off + 1, y + 3.5);
        doc
          .setFont('helvetica', 'normal')
          .setTextColor(50)
          .text(r[1], M + off + colW - 1, y + 3.5, { align: 'right' });
      }
      doc
        .setDrawColor(225)
        .setLineWidth(0.1)
        .line(M, y + 4.6, M + CW, y + 4.6);
      y += 5.2;
    }
    y += 2;
  };

  interface Col {
    title: string;
    w: number;
    align?: 'left' | 'right';
  }
  const table = (cols: Col[], rows: string[][], boldLast = false) => {
    ensure(10);
    doc.setFont('helvetica', 'bold').setFontSize(6.8).setTextColor(70);
    let cx = M;
    for (const c of cols) {
      doc.text(c.title.toUpperCase(), c.align === 'right' ? cx + c.w - 1 : cx + 1, y + 3, { align: c.align ?? 'left' });
      cx += c.w;
    }
    y += 4;
    doc
      .setDrawColor(20)
      .setLineWidth(0.3)
      .line(M, y, M + CW, y);
    y += 3.2;
    doc.setFontSize(8).setTextColor(30);
    rows.forEach((row, ri) => {
      ensure(5);
      const last = boldLast && ri === rows.length - 1;
      doc.setFont('helvetica', last ? 'bold' : 'normal');
      let x2 = M;
      row.forEach((cell, i) => {
        const c = cols[i]!;
        doc.text(cell, c.align === 'right' ? x2 + c.w - 1 : x2 + 1, y + 3, { align: c.align ?? 'left' });
        x2 += c.w;
      });
      y += 4.4;
      if (!last)
        doc
          .setDrawColor(235)
          .setLineWidth(0.1)
          .line(M, y - 1.4, M + CW, y - 1.4);
    });
    y += 3;
  };

  /** An SI value in the user's unit, with its symbol. */
  const q = (quantity: Quantity, si: number, digits = 1) =>
    Number.isFinite(si) ? `${fmtNum(siToUi(quantity, units[quantity], si), digits)} ${units[quantity]}` : '—';
  /** The number only — for a cell that already carries the unit once. */
  const qv = (quantity: Quantity, si: number, digits = 1) => fmtNum(siToUi(quantity, units[quantity], si), digits);
  const len = (m: number) => q('length', m);
  const g = (kg: number) => q('mass', kg, 0);
  const summaryRows = (info: StaticInfo): [string, string][] => {
    const pct = info.length > 0 ? ((info.cp - info.cg) / info.length) * 100 : 0;
    return [
      [t('report.length'), len(info.length)],
      [t('report.maxDiameter'), len(info.refDiameter)],
      [t('report.massEmpty'), g(info.massEmpty)],
      [t('report.massLoaded'), g(info.mass)],
      [t('report.fineness'), fmtNum(info.refDiameter > 0 ? info.length / info.refDiameter : 0, 2)],
      [t('report.cgEmpty'), len(info.cgEmpty)],
      [t('report.cgLoaded'), len(info.cg)],
      [t('report.cp'), len(info.cp)],
      [t('report.stabilityCal'), `${fmtNum(info.stabilityCalibers, 2)} cal`],
      [t('report.stabilityPct'), `${fmtNum(pct, 1)} %`],
      [t('report.cd'), info.cd != null ? fmtNum(info.cd, 3) : '—'],
      [t('report.cna'), `${fmtNum(info.cna, 2)} /rad`],
    ];
  };

  // --- Design report (summary + side view) ---
  if (opts.designReport) {
    sectionBreak();
    heading(t('report.title'));
    const sv = rocketSideView(tree);
    if (sv.body.length > 2) {
      const frame = pageFrame(PW, PH);
      const scale = sideViewScale(sv.w, sv.h, frame);
      ensure(sv.h * scale + 6);
      // ensure() may have broken to a new page, so the origin is taken from the
      // y that survived it, not the one the scale was computed against.
      const { ox, oy } = sideViewOrigin(sv.w, sv.h, scale, y, frame);
      const line: [number, number, number] = [30, 30, 30];
      // +radius points up, and PDF y grows down, so y-scale is negated.
      for (const f of sv.fins) fillScaled(f, ox, oy, scale, -scale, [205, 205, 205], line);
      fillScaled(sv.body, ox, oy, scale, -scale, [232, 232, 232], line);
      y += sv.h * scale + 6;
    }
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(16)
      .setTextColor(20)
      .text(model.name, M, y + 4);
    y += 6;
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(9)
      .setTextColor(90)
      .text(`${t('report.stages')}: ${model.stages.length}`, M, y + 2);
    y += 6;
    kvGrid(summaryRows(model.whole.info));
    if (opts.showByStage)
      for (const st of model.stageSummaries) {
        sub(st.label);
        kvGrid(summaryRows(st.info));
      }
  }

  // --- Motors ---
  if (opts.includeMotors && model.configs.some((c) => c.motors.length)) {
    sectionBreak();
    heading(t('report.motors'));
    for (const c of model.configs) {
      if (!c.motors.length) continue;
      sub(c.name);
      if (c.flight) {
        kvGrid([
          [t('report.altitude'), q('distance', c.flight.maxAltitude, 0)],
          [t('report.flightTime'), `${fmtNum(c.flight.flightTime, 1)} s`],
          [t('report.timeToApogee'), `${fmtNum(c.flight.timeToApogee, 1)} s`],
          [t('report.velOffRod'), q('velocity', c.flight.launchRodVelocity)],
          [t('report.maxVel'), q('velocity', c.flight.maxVelocity, 0)],
          [
            t('report.velDeploy'),
            c.flight.deploymentVelocity != null ? q('velocity', c.flight.deploymentVelocity) : '—',
          ],
          [t('report.landingVel'), q('velocity', c.flight.groundHitVelocity)],
        ]);
      }
      const w = CW;
      const cols: Col[] = [
        { title: t('report.motor'), w: w * 0.22 },
        { title: t('report.avgThrust'), w: w * 0.12, align: 'right' },
        { title: t('report.burnTime'), w: w * 0.11, align: 'right' },
        { title: t('report.maxThrust'), w: w * 0.11, align: 'right' },
        { title: t('report.totalImpulse'), w: w * 0.14, align: 'right' },
        { title: t('report.twRatio'), w: w * 0.1, align: 'right' },
        { title: t('report.motorWt'), w: w * 0.1, align: 'right' },
        { title: t('report.size'), w: w * 0.1, align: 'right' },
      ];
      const rows = c.motors.map((m) => [
        `${m.manufacturer ? m.manufacturer + ' ' : ''}${m.designation}`,
        q('force', m.avgThrust),
        `${fmtNum(m.burnTime, 2)} s`,
        q('force', m.maxThrust, 0),
        q('impulse', m.totalImpulse, 0),
        `${fmtNum(m.avgThrust / (c.loadedMass * 9.80665), 2)}:1`,
        g(m.weight),
        `${qv('motorDimensions', m.diameter, 0)}/${qv('motorDimensions', m.length, 0)} ${units.motorDimensions}`,
      ]);
      rows.push([
        t('report.total'),
        '',
        '',
        '',
        q(
          'impulse',
          c.motors.reduce((a, m) => a + m.totalImpulse, 0),
          0,
        ),
        '',
        g(c.motors.reduce((a, m) => a + m.weight, 0)),
        '',
      ]);
      table(cols, rows, true);
    }
  }

  // --- Parts detail (per selected stage) ---
  const partsStages = model.partsByStage.filter((_, i) => opts.stages[i]?.parts);
  if (partsStages.length) {
    sectionBreak();
    heading(t('report.partsDetail'));
    const cols: Col[] = [
      { title: t('report.part'), w: CW * 0.3 },
      { title: t('report.material'), w: CW * 0.25 },
      { title: t('report.dimensions'), w: CW * 0.32 },
      { title: t('report.mass'), w: CW * 0.13, align: 'right' },
    ];
    const toRow = (r: ReportModel['partsByStage'][number]['rows'][number]) => {
      const dims = [
        r.outerR != null
          ? `Ø ${qv('length', r.outerR * 2)}${r.innerR != null ? '/' + qv('length', r.innerR * 2) : ''} ${units.length}`
          : '',
        r.length > 0 ? `L ${len(r.length)}` : '',
        r.thickness != null ? `w ${qv('length', r.thickness, 2)} ${units.length}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return [
        `${'  '.repeat(r.depth)}${r.name || t(`part.${r.type}`, { defaultValue: r.type })}`,
        `${r.material ?? '—'}${r.density ? ` (${fmtNum(siToUi('density', units.density, r.density), 3)} ${units.density})` : ''}`,
        dims,
        q('mass', r.mass, 2),
      ];
    };
    if (opts.showByStage) {
      for (const st of partsStages) {
        sub(`${t('report.stage')}: ${st.stage}`, 9);
        table(cols, st.rows.map(toRow));
      }
    } else {
      table(cols, partsStages.flatMap((st) => st.rows).map(toRow));
    }
  }

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
    sectionBreak();
    heading(t('report.templates'));
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(90);
    const hint = doc.splitTextToSize(t('report.templatesHint'), CW) as string[];
    doc.text(hint, M, y + 3);
    y += 4 + hint.length * 3.5;

    sub(t('report.ruler'), 9);
    ensure(16);
    const ry = y + 6;
    doc
      .setDrawColor(20)
      .setLineWidth(0.2)
      .line(M, ry, M + 100, ry);
    for (let d = 0; d <= 100; d++) doc.line(M + d, ry, M + d, ry - (d % 10 === 0 ? 4 : d % 5 === 0 ? 2.5 : 1.5));
    doc.setFontSize(6).setTextColor(20);
    for (let cm = 0; cm <= 10; cm++) doc.text(`${cm}`, M + cm * 10, ry - 5);
    for (let inch = 0; inch <= 3; inch++) doc.text(`${inch} in`, M + inch * 25.4, ry + 4);
    doc.text('cm', M + 103, ry - 4);
    y = ry + 8;

    const template = (label: string, pts: Pt[], w: number, h: number) => {
      sub(label, 9);
      if (!templateFits(w, h, pageFrame(PW, PH))) {
        doc
          .setFont('helvetica', 'italic')
          .setFontSize(8)
          .setTextColor(120)
          .text(t('report.tooLarge', { w: fmtNum(w, 0), h: fmtNum(h, 0) }), M, y + 3);
        y += 6;
        return;
      }
      ensure(h + 6);
      fillPolygon(pts, M, y);
      y += h + 6;
    };
    for (const n of finSets) {
      const f = finPlanformMm(n);
      template(
        `${(n.name as string) || t('report.finSet')} × ${f.count}`,
        f.pts,
        Math.max(...f.pts.map((p) => p[0])),
        Math.max(...f.pts.map((p) => p[1])),
      );
    }
    for (const n of noses) {
      const p = profileMm(n, 0, num(n, 'aftRadius', 0.012), 'ogive');
      if (p) template((n.name as string) || t('report.noseCone'), p.pts, p.w, p.h);
    }
    for (const n of transitions) {
      const p = profileMm(n, num(n, 'foreRadius', 0.012), num(n, 'aftRadius', 0.009), 'conical');
      if (p) template((n.name as string) || t('report.transition'), p.pts, p.w, p.h);
    }
  }

  if (!started) heading(t('report.title')); // nothing selected — an empty-ish page beats a corrupt file
  // saveBlob, not jsPDF's doc.save(): that uses its own `<a download>` click,
  // which "silently does nothing and the file simply never appears" on
  // iOS/iPadOS installed as a PWA (saveFile.ts:5-13). Every other export in the
  // app routes through saveBlob; the PDF report was the one that did not.
  await saveBlob(doc.output('blob'), `${safe(model.name)}.pdf`);
}

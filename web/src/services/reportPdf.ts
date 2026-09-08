import type { ComponentNode, RocketTree, StaticInfo } from '../engine/openRocketEngine';
import type { ReportModel } from './reportModel';
import { rocketSideView, finPlanformMm, profileMm, type Pt } from './reportGeometry';
import { num } from '../tree/nodeProps';
import { fmtNum } from '../i18n/format';

/**
 * Build the rocket report as a real PDF (vector) and download it. Which sections
 * appear, the paper size/orientation, and the template colours all come from
 * {@link ReportOptions} (the export dialog). Every 1:1 template is drawn in
 * millimetres, so it prints true scale.
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

const safe = (name: string) => (name || 'rocket').trim().replace(/[^a-z0-9._-]+/gi, '_') || 'rocket';
const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [17, 24, 39];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const finSetsOf = (stage: ComponentNode): ComponentNode[] => {
  const out: ComponentNode[] = [];
  const walk = (nodes: ComponentNode[]) => {
    for (const n of nodes) {
      if (String(n.type).endsWith('finset')) out.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(stage.children ?? []);
  return out;
};

export async function downloadReportPdf(model: ReportModel, tree: RocketTree, t: T, opts: ReportOptions): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: opts.paper, orientation: opts.orientation });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 12;
  const CW = PW - 2 * M;
  const BOTTOM = PH - M;
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
    doc.setDrawColor(20).setLineWidth(0.4).line(M, y + 7, M + CW, y + 7);
    y += 12;
  };
  const sub = (text: string, size = 10) => {
    ensure(7);
    doc.setFont('helvetica', 'bold').setFontSize(size).setTextColor(20);
    doc.text(text, M, y + 4);
    y += 6;
  };
  /** Fill + outline a closed polygon, scaled and offset (for the side view). */
  const fillScaled = (pts: Pt[], ox: number, oy: number, sx: number, sy: number, fill: [number, number, number] | null, stroke: [number, number, number]) => {
    if (pts.length < 3) return;
    const P = pts.map(([px, py]) => [ox + px * sx, oy + py * sy] as [number, number]);
    const deltas = P.slice(1).map((p, i) => [p[0] - P[i][0], p[1] - P[i][1]] as [number, number]);
    doc.setDrawColor(...stroke).setLineWidth(0.3);
    if (fill) {
      doc.setFillColor(...fill);
      doc.lines(deltas, P[0][0], P[0][1], [1, 1], 'FD', true);
    } else {
      doc.lines(deltas, P[0][0], P[0][1], [1, 1], 'S', true);
    }
  };
  const fillPolygon = (pts: Pt[], ox: number, oy: number) => {
    if (pts.length < 3) return;
    const deltas = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]] as [number, number]);
    doc.setDrawColor(...hexToRgb(opts.templateStroke)).setLineWidth(0.3);
    if (opts.templateFill) {
      doc.setFillColor(...hexToRgb(opts.templateFill));
      doc.lines(deltas, ox + pts[0][0], oy + pts[0][1], [1, 1], 'FD', true);
    } else {
      doc.lines(deltas, ox + pts[0][0], oy + pts[0][1], [1, 1], 'S', true);
    }
  };

  const kvGrid = (rows: [string, string][]) => {
    const colW = CW / 2;
    doc.setFontSize(9);
    for (let i = 0; i < rows.length; i += 2) {
      ensure(5.5);
      for (const [j, off] of [[i, 0], [i + 1, colW]] as const) {
        const r = rows[j];
        if (!r) continue;
        doc.setFont('helvetica', 'bold').setTextColor(20).text(r[0], M + off + 1, y + 3.5);
        doc.setFont('helvetica', 'normal').setTextColor(50).text(r[1], M + off + colW - 1, y + 3.5, { align: 'right' });
      }
      doc.setDrawColor(225).setLineWidth(0.1).line(M, y + 4.6, M + CW, y + 4.6);
      y += 5.2;
    }
    y += 2;
  };

  interface Col { title: string; w: number; align?: 'left' | 'right' }
  const table = (cols: Col[], rows: string[][], boldLast = false) => {
    ensure(10);
    doc.setFont('helvetica', 'bold').setFontSize(6.8).setTextColor(70);
    let cx = M;
    for (const c of cols) {
      doc.text(c.title.toUpperCase(), c.align === 'right' ? cx + c.w - 1 : cx + 1, y + 3, { align: c.align ?? 'left' });
      cx += c.w;
    }
    y += 4;
    doc.setDrawColor(20).setLineWidth(0.3).line(M, y, M + CW, y);
    y += 3.2;
    doc.setFontSize(8).setTextColor(30);
    rows.forEach((row, ri) => {
      ensure(5);
      const last = boldLast && ri === rows.length - 1;
      doc.setFont('helvetica', last ? 'bold' : 'normal');
      let x2 = M;
      row.forEach((cell, i) => {
        const c = cols[i];
        doc.text(cell, c.align === 'right' ? x2 + c.w - 1 : x2 + 1, y + 3, { align: c.align ?? 'left' });
        x2 += c.w;
      });
      y += 4.4;
      if (!last) doc.setDrawColor(235).setLineWidth(0.1).line(M, y - 1.4, M + CW, y - 1.4);
    });
    y += 3;
  };

  const mm = (m: number) => `${fmtNum(m * 1000, 0)} mm`;
  const g = (kg: number) => `${fmtNum(kg * 1000, 0)} g`;
  const summaryRows = (info: StaticInfo): [string, string][] => {
    const pct = info.length > 0 ? ((info.cp - info.cg) / info.length) * 100 : 0;
    return [
      [t('report.length'), mm(info.length)], [t('report.maxDiameter'), mm(info.refDiameter)],
      [t('report.massEmpty'), g(info.massEmpty)], [t('report.massLoaded'), g(info.mass)],
      [t('report.fineness'), fmtNum(info.refDiameter > 0 ? info.length / info.refDiameter : 0, 2)], [t('report.cgEmpty'), `${fmtNum(info.cgEmpty * 100, 1)} cm`],
      [t('report.cgLoaded'), `${fmtNum(info.cg * 100, 1)} cm`], [t('report.cp'), `${fmtNum(info.cp * 100, 1)} cm`],
      [t('report.stabilityCal'), `${fmtNum(info.stabilityCalibers, 2)} cal`], [t('report.stabilityPct'), `${fmtNum(pct, 1)} %`],
      [t('report.cd'), info.cd != null ? fmtNum(info.cd, 3) : '—'], [t('report.cna'), `${fmtNum(info.cna, 2)} /rad`],
    ];
  };

  // --- Design report (summary + side view) ---
  if (opts.designReport) {
    sectionBreak();
    heading(t('report.title'));
    const sv = rocketSideView(tree);
    if (sv.body.length > 2) {
      const scale = Math.min(CW / sv.w, 34 / Math.max(sv.h, 1));
      ensure(sv.h * scale + 6);
      const oy = y + (sv.h * scale) / 2;
      const ox = M + (CW - sv.w * scale) / 2;
      const line: [number, number, number] = [30, 30, 30];
      // +radius points up, and PDF y grows down, so y-scale is negated.
      for (const f of sv.fins) fillScaled(f, ox, oy, scale, -scale, [205, 205, 205], line);
      fillScaled(sv.body, ox, oy, scale, -scale, [232, 232, 232], line);
      y += sv.h * scale + 6;
    }
    doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(20).text(model.name, M, y + 4);
    y += 6;
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90).text(`${t('report.stages')}: ${model.stages.length}`, M, y + 2);
    y += 6;
    kvGrid(summaryRows(model.whole.info));
    if (opts.showByStage) for (const st of model.stageSummaries) { sub(st.label); kvGrid(summaryRows(st.info)); }
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
          [t('report.altitude'), `${fmtNum(c.flight.maxAltitude, 0)} m`], [t('report.flightTime'), `${fmtNum(c.flight.flightTime, 1)} s`],
          [t('report.timeToApogee'), `${fmtNum(c.flight.timeToApogee, 1)} s`], [t('report.velOffRod'), `${fmtNum(c.flight.launchRodVelocity, 1)} m/s`],
          [t('report.maxVel'), `${fmtNum(c.flight.maxVelocity, 0)} m/s`], [t('report.velDeploy'), c.flight.deploymentVelocity != null ? `${fmtNum(c.flight.deploymentVelocity, 1)} m/s` : '—'],
          [t('report.landingVel'), `${fmtNum(c.flight.groundHitVelocity, 1)} m/s`],
        ]);
      }
      const w = CW;
      const cols: Col[] = [
        { title: t('report.motor'), w: w * 0.22 }, { title: t('report.avgThrust'), w: w * 0.12, align: 'right' },
        { title: t('report.burnTime'), w: w * 0.11, align: 'right' }, { title: t('report.maxThrust'), w: w * 0.11, align: 'right' },
        { title: t('report.totalImpulse'), w: w * 0.14, align: 'right' }, { title: t('report.twRatio'), w: w * 0.1, align: 'right' },
        { title: t('report.motorWt'), w: w * 0.1, align: 'right' }, { title: t('report.size'), w: w * 0.1, align: 'right' },
      ];
      const rows = c.motors.map((m) => [
        `${m.manufacturer ? m.manufacturer + ' ' : ''}${m.designation}`, `${fmtNum(m.avgThrust, 1)} N`, `${fmtNum(m.burnTime, 2)} s`,
        `${fmtNum(m.maxThrust, 0)} N`, `${fmtNum(m.totalImpulse, 0)} N·s`, `${fmtNum(m.avgThrust / (c.loadedMass * 9.80665), 2)}:1`,
        `${fmtNum(m.weight * 1000, 0)} g`, `${fmtNum(m.diameter * 1000, 0)}/${fmtNum(m.length * 1000, 0)} mm`,
      ]);
      rows.push([t('report.total'), '', '', '', `${fmtNum(c.motors.reduce((a, m) => a + m.totalImpulse, 0), 0)} N·s`, '', `${fmtNum(c.motors.reduce((a, m) => a + m.weight, 0) * 1000, 0)} g`, '']);
      table(cols, rows, true);
    }
  }

  // --- Parts detail (per selected stage) ---
  const partsStages = model.partsByStage.filter((_, i) => opts.stages[i]?.parts);
  if (partsStages.length) {
    sectionBreak();
    heading(t('report.partsDetail'));
    const cols: Col[] = [
      { title: t('report.part'), w: CW * 0.3 }, { title: t('report.material'), w: CW * 0.25 },
      { title: t('report.dimensions'), w: CW * 0.32 }, { title: t('report.mass'), w: CW * 0.13, align: 'right' },
    ];
    const toRow = (r: ReportModel['partsByStage'][number]['rows'][number]) => {
      const dims = [
        r.outerR != null ? `Ø ${fmtNum(r.outerR * 2000, 1)}${r.innerR != null ? '/' + fmtNum(r.innerR * 2000, 1) : ''} mm` : '',
        r.length > 0 ? `L ${fmtNum(r.length * 1000, 1)} mm` : '', r.thickness != null ? `w ${fmtNum(r.thickness * 1000, 2)} mm` : '',
      ].filter(Boolean).join(' · ');
      return [`${'  '.repeat(r.depth)}${r.name || t(`part.${r.type}`, { defaultValue: r.type })}`, `${r.material ?? '—'}${r.density ? ` (${fmtNum(r.density / 1000, 3)} g/cm³)` : ''}`, dims, `${fmtNum(r.mass * 1000, 2)} g`];
    };
    if (opts.showByStage) {
      for (const st of partsStages) { sub(`${t('report.stage')}: ${st.stage}`, 9); table(cols, st.rows.map(toRow)); }
    } else {
      table(cols, partsStages.flatMap((st) => st.rows).map(toRow));
    }
  }

  // --- Templates (1:1) ---
  const finStages = model.stages.filter((_, i) => opts.stages[i]?.finTemplates);
  const finSets = finStages.flatMap((st) => finSetsOf(st));
  const allNodes: ComponentNode[] = [];
  (function walk(ns: ComponentNode[]) { for (const n of ns) { allNodes.push(n); if (n.children) walk(n.children); } })(tree.components);
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
    doc.setDrawColor(20).setLineWidth(0.2).line(M, ry, M + 100, ry);
    for (let d = 0; d <= 100; d++) doc.line(M + d, ry, M + d, ry - (d % 10 === 0 ? 4 : d % 5 === 0 ? 2.5 : 1.5));
    doc.setFontSize(6).setTextColor(20);
    for (let cm = 0; cm <= 10; cm++) doc.text(`${cm}`, M + cm * 10, ry - 5);
    for (let inch = 0; inch <= 3; inch++) doc.text(`${inch} in`, M + inch * 25.4, ry + 4);
    doc.text('cm', M + 103, ry - 4);
    y = ry + 8;

    const template = (label: string, pts: Pt[], w: number, h: number) => {
      sub(label, 9);
      if (w > CW || h > BOTTOM - M) {
        doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(120).text(t('report.tooLarge', { w: fmtNum(w, 0), h: fmtNum(h, 0) }), M, y + 3);
        y += 6;
        return;
      }
      ensure(h + 6);
      fillPolygon(pts, M, y);
      y += h + 6;
    };
    for (const n of finSets) {
      const f = finPlanformMm(n);
      if (!f) continue;
      template(`${(n.name as string) || t('report.finSet')} × ${f.count}`, f.pts, Math.max(...f.pts.map((p) => p[0])), Math.max(...f.pts.map((p) => p[1])));
    }
    for (const n of noses) { const p = profileMm(n, 0, num(n, 'aftRadius', 0.012), 'ogive'); if (p) template((n.name as string) || t('report.noseCone'), p.pts, p.w, p.h); }
    for (const n of transitions) { const p = profileMm(n, num(n, 'foreRadius', 0.012), num(n, 'aftRadius', 0.009), 'conical'); if (p) template((n.name as string) || t('report.transition'), p.pts, p.w, p.h); }
  }

  if (!started) heading(t('report.title')); // nothing selected — an empty-ish page beats a corrupt file
  doc.save(`${safe(model.name)}.pdf`);
}

import type { jsPDF } from 'jspdf';
import type { StaticInfo } from '../../engine/openRocketEngine';
import type { Pt } from '../reportGeometry';
import { fmtNum } from '../../i18n/format';
import { siToUi, type Quantity, type UnitSelection } from '../../prefs/units';
import { hexToRgbTuple, pageFrame } from './layout';
import type { ReportOptions } from './options';

/**
 * The page the report sections draw on: the jsPDF document, the frame it is
 * laid out in, the layout cursor (`y`, and whether anything has been drawn
 * yet), and the drawing primitives every section uses (page breaks, headings,
 * key/value grids, tables, filled polygons) plus the unit formatters.
 */

export type T = (key: string, opts?: Record<string, unknown>) => string;

export interface Col {
  title: string;
  w: number;
  align?: 'left' | 'right';
}

export interface PdfPage {
  doc: jsPDF;
  t: T;
  units: UnitSelection;
  opts: ReportOptions;
  /** Page width / height (mm). */
  PW: number;
  PH: number;
  /** Margin, content width, and the y past which a block breaks (mm). */
  M: number;
  CW: number;
  BOTTOM: number;
  /** The layout cursor: the next free y (mm). */
  y: number;
  /** Has anything been drawn (for page breaks between sections)? */
  started: boolean;
}

export function createPdfPage(doc: jsPDF, t: T, opts: ReportOptions, units: UnitSelection): PdfPage {
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const { margin: M, contentWidth: CW, bottom: BOTTOM } = pageFrame(PW, PH);
  return { doc, t, units, opts, PW, PH, M, CW, BOTTOM, y: M, started: false };
}

/** Break to a new page unless `h` more millimeters fit below the cursor. */
export function ensure(p: PdfPage, h: number): void {
  if (p.y + h > p.BOTTOM) {
    p.doc.addPage();
    p.y = p.M;
  }
}

/** Every section after the first starts on its own page. */
export function sectionBreak(p: PdfPage): void {
  if (p.started) {
    p.doc.addPage();
    p.y = p.M;
  }
  p.started = true;
}

export function heading(p: PdfPage, text: string): void {
  const { doc, M, CW } = p;
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(20);
  doc.text(text, M, p.y + 5);
  doc
    .setDrawColor(20)
    .setLineWidth(0.4)
    .line(M, p.y + 7, M + CW, p.y + 7);
  p.y += 12;
}

export function sub(p: PdfPage, text: string, size = 10): void {
  ensure(p, 7);
  p.doc.setFont('helvetica', 'bold').setFontSize(size).setTextColor(20);
  p.doc.text(text, p.M, p.y + 4);
  p.y += 6;
}

/** Fill + outline a closed polygon, scaled and offset (for the side view). */
export function fillScaled(
  p: PdfPage,
  pts: Pt[],
  ox: number,
  oy: number,
  sx: number,
  sy: number,
  fill: [number, number, number] | null,
  stroke: [number, number, number],
): void {
  if (pts.length < 3) return;
  const { doc } = p;
  const P = pts.map(([px, py]) => [ox + px * sx, oy + py * sy] as [number, number]);
  const deltas = P.slice(1).map((q, i) => [q[0] - P[i]![0], q[1] - P[i]![1]] as [number, number]);
  doc.setDrawColor(...stroke).setLineWidth(0.3);
  if (fill) {
    doc.setFillColor(...fill);
    doc.lines(deltas, P[0]![0], P[0]![1], [1, 1], 'FD', true);
  } else {
    doc.lines(deltas, P[0]![0], P[0]![1], [1, 1], 'S', true);
  }
}

/** A 1:1 template outline in the dialog's template colors. */
export function fillPolygon(p: PdfPage, pts: Pt[], ox: number, oy: number): void {
  if (pts.length < 3) return;
  const { doc, opts } = p;
  const deltas = pts.slice(1).map((q, i) => [q[0] - pts[i]![0], q[1] - pts[i]![1]] as [number, number]);
  doc.setDrawColor(...hexToRgbTuple(opts.templateStroke)).setLineWidth(0.3);
  if (opts.templateFill) {
    doc.setFillColor(...hexToRgbTuple(opts.templateFill));
    doc.lines(deltas, ox + pts[0]![0], oy + pts[0]![1], [1, 1], 'FD', true);
  } else {
    doc.lines(deltas, ox + pts[0]![0], oy + pts[0]![1], [1, 1], 'S', true);
  }
}

/** Two-column label/value grid. */
export function kvGrid(p: PdfPage, rows: [string, string][]): void {
  const { doc, M, CW } = p;
  const colW = CW / 2;
  doc.setFontSize(9);
  for (let i = 0; i < rows.length; i += 2) {
    ensure(p, 5.5);
    for (const [j, off] of [
      [i, 0],
      [i + 1, colW],
    ] as const) {
      const r = rows[j];
      if (!r) continue;
      doc
        .setFont('helvetica', 'bold')
        .setTextColor(20)
        .text(r[0], M + off + 1, p.y + 3.5);
      doc
        .setFont('helvetica', 'normal')
        .setTextColor(50)
        .text(r[1], M + off + colW - 1, p.y + 3.5, { align: 'right' });
    }
    doc
      .setDrawColor(225)
      .setLineWidth(0.1)
      .line(M, p.y + 4.6, M + CW, p.y + 4.6);
    p.y += 5.2;
  }
  p.y += 2;
}

/** A ruled table; `boldLast` sets the final row (a total) in bold with no rule under it. */
export function table(p: PdfPage, cols: Col[], rows: string[][], boldLast = false): void {
  const { doc, M, CW } = p;
  ensure(p, 10);
  doc.setFont('helvetica', 'bold').setFontSize(6.8).setTextColor(70);
  let cx = M;
  for (const c of cols) {
    doc.text(c.title.toUpperCase(), c.align === 'right' ? cx + c.w - 1 : cx + 1, p.y + 3, { align: c.align ?? 'left' });
    cx += c.w;
  }
  p.y += 4;
  doc
    .setDrawColor(20)
    .setLineWidth(0.3)
    .line(M, p.y, M + CW, p.y);
  p.y += 3.2;
  doc.setFontSize(8).setTextColor(30);
  rows.forEach((row, ri) => {
    ensure(p, 5);
    const last = boldLast && ri === rows.length - 1;
    doc.setFont('helvetica', last ? 'bold' : 'normal');
    let x2 = M;
    row.forEach((cell, i) => {
      const c = cols[i]!;
      doc.text(cell, c.align === 'right' ? x2 + c.w - 1 : x2 + 1, p.y + 3, { align: c.align ?? 'left' });
      x2 += c.w;
    });
    p.y += 4.4;
    if (!last)
      doc
        .setDrawColor(235)
        .setLineWidth(0.1)
        .line(M, p.y - 1.4, M + CW, p.y - 1.4);
  });
  p.y += 3;
}

/** An SI value in the user's unit, with its symbol. */
export const q = (p: PdfPage, quantity: Quantity, si: number, digits = 1): string =>
  Number.isFinite(si) ? `${fmtNum(siToUi(quantity, p.units[quantity], si), digits)} ${p.units[quantity]}` : '—';

/** The number only — for a cell that already carries the unit once. */
export const qv = (p: PdfPage, quantity: Quantity, si: number, digits = 1): string =>
  fmtNum(siToUi(quantity, p.units[quantity], si), digits);

export const len = (p: PdfPage, m: number): string => q(p, 'length', m);

export const g = (p: PdfPage, kg: number): string => q(p, 'mass', kg, 0);

/** The summary grid's rows for one static-info block (the rocket, or one stage). */
export function summaryRows(p: PdfPage, info: StaticInfo): [string, string][] {
  const { t } = p;
  const pct = info.length > 0 ? ((info.cp - info.cg) / info.length) * 100 : 0;
  return [
    [t('report.length'), len(p, info.length)],
    [t('report.maxDiameter'), len(p, info.refDiameter)],
    [t('report.massEmpty'), g(p, info.massEmpty)],
    [t('report.massLoaded'), g(p, info.mass)],
    [t('report.fineness'), fmtNum(info.refDiameter > 0 ? info.length / info.refDiameter : 0, 2)],
    [t('report.cgEmpty'), len(p, info.cgEmpty)],
    [t('report.cgLoaded'), len(p, info.cg)],
    [t('report.cp'), len(p, info.cp)],
    [t('report.stabilityCal'), `${fmtNum(info.stabilityCalibers, 2)} cal`],
    [t('report.stabilityPct'), `${fmtNum(pct, 1)} %`],
    [t('report.cd'), info.cd != null ? fmtNum(info.cd, 3) : '—'],
    [t('report.cna'), `${fmtNum(info.cna, 2)} /rad`],
  ];
}

/**
 * A 10 cm / 3 in scale bar, so a print can be checked for true scale.
 *
 * Shared by every 1:1 section (the cutting templates and the fin marking
 * guide): each of them is only worth printing if the page came out of the
 * printer unscaled, and this is how the reader checks.
 */
export function writeRuler(p: PdfPage): void {
  const { doc, t, M } = p;
  sub(p, t('report.ruler'), 9);
  ensure(p, 16);
  const ry = p.y + 6;
  doc
    .setDrawColor(20)
    .setLineWidth(0.2)
    .line(M, ry, M + 100, ry);
  for (let d = 0; d <= 100; d++) doc.line(M + d, ry, M + d, ry - (d % 10 === 0 ? 4 : d % 5 === 0 ? 2.5 : 1.5));
  doc.setFontSize(6).setTextColor(20);
  for (let cm = 0; cm <= 10; cm++) doc.text(`${cm}`, M + cm * 10, ry - 5);
  for (let inch = 0; inch <= 3; inch++) doc.text(`${inch} in`, M + inch * 25.4, ry + 4);
  doc.text('cm', M + 103, ry - 4);
  p.y = ry + 8;
}

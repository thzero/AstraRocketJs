// cspell:ignore cmap -- jsPDF's name for a TrueType font's character map
import type { jsPDF } from 'jspdf';
import type { StaticInfo } from '../../engine/openRocketEngine';
import type { Pt } from './reportGeometry';
import { fmtNum, fmtSig, ladderDigits } from '../../i18n/format';
import { NO_VALUE } from '../../i18n/noValue';
import { siToUi, type Quantity, type UnitSelection } from '../../prefs/units';
import { hexToRgbTuple, pageFrame } from './layout';
import type { ReportOptions } from './options';
import { staticInfoRows } from './designInfo';
import { type StatKey } from './designInfo';
import { scriptOf, toWinAnsi, type ReportFamilies, type UnicodeScript } from './reportFonts';

/**
 * The page the report sections draw on: the jsPDF document, the frame it is
 * laid out in, the layout cursor (`y`, and whether anything has been drawn
 * yet), and the drawing primitives every section uses (page breaks, headings,
 * key/value grids, tables, filled polygons) plus the unit formatters.
 *
 * Text goes through `setStyle` and `drawText`, never `doc.setFont` and
 * `doc.text`: a run Helvetica cannot write is drawn in the report's Unicode
 * font when the document has one, and is noted in `needs` either way.
 */

export type T = (key: string, opts?: Record<string, unknown>) => string;

export type FontStyle = 'normal' | 'bold' | 'italic';

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
  /** The style text is set in; a Unicode run takes the same weight. */
  style: FontStyle;
  /** The Unicode family registered with `doc` for each script, if any. */
  fonts: ReportFamilies;
  /** Every script the text drawn so far needed beyond Helvetica. */
  needs: Set<UnicodeScript>;
  /** Some text had a character with no Helvetica stand-in and no font to draw it. */
  lost: boolean;
  /** Some text had a character the registered Unicode font has no glyph for. */
  uncovered: boolean;
}

export function createPdfPage(
  doc: jsPDF,
  t: T,
  opts: ReportOptions,
  units: UnitSelection,
  fonts: ReportFamilies = {},
): PdfPage {
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const { margin: M, contentWidth: CW, bottom: BOTTOM } = pageFrame(PW, PH);
  return {
    doc,
    t,
    units,
    opts,
    PW,
    PH,
    M,
    CW,
    BOTTOM,
    y: M,
    started: false,
    style: 'normal',
    fonts,
    needs: new Set(),
    lost: false,
    uncovered: false,
  };
}

/** Set the text style. Returns the document, for chaining the size and color. */
export function setStyle(p: PdfPage, style: FontStyle): jsPDF {
  p.style = style;
  return p.doc.setFont('helvetica', style);
}

/**
 * The Unicode family a run is drawn in, or null for Helvetica. Records what the
 * run needed, so a document drawn without the font says which one to fetch.
 */
function unicodeFamily(p: PdfPage, s: string): string | null {
  const script = scriptOf(s);
  if (!script) return null;
  p.needs.add(script);
  return p.fonts[script] ?? null;
}

/** A run as Helvetica writes it, noting a character that had no stand-in. */
function winAnsi(p: PdfPage, s: string): string {
  const out = toWinAnsi(s);
  if (out.lost) p.lost = true;
  return out.text;
}

/** The character map of the font set on the document, when it is an embedded TTF. */
function codeMapOf(doc: jsPDF): Record<number, number> | null {
  const font = doc.getFont() as { metadata?: { cmap?: { unicode?: { codeMap?: Record<number, number> } } } };
  return font.metadata?.cmap?.unicode?.codeMap ?? null;
}

/**
 * A run as the Unicode font set on the document writes it: a character the
 * font has no glyph for (a script neither family carries, or an emoji) becomes
 * `?`, and is noted, instead of printing as an empty box.
 */
function covered(p: PdfPage, s: string): string {
  const map = codeMapOf(p.doc);
  if (!map) return s;
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || (c <= 0xffff && map[c])) {
      out += ch;
      continue;
    }
    out += '?';
    p.uncovered = true;
  }
  return out;
}

/**
 * Run `draw` with the font this text needs set on the document, and put
 * Helvetica back after. The Unicode families have no italic, so an italic run
 * takes the upright face. `draw` is handed what to use for each string: the
 * string with each character the Unicode font lacks replaced by `?`, or its
 * Helvetica stand-in.
 */
function inFont<R>(p: PdfPage, s: string, draw: (fit: (s: string) => string) => R): R {
  const family = unicodeFamily(p, s);
  if (!family) return draw((x) => winAnsi(p, x));
  p.doc.setFont(family, p.style === 'bold' ? 'bold' : 'normal');
  try {
    return draw((x) => covered(p, x));
  } finally {
    p.doc.setFont('helvetica', p.style);
  }
}

/** Draw one run, or a list of lines, in the font its characters need. */
export function drawText(
  p: PdfPage,
  s: string | string[],
  x: number,
  y: number,
  opts?: Parameters<jsPDF['text']>[3],
): void {
  inFont(p, Array.isArray(s) ? s.join(' ') : s, (fit) => {
    const run = Array.isArray(s) ? s.map(fit) : fit(s);
    if (opts) p.doc.text(run, x, y, opts);
    else p.doc.text(run, x, y);
  });
}

/** Wrap a run to a width, measured in the font it will be drawn in. */
function splitText(p: PdfPage, s: string, width: number): string[] {
  return inFont(p, s, (fit) => p.doc.splitTextToSize(fit(s), width) as string[]);
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

export function heading(p: PdfPage, title: string): void {
  const { doc, M, CW } = p;
  setStyle(p, 'bold').setFontSize(15).setTextColor(20);
  drawText(p, title, M, p.y + 5);
  doc
    .setDrawColor(20)
    .setLineWidth(0.4)
    .line(M, p.y + 7, M + CW, p.y + 7);
  p.y += 12;
}

/** Small gray body text, wrapped to the content width. */
export function paragraph(p: PdfPage, body: string, style: 'normal' | 'italic' = 'normal', gray = 90): void {
  const { M, CW } = p;
  setStyle(p, style).setFontSize(8).setTextColor(gray);
  const lines = splitText(p, body, CW);
  drawText(p, lines, M, p.y + 3);
  p.y += 4 + lines.length * 3.5;
}

export function sub(p: PdfPage, title: string, size = 10): void {
  ensure(p, 7);
  setStyle(p, 'bold').setFontSize(size).setTextColor(20);
  drawText(p, title, p.M, p.y + 4);
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
      setStyle(p, 'bold').setTextColor(20);
      drawText(p, r[0], M + off + 1, p.y + 3.5);
      setStyle(p, 'normal').setTextColor(50);
      drawText(p, r[1], M + off + colW - 1, p.y + 3.5, { align: 'right' });
    }
    doc
      .setDrawColor(225)
      .setLineWidth(0.1)
      .line(M, p.y + 4.6, M + CW, p.y + 4.6);
    p.y += 5.2;
  }
  p.y += 2;
}

/** Header text size (pt), the space either side of a cell's text (mm), and the header line pitch (em). */
const HEADER_PT = 6.8;
const CELL_PAD_MM = 1;
const HEADER_LEADING = 1.15;
const PT_TO_MM = 25.4 / 72;

/** A column title as drawn: its lines, and the size they are set in. */
interface HeaderFit {
  lines: string[];
  size: number;
}

/** Width of a run in the font it will be drawn in, at the document's current size (mm). */
function textWidth(p: PdfPage, s: string): number {
  return inFont(p, s, (fit) => p.doc.getTextWidth(fit(s)));
}

/**
 * Fit one column title, already uppercased, inside `avail` millimeters. A
 * title that fits on one line at the header size stays there; otherwise it
 * breaks onto two lines at a space, a slash or a colon, at the break that
 * leaves the wider line narrowest. When neither fits, the narrower of the two
 * shapes is set smaller until its widest line fits. A title with no break
 * point (one long word) is only ever shrunk, never split mid-word. Expects
 * the header size and style to be set on the document.
 */
function fitHeader(p: PdfPage, title: string, avail: number): HeaderFit {
  const one = textWidth(p, title);
  if (one <= avail) return { lines: [title], size: HEADER_PT };
  let best: { lines: string[]; w: number } | null = null;
  for (let i = 1; i < title.length; i++) {
    const prev = title[i - 1]!;
    if (!/[\s/:]/.test(prev) || /\s/.test(title[i]!)) continue;
    const a = title.slice(0, i).trimEnd();
    const b = title.slice(i).trimStart();
    if (!a || !b) continue;
    const w = Math.max(textWidth(p, a), textWidth(p, b));
    if (!best || w < best.w) best = { lines: [a, b], w };
  }
  if (best && best.w <= avail) return { lines: best.lines, size: HEADER_PT };
  const shape = best && best.w < one ? best : { lines: [title], w: one };
  // Floored to a hundredth of a point, so the shrunk line is never wider than the column.
  return { lines: shape.lines, size: Math.floor(((HEADER_PT * avail) / shape.w) * 100) / 100 };
}

/**
 * A ruled table; `boldLast` sets the final row (a total) in bold with no rule under it.
 * Each column title is fit to its column by {@link fitHeader}; the titles sit
 * on the rule under them, so a one-line title lines up with the last line of
 * a two-line one.
 */
export function table(p: PdfPage, cols: Col[], rows: string[][], boldLast = false): void {
  const { doc, M, CW } = p;
  ensure(p, 10);
  setStyle(p, 'bold').setFontSize(HEADER_PT).setTextColor(70);
  const fits = cols.map((c) => fitHeader(p, c.title.toUpperCase(), c.w - 2 * CELL_PAD_MM));
  const pitch = HEADER_PT * HEADER_LEADING * PT_TO_MM;
  const extra = (Math.max(1, ...fits.map((f) => f.lines.length)) - 1) * pitch;
  if (extra) ensure(p, 10 + extra);
  const baseline = p.y + 3 + extra;
  let cx = M;
  cols.forEach((c, i) => {
    const { lines, size } = fits[i]!;
    if (size !== HEADER_PT) doc.setFontSize(size);
    const linePitch = size * HEADER_LEADING * PT_TO_MM;
    const x = c.align === 'right' ? cx + c.w - CELL_PAD_MM : cx + CELL_PAD_MM;
    lines.forEach((line, li) => {
      drawText(p, line, x, baseline - (lines.length - 1 - li) * linePitch, { align: c.align ?? 'left' });
    });
    if (size !== HEADER_PT) doc.setFontSize(HEADER_PT);
    cx += c.w;
  });
  p.y += 4 + extra;
  doc
    .setDrawColor(20)
    .setLineWidth(0.3)
    .line(M, p.y, M + CW, p.y);
  p.y += 3.2;
  doc.setFontSize(8).setTextColor(30);
  rows.forEach((row, ri) => {
    ensure(p, 5);
    const last = boldLast && ri === rows.length - 1;
    setStyle(p, last ? 'bold' : 'normal');
    let x2 = M;
    row.forEach((cell, i) => {
      const c = cols[i]!;
      drawText(p, cell, c.align === 'right' ? x2 + c.w - CELL_PAD_MM : x2 + CELL_PAD_MM, p.y + 3, {
        align: c.align ?? 'left',
      });
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

/**
 * Quantities whose decimals follow the size of the number in the unit shown,
 * the ladder the app's own fields use (`ladderDigits`): one decimal is right
 * for a tube in millimeters and wrong in inches, where a BT-50 is 0.976 in and
 * would print as 1.0. Mass and impulse are here for the same reason: a 450 g
 * rocket is 0.45 kg and 0.99 lb, and an A8's 2.5 N·s is 0.56 lbf·s, none of
 * which survive a fixed count of decimals chosen for grams.
 */
const LADDERED: ReadonlySet<Quantity> = new Set<Quantity>(['length', 'motorDimensions', 'mass', 'impulse']);

/** `digits` when the caller states it; else the ladder for a {@link LADDERED} quantity, one decimal for the rest. */
const digitsFor = (quantity: Quantity, ui: number, digits?: number): number =>
  digits ?? (LADDERED.has(quantity) ? ladderDigits(ui) : 1);

/** An SI value in the user's unit, with its symbol. */
export const q = (p: PdfPage, quantity: Quantity, si: number, digits?: number): string => {
  if (!Number.isFinite(si)) return NO_VALUE;
  const ui = siToUi(quantity, p.units[quantity], si);
  return `${fmtNum(ui, digitsFor(quantity, ui, digits))} ${p.units[quantity]}`;
};

/** The number only, for a cell that already carries the unit once. */
export const qv = (p: PdfPage, quantity: Quantity, si: number, digits?: number): string => {
  const ui = siToUi(quantity, p.units[quantity], si);
  return fmtNum(ui, digitsFor(quantity, ui, digits));
};

export const len = (p: PdfPage, m: number): string => q(p, 'length', m);

export const g = (p: PdfPage, kg: number): string => q(p, 'mass', kg);

/** The summary grid's rows for one static-info block (the rocket, or one stage). */
export function summaryRows(p: PdfPage, info: StaticInfo): [string, string][] {
  const { t } = p;
  const label: Record<StatKey, string> = {
    length: 'report.length',
    maxDiameter: 'report.maxDiameter',
    massEmpty: 'report.massEmpty',
    massLoaded: 'report.massLoaded',
    fineness: 'report.fineness',
    cgEmpty: 'report.cgEmpty',
    cgLoaded: 'report.cgLoaded',
    cp: 'report.cp',
    stabilityCal: 'report.stabilityCal',
    stabilityPct: 'report.stabilityPct',
    cd: 'report.cd',
    cna: 'report.cna',
    pitchInertia: 'stats.pitchInertia',
    rollInertia: 'stats.rollInertia',
  };
  const shown = (key: StatKey, v: number): string => {
    switch (key) {
      case 'massEmpty':
      case 'massLoaded':
        return g(p, v);
      case 'fineness':
        return fmtNum(v, 2);
      case 'stabilityCal':
        return `${fmtNum(v, 2)} cal`;
      case 'stabilityPct':
        return `${fmtNum(v, 1)} %`;
      case 'cd':
        return fmtNum(v, 3);
      case 'cna':
        return `${fmtNum(v, 2)} /rad`;
      case 'pitchInertia':
      case 'rollInertia':
        return `${fmtSig(v, 4)} kg·m²`;
      default:
        return len(p, v);
    }
  };
  // Which rows exist is staticInfoRows' call, shared with the .ork and the CSV.
  return staticInfoRows(info).map(({ key, value }) => [t(label[key]), shown(key, value)]);
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
  for (let cm = 0; cm <= 10; cm++) drawText(p, `${cm}`, M + cm * 10, ry - 5);
  for (let inch = 0; inch <= 3; inch++) drawText(p, `${inch} in`, M + inch * 25.4, ry + 4);
  drawText(p, 'cm', M + 103, ry - 4);
  p.y = ry + 8;
}

import type { jsPDF } from 'jspdf';
import { fmtNum } from '../../i18n/format';
import { hexToRgbTuple } from './layout';
import { ensure, heading, sectionBreak, writeRuler, type PdfPage } from './pdfPage';
import { GUIDE_WIDTH_MM, cutPoints, type MarkingGuide, type MarkingGuideSet } from './markingGuide';

/**
 * The fin marking guide: one wrap-around strip per body tube, drawn 1:1.
 *
 * This is the only printed aid a TUBE FIN set gets at all — a tube has no
 * planform, so it can never reach the cutting templates — and it is the only
 * thing in the report that says where around the body ANY of it goes.
 *
 * The arithmetic (which tube, how long the wrap is, where the seam falls, how
 * far along each mark sits) is `markingGuide.ts`. This module only puts it on
 * the page: it decides nothing about the geometry.
 */

/** Space between strips, across and down (mm). */
const GAP_MM = 10;
/**
 * The band above each strip: the name line, the piece line when the strip was
 * cut up, and the fore-end arrow on a line of its own. The arrow used to share
 * the piece line and the two ran into each other.
 */
const HEADER_MM = 12.5;
/** Arrow head, 10 pt (`FinMarkingGuide.ARROW_SIZE`). */
const ARROW_MM = 3.5;
/** Alignment tick, 8 pt (`drawMarkingGuide`'s `tickLength`). */
const TICK_MM = 2.8;

/** One printed strip: a whole guide, or one piece of a guide too long for the page. */
interface Panel {
  guide: MarkingGuide;
  /** 1-based piece number and the piece count; `parts === 1` is a whole guide. */
  part: number;
  parts: number;
  /** Where this piece starts along the wrap, and how long it is (mm). */
  startMm: number;
  lengthMm: number;
}

export function writeMarkingGuideSection(p: PdfPage, set: MarkingGuideSet): void {
  const { doc, t, M, CW } = p;
  sectionBreak(p);
  heading(p, t('report.markingGuide'));
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(90);
  const hint = doc.splitTextToSize(t('report.markingGuideHint'), CW) as string[];
  doc.text(hint, M, p.y + 3);
  p.y += 4 + hint.length * 3.5;

  writeRuler(p);

  // A strip is never scaled (the whole point is that it is the tube's real
  // circumference), so one too long for the page is CUT INTO PIECES that butt
  // together, the way upstream tiles its rasterized guide across pages. A 4 in
  // tube wraps 320 mm, which no paper this report offers can hold in one piece,
  // and that is the size the guide matters most at. `cutPoints` decides WHERE
  // the joins fall; they are kept off the marks.
  const maxStripMm = p.BOTTOM - p.M - HEADER_MM;
  const panels: Panel[] = [];
  for (const guide of set.guides) {
    const cuts = cutPoints(
      guide.marks.map((m) => m.posMm),
      guide.circumferenceMm,
      maxStripMm,
    );
    for (let i = 0; i < cuts.length - 1; i++) {
      panels.push({
        guide,
        part: i + 1,
        parts: cuts.length - 1,
        startMm: cuts[i]!,
        lengthMm: cuts[i + 1]! - cuts[i]!,
      });
    }
  }

  // As many strips across as the page holds (upstream fixes this at two, which
  // wastes half a landscape page). At least one, so a paper narrower than a
  // strip still prints something rather than dividing by a negative.
  const cols = Math.max(1, Math.floor((CW + GAP_MM) / (GUIDE_WIDTH_MM + GAP_MM)));

  let col = 0;
  let rowH = 0;
  for (const panel of panels) {
    const need = HEADER_MM + panel.lengthMm;
    if (col === 0) {
      ensure(p, need);
      rowH = need;
    } else if (need > rowH) {
      if (p.y + need > p.BOTTOM) {
        // Taller than the row it would join and past the bottom: start a row.
        p.y += rowH + GAP_MM;
        col = 0;
        ensure(p, need);
      }
      rowH = need;
    }
    drawPanel(p, panel, M + col * (GUIDE_WIDTH_MM + GAP_MM), p.y);
    if (++col === cols) {
      p.y += rowH + GAP_MM;
      col = 0;
      rowH = 0;
    }
  }
  if (col > 0) p.y += rowH + GAP_MM;

  writeOmitted(p, set);
}

/**
 * Name the parts no strip could carry, and why. Upstream drops them silently,
 * and a part missing from the guide is a part that does not get glued on.
 *
 * The key per reason is written out rather than built from the reason, so
 * `i18n/keys.test.ts` can still find both by a literal grep of the source.
 */
const OMIT_KEY = {
  noWrap: 'report.markingOmitted_noWrap',
  noFins: 'report.markingOmitted_noFins',
} as const;

function writeOmitted(p: PdfPage, set: MarkingGuideSet): void {
  const { doc, t, M, CW } = p;
  for (const reason of ['noWrap', 'noFins'] as const) {
    const parts = set.omitted.filter((o) => o.reason === reason);
    if (!parts.length) continue;
    const names = parts.map((o) => o.name || t(`part.${o.type}`, { defaultValue: o.type })).join(', ');
    ensure(p, 10);
    doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(120);
    const lines = doc.splitTextToSize(t(OMIT_KEY[reason], { names }), CW) as string[];
    doc.text(lines, M, p.y + 3);
    p.y += 4 + lines.length * 3.5;
  }
}

function drawPanel(p: PdfPage, panel: Panel, x: number, top: number): void {
  const { doc, t, opts } = p;
  const { guide } = panel;
  const W = GUIDE_WIDTH_MM;
  const stroke = hexToRgbTuple(opts.templateStroke);
  const y = top + HEADER_MM;
  const name = guide.name || t('report.bodyTube');

  // --- header: what this strip is, and which way is forward ---
  doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(20);
  doc.text(t('report.markingStrip', { name, c: fmtNum(guide.circumferenceMm, 1) }), x, top + 3);
  if (panel.parts > 1) {
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(90);
    doc.text(t('report.markingPart', { k: panel.part, n: panel.parts }), x, top + 6.8);
  }
  drawForeArrow(p, x, top + HEADER_MM - 2, W, stroke);

  // --- the strip itself ---
  doc.setDrawColor(...stroke).setLineWidth(0.3);
  strokeRect(doc, x, y, W, panel.lengthMm);
  // Alignment ticks a quarter of the width in from each edge, top and bottom:
  // they are what you line the two ends up on when the wrap closes.
  const inset = W / 4;
  for (const tx of [x + inset, x + W - inset]) {
    doc.line(tx, y, tx, y + TICK_MM);
    doc.line(tx, y + panel.lengthMm - TICK_MM, tx, y + panel.lengthMm);
  }

  // --- the marks ---
  const end = panel.startMm + panel.lengthMm;
  for (const mark of guide.marks) {
    if (mark.posMm < panel.startMm || mark.posMm >= end) continue;
    const yc = y + (mark.posMm - panel.startMm);
    const label = mark.name || t(`part.${mark.type}`, { defaultValue: mark.type });

    if (mark.cant === 0) {
      doc.setDrawColor(...stroke).setLineWidth(0.3);
      arrowLine(doc, x, yc, x + W, yc, 0, stroke);
      doc
        .setFont('helvetica', 'normal')
        .setFontSize(6.5)
        .setTextColor(...stroke);
      doc.text(label, x + W / 3, yc - 1.2);
      continue;
    }

    // Canted: the root is no longer parallel to the body axis, so the line is
    // drawn at the cant and pinned at the fin's AFT end — the end most likely
    // to sit at the aft end of the tube, where a line running off the end of
    // the paper cannot be drawn at all (`paintFinMarkingGuide`).
    const half = mark.rootChordMm / 2;
    const yStart = yc - half * Math.sin(mark.cant);
    const yEnd = yStart + W * Math.tan(mark.cant);

    // Aft end: dashed across the full width, drawn before the arrow so the
    // arrow sits on top of it.
    doc.setLineDashPattern([2.5, 2.5], 0);
    doc
      .setDrawColor(200, 200, 200)
      .setLineWidth(0.3)
      .line(x + W, yStart, x, yStart);
    // Fore end: dashed down the strip, only when the root chord fits the width.
    if (mark.rootChordMm < W) {
      doc.setLineDashPattern([1, 1.5], 0);
      doc
        .setDrawColor(220, 220, 220)
        .setLineWidth(0.2)
        .line(x + mark.rootChordMm, y, x + mark.rootChordMm, y + panel.lengthMm);
    }
    doc.setLineDashPattern([], 0);

    doc.setDrawColor(...stroke).setLineWidth(0.3);
    arrowLine(doc, x, yStart, x + W, yEnd, mark.cant, stroke);

    // A cross at the fin's center. The cant shifts the center off the left
    // edge as well as up the strip, so the aft end stays flush with the edge.
    const cx = x + half - half * (1 - Math.cos(mark.cant));
    const cs = 1;
    doc.line(cx - cs, yc - cs, cx + cs, yc + cs);
    doc.line(cx - cs, yc + cs, cx + cs, yc - cs);

    doc
      .setFont('helvetica', 'normal')
      .setFontSize(6.5)
      .setTextColor(...stroke);
    doc.text(label, x + W / 3, yStart + (W / 3) * Math.tan(mark.cant) - 1.2, {
      angle: (-mark.cant * 180) / Math.PI,
    });
  }
}

/**
 * The fore-end arrow. Upstream hangs a filled tab off the end of the strip
 * saying the same thing; the tab is only drawn once per guide, which a strip
 * cut into pieces cannot use, and it overhangs the edge the pieces butt
 * together on. The arrow goes in the header band instead, on every piece, so
 * no piece can be taped on backwards.
 */
function drawForeArrow(p: PdfPage, x: number, y: number, w: number, stroke: [number, number, number]): void {
  const { doc, t } = p;
  const tip = x + w;
  doc.setDrawColor(...stroke).setLineWidth(0.3);
  doc.line(tip - 20, y, tip - ARROW_MM, y);
  arrowHead(doc, tip, y, 1, 0, stroke);
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(6.5)
    .setTextColor(...stroke);
  doc.text(t('report.markingFore'), tip - 22, y + 1, { align: 'right' });
}

/** A closed rectangle via `lines`, the primitive the rest of the report draws with. */
function strokeRect(doc: jsPDF, x: number, y: number, w: number, h: number): void {
  doc.lines(
    [
      [w, 0],
      [0, h],
      [-w, 0],
    ],
    x,
    y,
    [1, 1],
    'S',
    true,
  );
}

/** A fin alignment mark: a line with an arrow head at both ends. */
function arrowLine(
  doc: jsPDF,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  angle: number,
  color: [number, number, number],
): void {
  const dx = ARROW_MM * Math.cos(angle);
  const dy = ARROW_MM * Math.sin(angle);
  doc.line(x1 + dx, y1 + dy, x2 - dx, y2 - dy);
  arrowHead(doc, x1, y1, -1, angle, color);
  arrowHead(doc, x2, y2, 1, angle, color);
}

/** A filled triangle pointing along `angle`, `dir` = +1 right / -1 left. */
function arrowHead(
  doc: jsPDF,
  tipX: number,
  tipY: number,
  dir: number,
  angle: number,
  color: [number, number, number],
): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // The two base corners, tip-relative and unrotated (the path itself starts
  // at the tip), then turned into the line's direction. Upstream's polygon is
  // the same three points: the tip, and a base one arrow back, half an arrow
  // to either side.
  const base: [number, number][] = [
    [-dir * ARROW_MM, -ARROW_MM / 2],
    [-dir * ARROW_MM, ARROW_MM / 2],
  ];
  let px = 0;
  let py = 0;
  const deltas = base.map(([lx, ly]) => {
    const rx = lx * c - ly * s;
    const ry = lx * s + ly * c;
    const d: [number, number] = [rx - px, ry - py];
    px = rx;
    py = ry;
    return d;
  });
  doc.setFillColor(...color);
  doc.lines(deltas, tipX, tipY, [1, 1], 'F', true);
}

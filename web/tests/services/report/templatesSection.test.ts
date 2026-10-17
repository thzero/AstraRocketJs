import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import i18n from '../../../src/i18n';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import type { ReportOptions } from '../../../src/services/report/options';
import { createPdfPage, type T } from '../../../src/services/report/pdfPage';
import { writeTemplatesSection } from '../../../src/services/report/templatesSection';
import { METRIC_UNITS } from '../../../src/prefs/units';

/**
 * A template's label prints on the same page as the outline it names.
 *
 * Fin sets of every span from 20 mm to 120 mm, six to a design, so the page
 * breaks fall at every position relative to a label. Each label is followed by
 * its outline (`doc.lines`), and both are recorded with the page they land on.
 */
function labelAndOutlinePages(spanM: number): { label: string; labelPage: number; outlinePage: number }[] {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const page = () => doc.getCurrentPageInfo().pageNumber;
  const events: { kind: 'text' | 'lines'; s?: string; page: number }[] = [];
  const text = doc.text.bind(doc);
  doc.text = ((...a: Parameters<typeof text>) => {
    const s = a[0];
    for (const r of Array.isArray(s) ? s : [s]) events.push({ kind: 'text', s: String(r), page: page() });
    return text(...a);
  }) as typeof doc.text;
  const lines = doc.lines.bind(doc);
  doc.lines = ((...a: Parameters<typeof lines>) => {
    events.push({ kind: 'lines', page: page() });
    return lines(...a);
  }) as typeof doc.lines;

  const fins = Array.from({ length: 6 }, (_, i) => ({
    type: 'trapezoidfinset',
    id: `f${i}`,
    name: `F${i}`,
    finCount: 3,
    rootChord: 0.05,
    tipChord: 0.03,
    height: spanM,
    sweep: 0.02,
    thickness: 0.003,
  }));
  const tree = {
    name: 'T',
    components: [
      {
        type: 'stage',
        id: 's',
        name: 'S',
        children: [{ type: 'bodytube', id: 'b', length: 0.3, outerRadius: 0.02, children: fins }],
      },
    ],
  } as unknown as RocketTree;
  const opts = { templateFill: '', templateStroke: '#000000' } as unknown as ReportOptions;
  const p = createPdfPage(doc, i18n.getFixedT('en') as unknown as T, opts, METRIC_UNITS);
  writeTemplatesSection(p, tree, fins as unknown as ComponentNode[], [], []);

  const out: { label: string; labelPage: number; outlinePage: number }[] = [];
  events.forEach((e, i) => {
    if (e.kind !== 'text' || !/^F\d/.test(e.s ?? '')) return;
    const outline = events.slice(i + 1).find((x) => x.kind === 'lines');
    out.push({ label: e.s!, labelPage: e.page, outlinePage: outline?.page ?? -1 });
  });
  return out;
}

describe('fin templates across a page break', () => {
  it('never leaves a label on the page before its outline', () => {
    let broke = false;
    for (let mm = 20; mm <= 120; mm += 1) {
      const rows = labelAndOutlinePages(mm / 1000);
      expect(rows).toHaveLength(6);
      for (const r of rows) {
        expect({ span: mm, ...r }).toEqual({ span: mm, ...r, outlinePage: r.labelPage });
        if (r.labelPage > 1) broke = true;
      }
    }
    // The sweep did reach a second page, so a break was exercised.
    expect(broke).toBe(true);
  });
});

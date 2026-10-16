import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import type { ReportModel } from '../../../src/services/report/reportModel';
import type { UnitSelection } from '../../../src/prefs/units';
import { pageFrame } from '../../../src/services/report/layout';

/**
 * A forward-swept fin (negative sweep) puts its tip ahead of the root's
 * leading edge. Its 1:1 template must still land inside the page, or, when its
 * full width does not fit, print the too-large note instead.
 */

const PW = 210;
const PH = 297;
const lines: { deltas: [number, number][]; x: number; y: number }[] = [];
const texts: string[] = [];

class FakeDoc {
  internal = { pageSize: { getWidth: () => PW, getHeight: () => PH } };
  splitTextToSize(text: string): string[] {
    return [text];
  }
  getTextWidth(text: string): number {
    return text.length * 2;
  }
  lines(deltas: [number, number][], x: number, y: number): this {
    lines.push({ deltas, x, y });
    return this;
  }
  text(text: string | string[]): this {
    texts.push(Array.isArray(text) ? text.join(' ') : text);
    return this;
  }
  output(): Blob {
    return new Blob(['%PDF']);
  }
}
for (const m of [
  'setFont',
  'setFontSize',
  'setTextColor',
  'setDrawColor',
  'setFillColor',
  'setLineWidth',
  'line',
  'addPage',
  'setLineDashPattern',
  'rect',
]) {
  Object.defineProperty(FakeDoc.prototype, m, {
    value: function (this: FakeDoc) {
      return this;
    },
  });
}
vi.mock('jspdf', () => ({ jsPDF: FakeDoc }));
vi.mock('../../../src/services/files/saveFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/files/saveFile')>()),
  saveBlob: () => Promise.resolve(),
}));

const { downloadReportPdf } = await import('../../../src/services/report/reportPdf');

async function printFin(fin: object): Promise<void> {
  const stage = {
    type: 'stage',
    id: 's',
    name: 'S',
    children: [{ type: 'bodytube', id: 'body', length: 0.4, outerRadius: 0.02, children: [fin] }],
  } as unknown as ComponentNode;
  const tree = { name: 'Swept', components: [stage] } as unknown as RocketTree;
  const model = {
    name: 'Swept',
    stages: [stage],
    whole: {},
    stageSummaries: [],
    configs: [],
    partsByStage: [],
    finSetsByStage: [],
  } as unknown as ReportModel;
  await downloadReportPdf(
    model,
    tree,
    (k: string) => k,
    {
      designReport: false,
      includeMotors: false,
      showByStage: false,
      noseTemplates: false,
      transitionTemplates: false,
      finMarkingGuide: false,
      stages: [{ parts: false, finTemplates: true }],
      paper: 'a4',
      orientation: 'portrait',
      templateFill: '',
      templateStroke: '#000000',
    },
    {} as UnitSelection,
  );
}

/** Every vertex of a drawn polygon, in page millimeters. */
const vertices = (l: (typeof lines)[number]): [number, number][] => {
  const out: [number, number][] = [[l.x, l.y]];
  for (const [dx, dy] of l.deltas) {
    const [x, y] = out[out.length - 1]!;
    out.push([x + dx, y + dy]);
  }
  return out;
};

const fin = (sweep: number, rootChord: number) => ({
  type: 'trapezoidfinset',
  id: 'fins',
  name: 'Fins',
  finCount: 3,
  rootChord,
  tipChord: 0.04,
  sweep,
  height: 0.06,
  thickness: 0.003,
});

describe('fin template of a forward-swept fin', () => {
  beforeEach(() => {
    lines.length = 0;
    texts.length = 0;
  });

  it('draws the whole outline inside the page margins', async () => {
    await printFin(fin(-0.04, 0.08));
    const frame = pageFrame(PW, PH);
    const polys = lines.filter((l) => l.deltas.length >= 3);
    expect(polys).toHaveLength(1);
    const pts = vertices(polys[0]!);
    const xs = pts.map(([x]) => x);
    // The tip, 40 mm ahead of the root, sits on the left margin.
    expect(Math.min(...xs)).toBeCloseTo(frame.margin, 6);
    expect(Math.max(...xs)).toBeLessThanOrEqual(PW - frame.margin + 1e-9);
    expect(texts).not.toContain('report.tooLarge');
  });

  it('prints the too-large note when the full width does not fit, though the aft end alone would', async () => {
    // The aft end is 100 mm from the root's leading edge and the tip 120 mm
    // ahead of it: 220 mm in all, wider than A4 portrait's content.
    await printFin(fin(-0.12, 0.1));
    expect(lines.filter((l) => l.deltas.length >= 3)).toHaveLength(0);
    expect(texts).toContain('report.tooLarge');
  });
});

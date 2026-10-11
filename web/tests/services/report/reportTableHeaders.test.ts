import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '../../../src/i18n/locales/en.json';
import fr from '../../../src/i18n/locales/fr.json';
import ru from '../../../src/i18n/locales/ru.json';
import type { RocketTree } from '../../../src/engine/openRocketEngine';
import type { ReportModel } from '../../../src/services/report/reportModel';
import type { ReportOptions } from '../../../src/services/report/options';
import type { Col, T } from '../../../src/services/report/pdfPage';
import { METRIC_UNITS } from '../../../src/prefs/units';
import { pageFrame } from '../../../src/services/report/layout';
import { motorColumns } from '../../../src/services/report/motorsSection';
import { partColumns } from '../../../src/services/report/partsSection';

/**
 * Every column title of every report table fits its column, measured with the
 * real jsPDF font metrics in the font each line is drawn in (Helvetica, or
 * Noto Sans for Cyrillic). There is no rasterizer here, so the check is the
 * width jsPDF itself gives each drawn header line against the column's inner
 * width (the column less its padding either side).
 */

interface Run {
  text: string;
  x: number;
  y: number;
  align: string;
  width: number;
}

/** The runs of the last document drawn; a report that needs a font is drawn twice. */
let runs: Run[] = [];
vi.mock('jspdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('jspdf')>();
  function SpyPdf(...args: ConstructorParameters<typeof real.jsPDF>) {
    const doc = new real.jsPDF(...args);
    const text = doc.text.bind(doc);
    runs = [];
    doc.text = ((...a: Parameters<typeof text>) => {
      const [s, x, y, o] = a as [string | string[], number, number, { align?: string } | undefined];
      for (const line of Array.isArray(s) ? s : [s]) {
        runs.push({ text: line, x, y, align: o?.align ?? 'left', width: doc.getTextWidth(line) });
      }
      return text(...a);
    }) as typeof doc.text;
    return doc;
  }
  return { ...real, jsPDF: SpyPdf };
});

vi.mock('../../../src/services/files/saveFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/files/saveFile')>()),
  saveBlob: () => Promise.resolve(),
}));

const { downloadReportPdf } = await import('../../../src/services/report/reportPdf');

const FONT_DIR = resolve(__dirname, '../../../public/fonts');
const serveFonts = (url: string): Promise<Response> =>
  Promise.resolve(new Response(readFileSync(resolve(FONT_DIR, url.replace(/^\/fonts\//, '')))));

const tFor =
  (locale: Record<string, unknown>): T =>
  (key: string) => {
    const raw = key.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], locale);
    return typeof raw === 'string' ? raw : key;
  };

const motor = {
  designation: 'J350W',
  manufacturer: 'AeroTech',
  avgThrust: 350,
  maxThrust: 560,
  burnTime: 1.85,
  totalImpulse: 647.5,
  impulseClass: 'J',
  weight: 0.42,
  diameter: 0.038,
  length: 0.2,
  loadedMass: 2.1,
};

const model = {
  name: 'R',
  stages: [],
  whole: { label: 'R', info: {} },
  stageSummaries: [],
  configs: [{ name: 'Config', motors: [motor], flight: null }],
  partsByStage: [
    {
      stage: 'Sustainer',
      rows: [
        { depth: 0, type: 'bodytube', name: 'Body', material: 'Cardboard', length: 0.6, outerR: 0.038, mass: 0.1 },
      ],
    },
  ],
  finSetsByStage: [],
} as unknown as ReportModel;

const tree = { name: 'R', components: [] } as unknown as RocketTree;

const opts: ReportOptions = {
  designReport: false,
  includeMotors: true,
  showByStage: false,
  noseTemplates: false,
  transitionTemplates: false,
  finMarkingGuide: false,
  stages: [{ parts: true, finTemplates: false }],
  paper: 'a4',
  orientation: 'portrait',
  templateFill: '',
  templateStroke: '#000000',
};

/**
 * What is wrong with each column's drawn title: missing, not the whole title,
 * or a line wider than the column less its padding. Empty when all fit.
 */
function headerFaults(cols: Col[], margin: number): string[] {
  const faults: string[] = [];
  let left = margin;
  for (const c of cols) {
    const title = c.title.toUpperCase();
    const anchor = c.align === 'right' ? left + c.w - 1 : left + 1;
    const lines = runs.filter((r) => Math.abs(r.x - anchor) < 1e-6 && r.text.trim() && title.includes(r.text));
    // Every line of the title, in order, and nothing else.
    const distinct = lines.map((r) => r.text).filter((s, i, a) => a.indexOf(s) === i);
    if (distinct.join('').replace(/\s/g, '') !== title.replace(/\s/g, ''))
      faults.push(`${title}: drew ${JSON.stringify(distinct)}`);
    for (const r of lines) {
      if (r.width > c.w - 2 + 1e-6)
        faults.push(`"${r.text}" is ${r.width.toFixed(2)} mm in a ${c.w.toFixed(2)} mm column`);
    }
    left += c.w;
  }
  return faults;
}

describe('report table headers', () => {
  // A4 as jsPDF sizes it: 595.28 by 841.89 points.
  const { margin, contentWidth } = pageFrame((595.28 * 25.4) / 72, (841.89 * 25.4) / 72);

  for (const [name, locale] of [
    ['en', en],
    ['fr', fr],
    ['ru', ru],
  ] as const) {
    it(`fit their columns in ${name}`, async () => {
      const t = tFor(locale);
      await downloadReportPdf(model, tree, t, opts, METRIC_UNITS, { fetch: serveFonts, notice: () => {} });
      expect(headerFaults(motorColumns(t, contentWidth), margin)).toEqual([]);
      expect(headerFaults(partColumns(t, contentWidth), margin)).toEqual([]);
    });
  }

  it('wraps a title with a break point onto two lines before shrinking it', async () => {
    const t = tFor(en);
    await downloadReportPdf(model, tree, t, opts, METRIC_UNITS, { fetch: serveFonts, notice: () => {} });
    const tw = runs.filter((r) => r.text === 'THRUST:' || r.text === 'WEIGHT');
    expect(tw.map((r) => r.text)).toEqual(['THRUST:', 'WEIGHT']);
    expect(tw[1]!.y).toBeGreaterThan(tw[0]!.y);
  });
});

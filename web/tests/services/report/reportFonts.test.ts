// cspell:ignore Rakieta Zólw łśćżęąńź Żółw Ракета Fusée 로켓 -- Polish, Russian, French and Korean report text the test draws
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '../../../src/i18n/locales/en.json';
import ru from '../../../src/i18n/locales/ru.json';
import ja from '../../../src/i18n/locales/ja.json';
import pl from '../../../src/i18n/locales/pl.json';
import type { RocketTree, StaticInfo } from '../../../src/engine/openRocketEngine';
import type { ReportModel } from '../../../src/services/report/reportModel';
import type { ReportOptions } from '../../../src/services/report/options';
import { METRIC_UNITS } from '../../../src/prefs/units';
import { resetReportFontsForTests, scriptOf, toWinAnsi } from '../../../src/services/report/reportFonts';

/**
 * The PDF report's Unicode fonts, against the real jsPDF.
 *
 * Helvetica writes WinAnsi only, so a report in Russian, Japanese or Polish, or
 * with "CNα" or a transition's "Ø a → b" in it, has to draw those runs in a
 * Noto font. The font is fetched only when a run needs it, and a report whose
 * font cannot be fetched still saves, in Helvetica, and says what was lost.
 */

/** Every run drawn: the font it was set in, and the text handed over. */
const runs: { font: string; text: string }[] = [];
const added: string[] = [];
vi.mock('jspdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('jspdf')>();
  // jsPDF sets its methods on each instance, so they are wrapped per document.
  function SpyPdf(...args: ConstructorParameters<typeof real.jsPDF>) {
    const doc = new real.jsPDF(...args);
    const text = doc.text.bind(doc);
    const addFont = doc.addFont.bind(doc);
    doc.text = ((...a: Parameters<typeof text>) => {
      const t = a[0];
      runs.push({ font: doc.getFont().fontName, text: Array.isArray(t) ? t.join(' ') : String(t) });
      return text(...a);
    }) as typeof doc.text;
    doc.addFont = ((...a: Parameters<typeof addFont>) => {
      added.push(`${String(a[1])}/${String(a[2])}`);
      return addFont(...a);
    }) as typeof doc.addFont;
    return doc;
  }
  return { ...real, jsPDF: SpyPdf };
});

const saved: Blob[] = [];
vi.mock('../../../src/services/files/saveFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/files/saveFile')>()),
  saveBlob: (blob: Blob) => {
    saved.push(blob);
    return Promise.resolve();
  },
}));

const { downloadReportPdf } = await import('../../../src/services/report/reportPdf');

const FONT_DIR = resolve(__dirname, '../../../public/fonts');

/** Serves public/fonts the way the static host does, and records each request. */
const fetched: string[] = [];
const serveFonts = (url: string): Promise<Response> => {
  fetched.push(url);
  const file = url.replace(/^\/fonts\//, '');
  return Promise.resolve(new Response(readFileSync(resolve(FONT_DIR, file))));
};
const offline = (url: string): Promise<Response> => {
  fetched.push(url);
  return Promise.reject(new TypeError('Failed to fetch'));
};

/** `t` over one locale's JSON, with `{{name}}` interpolation. */
const tFor =
  (locale: Record<string, unknown>) =>
  (key: string, o?: Record<string, unknown>): string => {
    const raw = key.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], locale);
    const s = typeof raw === 'string' ? raw : key;
    return s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
      const v = o?.[k];
      return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
    });
  };

const info = {
  length: 0.5,
  lengthAerodynamic: 0.5,
  mass: 0.2,
  massEmpty: 0.15,
  cgEmpty: 0.25,
  cg: 0.3,
  cp: 0.35,
  cna: 9.1,
  stabilityCalibers: 1.9,
  stabilityPercent: 10,
  refDiameter: 0.025,
  warnings: 0,
  warningTexts: [],
} as unknown as StaticInfo;

const tree = { name: 'R', components: [] } as unknown as RocketTree;

const model = (name: string) =>
  ({
    name,
    stages: [],
    whole: { label: name, info },
    stageSummaries: [],
    configs: [],
    partsByStage: [],
    finSetsByStage: [],
  }) as unknown as ReportModel;

const opts: ReportOptions = {
  designReport: true,
  includeMotors: false,
  showByStage: false,
  noseTemplates: false,
  transitionTemplates: false,
  finMarkingGuide: false,
  stages: [],
  paper: 'a4',
  orientation: 'portrait',
  templateFill: '',
  templateStroke: '#000000',
};

const pdfText = async () => new TextDecoder('latin1').decode(await saved.at(-1)!.arrayBuffer());

beforeEach(() => {
  runs.length = 0;
  added.length = 0;
  fetched.length = 0;
  saved.length = 0;
  resetReportFontsForTests();
});

describe('report fonts', () => {
  it('draws a Russian report in Noto Sans, fetched once, and embeds it', async () => {
    const notice = vi.fn();
    await downloadReportPdf(model('Ракета'), tree, tFor(ru), opts, METRIC_UNITS, { fetch: serveFonts, notice });
    expect(fetched.sort()).toEqual(['/fonts/NotoSans-Bold.ttf', '/fonts/NotoSans-Regular.ttf']);
    expect(added.sort()).toEqual(['NotoSans/bold', 'NotoSans/normal']);
    const heading = runs.find((r) => r.text === ru.report.title)!;
    expect(heading.font).toBe('NotoSans');
    expect(runs.find((r) => r.text === 'Ракета')!.font).toBe('NotoSans');
    // A number with its unit is WinAnsi, and stays in Helvetica.
    expect(runs.filter((r) => scriptOf(r.text) === null).every((r) => r.font === 'helvetica')).toBe(true);
    expect(runs.filter((r) => scriptOf(r.text) !== null).every((r) => r.font === 'NotoSans')).toBe(true);
    const pdf = await pdfText();
    expect(pdf).toMatch(/\/BaseFont \/NotoSans/);
    expect(pdf).toMatch(/\/FontFile2/);
    expect(notice).not.toHaveBeenCalled();
  });

  it('draws a Japanese report in Noto Sans JP alone, Latin runs included', async () => {
    const notice = vi.fn();
    await downloadReportPdf(model('ロケット'), tree, tFor(ja), opts, METRIC_UNITS, { fetch: serveFonts, notice });
    expect(fetched.sort()).toEqual(['/fonts/NotoSansJP-Bold.ttf', '/fonts/NotoSansJP-Regular.ttf']);
    expect(notice).not.toHaveBeenCalled();
    expect(runs.find((r) => r.text === ja.report.title)!.font).toBe('NotoSansJP');
    expect(runs.find((r) => r.text === 'ロケット')!.font).toBe('NotoSansJP');
    expect(await pdfText()).toMatch(/\/BaseFont \/NotoSansJP/);
  });

  it('draws Polish letters Helvetica lacks in Noto Sans', async () => {
    await downloadReportPdf(model('Rakieta'), tree, tFor(pl), opts, METRIC_UNITS, { fetch: serveFonts });
    const polish = runs.filter((r) => /[łśćżęąńź]/i.test(r.text));
    expect(polish.length).toBeGreaterThan(0);
    expect(polish.every((r) => r.font === 'NotoSans')).toBe(true);
  });

  it('fetches nothing for a report Helvetica can write', async () => {
    const fetcher = vi.fn(serveFonts);
    // The English labels with "CNα" taken out: every run is WinAnsi, the
    // en dash of a missing value included.
    const t = (key: string, o?: Record<string, unknown>) => tFor(en)(key, o).replace('α', 'a');
    await downloadReportPdf(model('Rocket – Mk II'), tree, t, opts, METRIC_UNITS, { fetch: fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    expect(added).toEqual([]);
    expect(runs.every((r) => r.font === 'helvetica')).toBe(true);
    // The en dash goes over as its WinAnsi byte, which Helvetica draws.
    expect(runs.map((r) => r.text)).toContain('Rocket \u0096 Mk II');
  });

  it('fetches Noto Sans for the English "CNα" row alone', async () => {
    await downloadReportPdf(model('Rocket'), tree, tFor(en), opts, METRIC_UNITS, { fetch: serveFonts });
    expect(fetched.sort()).toEqual(['/fonts/NotoSans-Bold.ttf', '/fonts/NotoSans-Regular.ttf']);
    expect(runs.find((r) => r.text.includes('α'))!.font).toBe('NotoSans');
    expect(runs.find((r) => r.text === en.report.title)!.font).toBe('helvetica');
  });

  it('saves in Helvetica and says so when the font cannot be fetched', async () => {
    const notice = vi.fn();
    await downloadReportPdf(model('Ракета'), tree, tFor(ru), opts, METRIC_UNITS, { fetch: offline, notice });
    expect(fetched.length).toBeGreaterThan(0);
    expect(added).toEqual([]);
    expect(saved).toHaveLength(1);
    expect(runs.every((r) => r.font === 'helvetica')).toBe(true);
    expect(runs.find((r) => r.text === '??????')).toBeDefined();
    expect(notice).toHaveBeenCalledWith(ru.report.fontFallback);
  });

  it('says nothing when every character offline has an ASCII stand-in', async () => {
    const notice = vi.fn();
    await downloadReportPdf(model('Rocket'), tree, tFor(en), opts, METRIC_UNITS, { fetch: offline, notice });
    expect(runs.find((r) => r.text.includes('(CNa)'))).toBeDefined();
    expect(notice).not.toHaveBeenCalled();
  });

  it('writes a French grouped number in Helvetica offline, its narrow space as a no-break space', async () => {
    const notice = vi.fn();
    const t = (key: string, o?: Record<string, unknown>) => tFor(en)(key, o).replace('α', 'a');
    // fr groups thousands with U+202F; U+2009 and U+2007 group the same way elsewhere.
    await downloadReportPdf(model('Fusée 1\u202f234 2\u20093 4\u20075'), tree, t, opts, METRIC_UNITS, {
      fetch: offline,
      notice,
    });
    expect(fetched).toEqual([]);
    expect(runs.map((r) => r.text)).toContain('Fusée 1\u00a0234 2\u00a03 4\u00a05');
    expect(notice).not.toHaveBeenCalled();
  });

  it('prints a script neither font covers as "?" and says so', async () => {
    const notice = vi.fn();
    // Hangul is not CJK to the router and Noto Sans has no glyph for it.
    await downloadReportPdf(model('Ракета 로켓'), tree, tFor(ru), opts, METRIC_UNITS, { fetch: serveFonts, notice });
    const name = runs.find((r) => r.text.startsWith('Ракета'))!;
    expect(name).toEqual({ font: 'NotoSans', text: 'Ракета ??' });
    expect(notice).toHaveBeenCalledWith(ru.report.scriptUncovered);
  });

  it('saves nothing when the export is abandoned while a font is fetched', async () => {
    let canceled = false;
    const slow = (url: string) => {
      canceled = true;
      return serveFonts(url);
    };
    await downloadReportPdf(model('Ракета'), tree, tFor(ru), opts, METRIC_UNITS, {
      fetch: slow,
      canceled: () => canceled,
    });
    expect(saved).toEqual([]);
  });

  it('tries again on the next report once the network is back', async () => {
    await downloadReportPdf(model('Ракета'), tree, tFor(ru), opts, METRIC_UNITS, { fetch: offline, notice: () => {} });
    runs.length = 0;
    await downloadReportPdf(model('Ракета'), tree, tFor(ru), opts, METRIC_UNITS, { fetch: serveFonts });
    expect(runs.find((r) => r.text === 'Ракета')!.font).toBe('NotoSans');
  });
});

describe('toWinAnsi', () => {
  it('keeps Latin-1, sends the Windows-1252 punctuation as its byte, and stands in the rest', () => {
    expect(toWinAnsi('Ø 25 → 18 mm')).toEqual({ text: 'Ø 25 -> 18 mm', lost: false });
    expect(toWinAnsi('“a” – b…')).toEqual({ text: '\u0093a\u0094 \u0096 b\u0085', lost: false });
    expect(toWinAnsi('Żółw')).toEqual({ text: 'Zólw', lost: false });
    expect(toWinAnsi('Ж')).toEqual({ text: '?', lost: true });
  });

  it('writes the narrow, thin and figure spaces as the no-break space', () => {
    expect(scriptOf('1\u202f234')).toBeNull();
    expect(toWinAnsi('1\u202f234 5\u20096 7\u20078')).toEqual({ text: '1\u00a0234 5\u00a06 7\u00a08', lost: false });
  });
});

describe('every report string in every locale', () => {
  it('is either WinAnsi or covered by a shipped font', () => {
    // The fonts' own character maps are checked by the build that made them;
    // here the claim is that each string routes to a family at all.
    for (const loc of [en, ru, ja, pl]) {
      for (const s of Object.values(loc.report)) {
        const script = scriptOf(s);
        expect(script === null || script === 'latin' || script === 'jp').toBe(true);
      }
    }
    expect(scriptOf(ja.report.title)).toBe('jp');
    expect(scriptOf(ru.report.title)).toBe('latin');
  });
});

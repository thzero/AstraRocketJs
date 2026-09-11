import { describe, it, expect } from 'vitest';
import type { StaticInfo } from '../engine/openRocketEngine';
import type { ReportModel } from './reportModel';
import { sig4, buildDesignInfo } from './designInfo';

describe('sig4 (4 significant figures, plain decimal)', () => {
  it('rounds and strips trailing zeros', () => {
    expect(sig4(0.425)).toBe('0.425');
    expect(sig4(17)).toBe('17'); // 17.00 → 17
    expect(sig4(5.024)).toBe('5.024');
    expect(sig4(29.53)).toBe('29.53');
  });
  it('keeps 4 sig figs for large numbers (no extra precision)', () => {
    expect(sig4(2499)).toBe('2499');
    expect(sig4(24993)).toBe('24990'); // rounded to 4 sig figs, not 24993
  });
  it('handles tiny values without an exponent', () => {
    expect(sig4(0.0000093)).toBe('0.0000093');
    expect(sig4(0.0000114)).toBe('0.0000114');
    expect(sig4(0.000748)).toBe('0.000748');
  });
  it('handles zero and negatives', () => {
    expect(sig4(0)).toBe('0');
    expect(sig4(-0.425)).toBe('-0.425');
  });
});

const info = (o: Partial<StaticInfo>): StaticInfo =>
  ({
    length: 0.425,
    refDiameter: 0.025,
    mass: 0.0481,
    massEmpty: 0.0481,
    cg: 0.205,
    cgEmpty: 0.205,
    cp: 0.331,
    cna: 14.88,
    stabilityCalibers: 5.02,
    rollInertia: 0.0000093,
    pitchInertia: 0.000748,
    warnings: 0,
    warningTexts: [],
    ...o,
  }) as StaticInfo;

const report = (o: Partial<ReportModel>): ReportModel => o as unknown as ReportModel;
const fields = (stats: { field: string; value: string; unit: string }[]) =>
  Object.fromEntries(stats.map((s) => [s.field, s]));

describe('buildDesignInfo', () => {
  it('emits one rocket group for a single-stage design (no per-stage groups)', () => {
    const di = buildDesignInfo(
      report({
        whole: { label: 'R', info: info({ cd: 0.84 }) },
        stageSummaries: [{ label: 'R', info: info({}) }],
        finSetsByStage: [],
      }),
    );
    expect(di.groups).toHaveLength(1);
    expect(di.groups[0]!.scope).toBe('rocket');
    const f = fields(di.groups[0]!.stats);
    expect(f['Length']).toMatchObject({ value: '0.425', unit: 'm' });
    expect(f['Max Diameter']).toMatchObject({ value: '0.025', unit: 'm' });
    expect(f['Fineness (L/D)']).toMatchObject({ value: '17', unit: '' }); // 0.425 / 0.025
    expect(f['Drag Coeff. (Ma 0.3)']).toMatchObject({ value: '0.84', unit: '' });
    expect(f['Normal-Force Slope (CNα)']).toMatchObject({ unit: '1/rad' });
    expect(f['Roll Inertia (Loaded)']).toMatchObject({ unit: 'kg*m^2' });
    expect(f['CP']).toBeDefined();
    expect(f['Stability (%)']).toBeDefined();
  });

  it('adds a group per stage for a multi-stage design', () => {
    const di = buildDesignInfo(
      report({
        whole: { label: 'R', info: info({ cd: 0.84 }) },
        stageSummaries: [
          { label: 'Sustainer', info: info({}) },
          { label: 'Booster', info: info({}) },
        ],
        finSetsByStage: [],
      }),
    );
    expect(di.groups.map((g) => g.scope)).toEqual(['rocket', 'stage', 'stage']);
    expect(di.groups[1]).toMatchObject({ scope: 'stage', stageNumber: 0, name: 'Sustainer' });
    expect(di.groups[2]).toMatchObject({ scope: 'stage', stageNumber: 1, name: 'Booster' });
    // Per-stage builds carry no drag sweep → no Drag Coeff. row.
    expect(fields(di.groups[1]!.stats)['Drag Coeff. (Ma 0.3)']).toBeUndefined();
  });

  it('omits CP / stability / CNα for a finless design', () => {
    const di = buildDesignInfo(
      report({
        whole: { label: 'R', info: info({ cna: 0, cp: 0 }) },
        stageSummaries: [{ label: 'R', info: info({ cna: 0, cp: 0 }) }],
        finSetsByStage: [],
      }),
    );
    const f = fields(di.groups[0]!.stats);
    expect(f['Length']).toBeDefined(); // still emitted
    expect(f['CP']).toBeUndefined();
    expect(f['Stability (on pad)']).toBeUndefined();
    expect(f['Stability (%)']).toBeUndefined();
    expect(f['Normal-Force Slope (CNα)']).toBeUndefined();
  });

  it('suffixes duplicate fin-set names within a stage', () => {
    const di = buildDesignInfo(
      report({
        whole: { label: 'R', info: info({}) },
        stageSummaries: [{ label: 'R', info: info({}) }],
        finSetsByStage: [
          {
            stage: 'Sustainer',
            sets: [
              { name: 'Fins', topX: 0.35, bottomX: 0.4 },
              { name: 'Fins', topX: 0.35, bottomX: 0.4 },
              { name: 'Solo', topX: 0.1, bottomX: 0.15 },
            ],
          },
        ],
      }),
    );
    expect(di.finsets.map((f) => f.name)).toEqual(['Fins #1', 'Fins #2', 'Solo']); // unique name kept as-is
    expect(di.finsets[0]).toMatchObject({ stageNumber: 0, stage: 'Sustainer', topX: 0.35, bottomX: 0.4 });
  });
});

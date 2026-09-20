import { describe, it, expect, vi } from 'vitest';
import { filterComponents, isComponentCatalog, isComponentRow, projectByType, type Component } from './componentDb';

const parts = [
  { type: 'nosecone', mfr: 'Estes', partNo: 'PNC-50K', desc: 'Ogive nose cone' },
  { type: 'nosecone', mfr: 'Apogee', partNo: 'AC-29', desc: 'Conical nose cone' },
  { type: 'bodytube', mfr: 'Estes', partNo: 'BT-50', desc: 'Body tube' },
] as unknown as Component[];

describe('filterComponents', () => {
  it('returns the list unchanged for an empty / whitespace query', () => {
    expect(filterComponents(parts, '')).toEqual(parts);
    expect(filterComponents(parts, '   ')).toEqual(parts);
  });

  it('AND-s whitespace-separated terms across mfr/partNo/desc', () => {
    // "estes ogive" spans two different fields (mfr + desc) of the same part
    const r = filterComponents(parts, 'estes ogive');
    expect(r).toHaveLength(1);
    expect(r[0]!.partNo).toBe('PNC-50K');
  });

  it('is case-insensitive and matches substrings', () => {
    expect(filterComponents(parts, 'ESTES')).toHaveLength(2);
    expect(filterComponents(parts, 'nose')).toHaveLength(2);
  });

  it('returns nothing when a term matches no part', () => {
    expect(filterComponents(parts, 'estes zzz')).toEqual([]);
  });
});

describe('projectByType', () => {
  it('filters a loaded catalog to a single type', () => {
    const cat = { generated: '', count: parts.length, components: parts };
    const tubes = projectByType(cat, 'bodytube');
    expect(tubes.every((c) => c.type === 'bodytube')).toBe(true);
    expect(tubes).toHaveLength(1);
  });
});

const tube = (over: Record<string, unknown> = {}) => ({
  type: 'bodytube',
  mfr: 'Estes',
  partNo: 'BT-50',
  desc: 'Body tube',
  materialDensity: 680,
  outerDiameter: 0.0246,
  innerDiameter: 0.024,
  length: 0.3,
  ...over,
});

describe('isComponentCatalog (the gate handed to fetchCatalog)', () => {
  it('refuses a host that is up but wrong, so the in-build copy is tried', () => {
    // Served with HTTP 200 while the data branch rebuilds. "Any object" let it
    // through, memoized it, and the picker threw on every open until reload.
    expect(isComponentCatalog({ error: 'rebuilding' })).toBe(false);
    expect(isComponentCatalog(null)).toBe(false);
    expect(isComponentCatalog([])).toBe(false);
  });
  it('accepts a body carrying a components array', () => {
    expect(isComponentCatalog({ generated: '', count: 0, components: [] })).toBe(true);
  });
});

describe('isComponentRow (per-type guard)', () => {
  it('keeps a well-formed row of each type', () => {
    expect(isComponentRow(tube())).toBe(true);
    expect(isComponentRow(tube({ type: 'tubecoupler', innerDiameter: null }))).toBe(true);
    expect(isComponentRow(tube({ type: 'centeringring' }))).toBe(true);
    expect(
      isComponentRow({
        type: 'nosecone',
        mfr: 'E',
        partNo: 'P',
        desc: 'D',
        materialDensity: 1,
        shape: 'ogive',
        filled: false,
        outerDiameter: 0.02,
        length: 0.1,
      }),
    ).toBe(true);
    expect(
      isComponentRow({
        type: 'bulkhead',
        mfr: 'E',
        partNo: 'P',
        desc: 'D',
        materialDensity: 1,
        outerDiameter: 0.02,
        length: 0.003,
        filled: true,
      }),
    ).toBe(true);
    expect(isComponentRow({ type: 'parachute', mfr: 'E', partNo: 'P', desc: 'D', diameter: 0.3, cd: null })).toBe(true);
  });

  it('drops a row missing outerDiameter (catalogPatch would divide undefined by 2)', () => {
    const { outerDiameter: _drop, ...noOd } = tube();
    expect(isComponentRow(noOd)).toBe(false);
    expect(isComponentRow(tube({ outerDiameter: 'big' }))).toBe(false);
    expect(isComponentRow(tube({ outerDiameter: NaN }))).toBe(false);
  });

  it('drops an unknown type and a row with no description fields', () => {
    expect(isComponentRow(tube({ type: 'finset' }))).toBe(false);
    expect(isComponentRow(tube({ mfr: 3 }))).toBe(false);
    expect(isComponentRow('BT-50')).toBe(false);
  });
});

describe('componentsForType filters rows through the guard', () => {
  it('serves the usable rows and drops the malformed one', async () => {
    vi.resetModules();
    vi.doMock('./remoteData', () => ({
      fetchCatalog: async (_name: string, valid?: (v: unknown) => boolean) => {
        const body = {
          generated: '',
          count: 2,
          components: [tube(), tube({ partNo: 'BAD', outerDiameter: undefined })],
        };
        if (valid && !valid(body)) throw new Error('unexpected catalog shape');
        return body;
      },
    }));
    const { componentsForType } = await import('./componentDb');
    const tubes = await componentsForType('bodytube');
    expect(tubes.map((c) => c.partNo)).toEqual(['BT-50']);
    vi.doUnmock('./remoteData');
  });
});

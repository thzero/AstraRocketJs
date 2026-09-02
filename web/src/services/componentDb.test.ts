import { describe, it, expect } from 'vitest';
import { filterComponents, componentsForType, type Component } from './componentDb';

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

describe('componentsForType', () => {
  it('projects the bundled catalog to a single type', () => {
    const tubes = componentsForType('bodytube');
    expect(Array.isArray(tubes)).toBe(true);
    expect(tubes.every((c) => c.type === 'bodytube')).toBe(true);
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readLocalJson, writeLocalJson } from '../../../src/services/storage/localPref';
import { loadDia, loadMfrs, saveDia, saveMfrs } from '../../../src/components/sim/motorPrefs';
import { nsKey } from '../../../src/services/storage/storageKeys';

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

describe('readLocalJson / writeLocalJson', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a value its validator accepts', () => {
    expect(writeLocalJson('k', ['a', 'b'])).toBe(true);
    expect(readLocalJson('k', isStrings, [])).toEqual(['a', 'b']);
  });

  it('falls back on a missing key, bad JSON, or a value of the wrong shape', () => {
    expect(readLocalJson('none', isStrings, ['x'])).toEqual(['x']);
    localStorage.setItem('k', '{not json');
    expect(readLocalJson('k', isStrings, ['x'])).toEqual(['x']);
    localStorage.setItem('k', JSON.stringify('abc'));
    expect(readLocalJson('k', isStrings, ['x'])).toEqual(['x']);
  });
});

/**
 * The motor picker's remembered filters, read through the shared guard. Without
 * it, a stored string "abc" would become the manufacturer set {a, b, c}, and any
 * two-element array, strings included, would pass as a diameter range.
 */
describe('motor picker preferences', () => {
  beforeEach(() => localStorage.clear());

  it('keeps a manufacturer list and refuses anything else', () => {
    saveMfrs(new Set(['Estes', 'AeroTech']));
    expect(loadMfrs()).toEqual(new Set(['Estes', 'AeroTech']));
    localStorage.setItem(nsKey('motorPicker:mfrs'), JSON.stringify('abc'));
    expect(loadMfrs()).toEqual(new Set());
  });

  it('keeps a numeric range and refuses anything else', () => {
    saveDia([1, 4]);
    expect(loadDia()).toEqual([1, 4]);
    localStorage.setItem(nsKey('motorPicker:dia2'), JSON.stringify(['a', 'b']));
    expect(loadDia()).toBeNull();
  });
});

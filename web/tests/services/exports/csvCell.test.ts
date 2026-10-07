import { describe, it, expect } from 'vitest';
import { neutralizeFormula } from '../../../src/services/exports/csvCell';

describe('neutralizeFormula', () => {
  it('prefixes every leading trigger', () => {
    for (const s of ['=1+1', '+1', '-1+HYPERLINK("x")', '@SUM(A1)', '\tx', '\rx']) {
      expect(neutralizeFormula(s), JSON.stringify(s)).toBe(`'${s}`);
    }
    expect(neutralizeFormula('Nose cone')).toBe('Nose cone');
  });

  it('keeps a negative number numeric only when asked to', () => {
    expect(neutralizeFormula('-80.6', { keepNumericMinus: true })).toBe('-80.6');
    expect(neutralizeFormula('-.5', { keepNumericMinus: true })).toBe('-.5');
    expect(neutralizeFormula('-x', { keepNumericMinus: true })).toBe("'-x");
    expect(neutralizeFormula('-80.6')).toBe("'-80.6");
  });
});

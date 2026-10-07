import { describe, it, expect } from 'vitest';
import { plainDecimal } from '../../../src/services/files/numberText';

/**
 * Locale-free decimal text for a file. Each writer picks its precision and what
 * a non-finite value becomes; before this, the 3MF and RASAero writers printed
 * "NaN" into the file, the .rkt writer "0" and the CSVs nothing.
 */
describe('plainDecimal', () => {
  it('rounds to the given places and drops the trailing zeros', () => {
    expect(plainDecimal(1.23456789, 6)).toBe('1.234568');
    expect(plainDecimal(0.125, 4)).toBe('0.125');
    expect(plainDecimal(2, 4)).toBe('2');
  });

  it('never writes a negative zero', () => {
    expect(plainDecimal(-0.0000001, 6)).toBe('0');
    expect(plainDecimal(-0, 4)).toBe('0');
  });

  it('writes the caller chosen text for a non-finite value', () => {
    expect(plainDecimal(Number.NaN, 6)).toBe('');
    expect(plainDecimal(Number.POSITIVE_INFINITY, 6, '0')).toBe('0');
  });
});

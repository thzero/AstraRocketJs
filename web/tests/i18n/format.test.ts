import { describe, it, expect } from 'vitest';
import { fmtUpTo, ladderDigits, withUnit } from '../../src/i18n/format';
import { siToUi } from '../../src/prefs/units';
import { DROGUE_BAND, MAIN_BAND } from '../../src/services/recoverySizing';

/**
 * The helpers behind every figure that is authored in one unit and shown in
 * another: the descent bands (ft/s), and the NAR / Tripoli caps (mph, degrees).
 */

describe('ladderDigits', () => {
  it('gives fewer decimals the larger the number', () => {
    expect(ladderDigits(1234)).toBe(0);
    expect(ladderDigits(30.44)).toBe(1);
    expect(ladderDigits(4.572)).toBe(2);
    expect(ladderDigits(0.349)).toBe(3);
  });

  it('reads the magnitude, not the sign', () => {
    expect(ladderDigits(-30.44)).toBe(1);
  });
});

describe('fmtUpTo', () => {
  it('drops decimals a round number does not need', () => {
    expect(fmtUpTo(20, 1)).toBe('20');
    expect(fmtUpTo(15, 1)).toBe('15');
  });

  it('keeps the ones it does', () => {
    expect(fmtUpTo(30.44, 1)).toBe('30.4');
    expect(fmtUpTo(8.9408, 1)).toBe('8.9');
  });

  it('is a dash for a value that is not a number', () => {
    expect(fmtUpTo(Number.NaN, 1)).toBe('—');
    expect(fmtUpTo(Number.POSITIVE_INFINITY, 1)).toBe('—');
  });
});

describe('withUnit', () => {
  it('closes degrees up against the number and spaces everything else', () => {
    expect(withUnit('20', '°')).toBe('20°');
    expect(withUnit('8.9', 'm/s')).toBe('8.9 m/s');
    expect(withUnit('15–20', 'ft/s')).toBe('15–20 ft/s');
  });
});

describe('a descent band in the reader unit', () => {
  // The whole reason these helpers exist: the bands are round in ft/s and in
  // nothing else, so a fixed decimal count spoils one unit or the other.
  const band = (b: { min: number; max: number }, sym: string) =>
    withUnit(`${fmtUpTo(siToUi('velocity', sym, b.min), 1)}–${fmtUpTo(siToUi('velocity', sym, b.max), 1)}`, sym);

  it('stays round in the unit it was authored in', () => {
    expect(band(MAIN_BAND, 'ft/s')).toBe('15–20 ft/s');
    expect(band(DROGUE_BAND, 'ft/s')).toBe('50–75 ft/s');
  });

  it('carries one decimal into the units that need it', () => {
    expect(band(MAIN_BAND, 'm/s')).toBe('4.6–6.1 m/s');
    expect(band(DROGUE_BAND, 'm/s')).toBe('15.2–22.9 m/s');
  });
});

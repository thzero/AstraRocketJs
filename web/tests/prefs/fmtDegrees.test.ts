import { describe, expect, it } from 'vitest';
import { fmtDegrees, type Units } from '../../src/prefs/useUnits';
import { siToUi } from '../../src/prefs/units';

/** A degree figure in either angle unit, with the extra decimals a radian needs. */
const units = (sym: string): Pick<Units, 'fmtSym' | 'sym'> => ({
  sym: () => sym,
  fmtSym: (q, si, digits) => `${siToUi(q, sym, si).toFixed(digits)} ${sym}`,
});

describe('fmtDegrees', () => {
  it('prints degrees at the asked precision', () => {
    expect(fmtDegrees(units('°'), 270)).toBe('270 °');
    expect(fmtDegrees(units('°'), 12.34, 1)).toBe('12.3 °');
  });

  it('prints radians with two more decimals', () => {
    expect(fmtDegrees(units('rad'), 180)).toBe('3.14 rad');
    expect(fmtDegrees(units('rad'), 5, 1)).toBe('0.087 rad');
  });
});

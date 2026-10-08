import { describe, it, expect } from 'vitest';
import { SEA_LEVEL_MARGIN_PA, seaLevelExcessPa } from '../../../src/services/flight/sitePressure';

/** The standard pressure at 1500 m, near enough for these cases. */
const AT_1500_M = 84_556;

describe('seaLevelExcessPa', () => {
  it('flags a sea-level figure typed at a high site', () => {
    expect(seaLevelExcessPa(101_325, AT_1500_M)).toBeCloseTo(101_325 - AT_1500_M, 6);
  });

  it('leaves a real pressure at the site alone, high or low weather either way', () => {
    expect(seaLevelExcessPa(85_000, AT_1500_M)).toBeNull();
    expect(seaLevelExcessPa(AT_1500_M + 3_000, AT_1500_M)).toBeNull();
    expect(seaLevelExcessPa(AT_1500_M - 4_000, AT_1500_M)).toBeNull();
  });

  it('flags only past the margin', () => {
    expect(seaLevelExcessPa(AT_1500_M + SEA_LEVEL_MARGIN_PA, AT_1500_M)).toBeNull();
    expect(seaLevelExcessPa(AT_1500_M + SEA_LEVEL_MARGIN_PA + 1, AT_1500_M)).not.toBeNull();
  });

  it('leaves an ordinary high-pressure day at sea level alone', () => {
    expect(seaLevelExcessPa(104_000, 101_325)).toBeNull();
  });
});

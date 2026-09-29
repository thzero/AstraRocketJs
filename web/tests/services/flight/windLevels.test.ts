import { describe, it, expect } from 'vitest';
import { duplicateAltitudeRows, isUsableLevel, usableWindLevels } from '../../../src/services/flight/windLevels';
import type { WindLevel } from '../../../src/services/design/orkTree';

const lvl = (altitudeM: number, speed = 4): WindLevel => ({ altitudeM, speed, directionDeg: 90, stddev: 0 });

describe('duplicateAltitudeRows', () => {
  it('finds nothing in a profile with one level per altitude', () => {
    expect(duplicateAltitudeRows([lvl(0), lvl(300), lvl(600)])).toEqual([]);
  });

  it('reports the LATER row of a collision, which is the one to flag or drop', () => {
    expect(duplicateAltitudeRows([lvl(0), lvl(300), lvl(0)])).toEqual([2]);
  });

  it('does not need the profile sorted — the kernel does not keep it sorted either', () => {
    expect(duplicateAltitudeRows([lvl(600), lvl(0), lvl(600), lvl(600)])).toEqual([2, 3]);
  });

  /**
   * Exact equality, because that is what `MultiLevelPinkNoiseWindModel` compares
   * when it binary-searches for the insertion point. Rounding these together
   * would report a fault the run does not have.
   */
  it('treats altitudes a hair apart as two levels', () => {
    expect(duplicateAltitudeRows([lvl(0), lvl(1e-9)])).toEqual([]);
  });
});

describe('isUsableLevel', () => {
  it('needs all four numbers to be real', () => {
    expect(isUsableLevel(lvl(0))).toBe(true);
    expect(isUsableLevel({ ...lvl(0), altitudeM: Infinity })).toBe(false);
    expect(isUsableLevel({ ...lvl(0), stddev: NaN })).toBe(false);
    // What a hand-edited or older stored preference can actually hold.
    expect(isUsableLevel({ altitudeM: '300', speed: 4, directionDeg: 90, stddev: 0 })).toBe(false);
    expect(isUsableLevel({ speed: 4, directionDeg: 90, stddev: 0 })).toBe(false);
    expect(isUsableLevel(null)).toBe(false);
  });
});

describe('usableWindLevels', () => {
  it('drops the unusable and the repeated, keeping the first row at each altitude', () => {
    const kept = usableWindLevels([
      lvl(0, 4),
      { altitudeM: NaN, speed: 9, directionDeg: 90, stddev: 0 },
      lvl(0, 9),
      lvl(600, 9),
    ]);
    expect(kept).toEqual([lvl(0, 4), lvl(600, 9)]);
  });

  it('leaves a clean profile exactly as it was, order included', () => {
    const profile = [lvl(600), lvl(0), lvl(300)];
    expect(usableWindLevels(profile)).toEqual(profile);
  });
});

import { describe, it, expect } from 'vitest';
import {
  duplicateAltitudeRows,
  isUsableLevel,
  padLevelWind,
  usableWindLevels,
} from '../../../src/services/flight/windLevels';
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

/**
 * Expected values follow MultiLevelPinkNoiseWindModel.getWindVelocity: each
 * level is (speed sin dir, speed cos dir), two bracketing levels blend
 * linearly in altitude, and getWindDirection is atan2(east, north).
 */
describe('padLevelWind', () => {
  const at = (altitudeM: number, speed: number, directionDeg: number): WindLevel => ({
    altitudeM,
    speed,
    directionDeg,
    stddev: 0,
  });

  it('is undefined without a profile', () => {
    expect(padLevelWind({ launchAltitudeM: 0 })).toBeUndefined();
    expect(padLevelWind({ launchAltitudeM: 0, windLevels: [] })).toBeUndefined();
  });

  it('blends two levels as vectors at the pad altitude', () => {
    // North 10 m/s at 0 m, east 10 m/s at 1000 m: halfway is (5, 5).
    const w = padLevelWind({ launchAltitudeM: 500, windLevels: [at(1000, 10, 90), at(0, 10, 0)] })!;
    expect(w.speedMs).toBeCloseTo(Math.SQRT2 * 5, 10);
    expect(w.headingDeg).toBeCloseTo(45, 10);
  });

  it('reads an MSL profile at the launch altitude and an AGL one at the ground', () => {
    const levels = [at(0, 2, 90), at(3000, 10, 270)];
    // (2, 0) and (-10, 0) halfway: (-4, 0), so 4 m/s from 270.
    const msl = padLevelWind({ launchAltitudeM: 1500, windLevels: levels })!;
    expect(msl.speedMs).toBeCloseTo(4, 10);
    expect(msl.headingDeg).toBeCloseTo(270, 10);
    expect(padLevelWind({ launchAltitudeM: 1500, windLevels: levels, windAltitudeReference: 'agl' })).toEqual({
      speedMs: 2,
      headingDeg: 90,
    });
  });

  it('holds the nearest level outside the profile', () => {
    expect(padLevelWind({ launchAltitudeM: 5000, windLevels: [at(0, 2, 90), at(3000, 10, 270)] })).toEqual({
      speedMs: 10,
      headingDeg: 270,
    });
    expect(padLevelWind({ launchAltitudeM: 100, windLevels: [at(500, 3, 45), at(900, 9, 60)] })).toEqual({
      speedMs: 3,
      headingDeg: 45,
    });
  });

  it('flies a negative speed as its magnitude from the opposite heading', () => {
    expect(padLevelWind({ launchAltitudeM: 0, windLevels: [at(0, -6, 90)] })).toEqual({ speedMs: 6, headingDeg: 270 });
  });
});

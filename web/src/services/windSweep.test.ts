import { describe, expect, it } from 'vitest';
import {
  MAX_SWEEP_FLIGHTS,
  defaultSweepSpec,
  normalizeSweepSpec,
  sweepFlightCount,
  sweepHeadings,
  sweepLaunch,
  sweepPoints,
  sweepSpeeds,
  surfaceWind,
  type WindSweepSpec,
} from './windSweep';
import { MAX_WIND_SPEED_MS } from './safetyLimits';
import type { CompleteLaunch } from './requiredLaunch';
import type { WindLevel } from './orkTree';

/**
 * The grid a drift sweep flies, and the conditions each of its cells carries.
 *
 * Everything here is pure: no engine, no store. What is actually being asserted
 * is that a swept flight differs from the typed one in the wind and NOTHING
 * else, and that the wind it differs by is the wind the grid says it is.
 */

const base: CompleteLaunch = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 5,
  launchRodDirectionDeg: 270,
  windAverage: 4,
  windStdDev: 0.8, // 20% turbulence
  windDirectionDeg: 90,
  launchAltitudeM: 1500,
  latitudeDeg: 39,
  longitudeDeg: -104,
  temperatureC: null,
  pressureHPa: null,
};

const spec = (p: Partial<WindSweepSpec> = {}): WindSweepSpec =>
  normalizeSweepSpec({ speedMinMs: 2, speedMaxMs: 6, speedSteps: 3, headingSteps: 4, headingSpanDeg: 360, ...p });

describe('the grid', () => {
  it('spreads speeds evenly across the band, both ends included', () => {
    expect(sweepSpeeds(spec({ speedMinMs: 2, speedMaxMs: 6, speedSteps: 3 }))).toEqual([2, 4, 6]);
  });

  it('flies the low end alone when asked for one speed', () => {
    expect(sweepSpeeds(spec({ speedMinMs: 3, speedMaxMs: 9, speedSteps: 1 }))).toEqual([3]);
  });

  /**
   * The wrap case. Eight headings over the whole compass are 45 apart and
   * neither end is flown twice; treating it like an arc would put a flight at
   * both 0 and 360 and weight that heading double in the centroid, the hull and
   * the ellipse alike.
   */
  it('does not fly the same heading twice on a full compass', () => {
    const all = sweepHeadings(spec({ headingSteps: 4, headingSpanDeg: 360 }), 0);
    expect(all).toEqual([0, 90, 180, 270]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('centers a partial arc on the flight own heading, ends included', () => {
    expect(sweepHeadings(spec({ headingSteps: 3, headingSpanDeg: 90 }), 180)).toEqual([135, 180, 225]);
  });

  it('wraps a partial arc that crosses north', () => {
    expect(sweepHeadings(spec({ headingSteps: 3, headingSpanDeg: 90 }), 10)).toEqual([325, 10, 55]);
  });

  it('is the product of the two step counts', () => {
    const s = spec({ speedSteps: 3, headingSteps: 4 });
    expect(sweepFlightCount(s)).toBe(12);
    expect(sweepPoints(s, 90)).toHaveLength(12);
  });
});

describe('normalizing a spec', () => {
  /** The safety code's ceiling. A sweep must not draw ground it refuses to fly to. */
  it('caps the band at the wind the safety codes allow', () => {
    const s = normalizeSweepSpec({ ...spec(), speedMaxMs: 40 });
    expect(s.speedMaxMs).toBe(MAX_WIND_SPEED_MS);
  });

  it('swaps a band typed backwards rather than rejecting it', () => {
    const s = normalizeSweepSpec({ ...spec(), speedMinMs: 8, speedMaxMs: 3 });
    expect([s.speedMinMs, s.speedMaxMs]).toEqual([3, 8]);
  });

  it('trims the heading count rather than flying past the flight ceiling', () => {
    const s = normalizeSweepSpec({ ...spec(), speedSteps: 12, headingSteps: 36 });
    expect(s.speedSteps).toBe(12);
    expect(s.speedSteps * s.headingSteps).toBeLessThanOrEqual(MAX_SWEEP_FLIGHTS);
  });

  it('survives a field that is not a number', () => {
    const s = normalizeSweepSpec({
      speedMinMs: NaN,
      speedMaxMs: Infinity,
      speedSteps: NaN,
      headingSteps: NaN,
      headingSpanDeg: NaN,
    });
    expect(Number.isFinite(s.speedMinMs)).toBe(true);
    expect(s.speedMaxMs).toBe(MAX_WIND_SPEED_MS);
    expect(s.speedSteps).toBe(1);
    expect(s.headingSteps).toBe(1);
    expect(s.headingSpanDeg).toBe(360);
  });
});

describe('the default grid', () => {
  it('brackets the wind that was typed', () => {
    const s = defaultSweepSpec(6);
    expect(s.speedMinMs).toBeLessThan(6);
    expect(s.speedMaxMs).toBeGreaterThan(6);
    expect(s.headingSpanDeg).toBe(360);
  });

  /** Still air has no fraction to take, so it gets a plain light-breeze band. */
  it('proposes a real band for a calm day rather than a row of zeros', () => {
    const s = defaultSweepSpec(0);
    expect(s.speedMinMs).toBe(0);
    expect(s.speedMaxMs).toBeGreaterThan(0);
  });

  it('never proposes a band above the safety ceiling', () => {
    expect(defaultSweepSpec(MAX_WIND_SPEED_MS).speedMaxMs).toBeLessThanOrEqual(MAX_WIND_SPEED_MS);
  });
});

describe('the surface wind a sweep is built around', () => {
  it('is the single wind when there is no profile', () => {
    expect(surfaceWind(base)).toEqual({ speedMs: 4, headingDeg: 90 });
  });

  /** Levels are not kept sorted, so the ground layer is the LOWEST altitude. */
  it('is the lowest level of a profile, not the first one listed', () => {
    const levels: WindLevel[] = [
      { altitudeM: 900, speed: 12, directionDeg: 200, stddev: 1.2 },
      { altitudeM: 0, speed: 5, directionDeg: 180, stddev: 0.5 },
    ];
    expect(surfaceWind({ ...base, windLevels: levels })).toEqual({ speedMs: 5, headingDeg: 180 });
  });

  it('reads a blank wind as calm rather than as a number', () => {
    expect(surfaceWind({ ...base, windAverage: null }).speedMs).toBe(0);
  });
});

describe('one cell conditions', () => {
  it('changes the wind and nothing else', () => {
    const out = sweepLaunch(base, { speedMs: 7, headingDeg: 200 });
    expect(out.windAverage).toBe(7);
    expect(out.windDirectionDeg).toBe(200);
    expect({ ...out, windAverage: 0, windStdDev: 0, windDirectionDeg: 0 }).toEqual({
      ...base,
      windAverage: 0,
      windStdDev: 0,
      windDirectionDeg: 0,
    });
  });

  /**
   * Gustiness is a FRACTION of the wind everywhere else in the app, so holding
   * the deviation absolute across a sweep would fly the slow cells as gales.
   */
  it('keeps the turbulence intensity rather than the deviation', () => {
    const out = sweepLaunch(base, { speedMs: 8, headingDeg: 90 });
    expect(out.windStdDev).toBeCloseTo(1.6, 10); // still 20%
  });

  it('leaves a deviation alone when the wind it was a fraction of was zero', () => {
    const calm = { ...base, windAverage: 0, windStdDev: 0.3 };
    expect(sweepLaunch(calm, { speedMs: 5, headingDeg: 90 }).windStdDev).toBe(0.3);
  });

  describe('with a multilevel profile', () => {
    const levels: WindLevel[] = [
      { altitudeM: 0, speed: 4, directionDeg: 180, stddev: 0.4 },
      { altitudeM: 600, speed: 8, directionDeg: 220, stddev: 0.8 },
    ];
    const profiled: CompleteLaunch = { ...base, windLevels: levels };

    /**
     * The shear is a fact about the day, not about the surface wind. A sweep
     * that flew the swept speed at every altitude would quietly delete it.
     */
    it('scales the whole profile, keeping the shear', () => {
      const out = sweepLaunch(profiled, { speedMs: 2, headingDeg: 180 });
      expect(out.windLevels!.map((l) => l.speed)).toEqual([2, 4]);
    });

    it('turns every level by the same amount, so the veer survives', () => {
      const out = sweepLaunch(profiled, { speedMs: 4, headingDeg: 90 });
      expect(out.windLevels!.map((l) => l.directionDeg)).toEqual([90, 130]);
    });

    it('wraps a turn past north', () => {
      const out = sweepLaunch(profiled, { speedMs: 4, headingDeg: 10 });
      expect(out.windLevels!.map((l) => l.directionDeg)).toEqual([10, 50]);
    });

    it('keeps each level own turbulence intensity', () => {
      const out = sweepLaunch(profiled, { speedMs: 8, headingDeg: 180 });
      expect(out.windLevels!.map((l) => l.stddev)).toEqual([0.8, 1.6]);
    });

    /** No ratio to take from a still ground layer, so every level flies the cell. */
    it('flies the swept speed at every level when the ground layer is calm', () => {
      const calm = { ...profiled, windLevels: [{ ...levels[0]!, speed: 0, stddev: 0 }, levels[1]!] };
      const out = sweepLaunch(calm, { speedMs: 3, headingDeg: 180 });
      expect(out.windLevels!.map((l) => l.speed)).toEqual([3, 3]);
    });

    it('leaves the single-wind fields untouched, since the profile overrides them', () => {
      const out = sweepLaunch(profiled, { speedMs: 9, headingDeg: 0 });
      expect(out.windAverage).toBe(base.windAverage);
      expect(out.windDirectionDeg).toBe(base.windDirectionDeg);
    });
  });
});

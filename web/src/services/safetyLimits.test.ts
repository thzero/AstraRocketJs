import { describe, it, expect } from 'vitest';
import {
  launchLimitViolations,
  limitText,
  MAX_ROD_ANGLE_DEG,
  MAX_WIND_SPEED_MPH,
  MAX_WIND_SPEED_MS,
} from './safetyLimits';
import type { LaunchConditions } from './orkTree';

const base = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 0,
  windAverage: 0,
  windStdDev: 0,
  launchAltitudeM: 0,
  latitudeDeg: 28.6,
  temperatureC: null,
  pressureHPa: null,
} as LaunchConditions;

describe('launchLimitViolations', () => {
  it('passes conditions inside the codes', () => {
    expect(launchLimitViolations(base)).toEqual([]);
    expect(
      launchLimitViolations({ ...base, launchRodAngleDeg: MAX_ROD_ANGLE_DEG, windAverage: MAX_WIND_SPEED_MS }),
    ).toEqual([]); // the limit itself is allowed
  });

  it('flags a rod angle past 20 degrees, either side of vertical', () => {
    expect(launchLimitViolations({ ...base, launchRodAngleDeg: 30 })[0]).toMatchObject({
      field: 'rodAngle',
      value: 30,
      limit: 20,
    });
    // Tilting the other way is the same deviation from vertical.
    expect(launchLimitViolations({ ...base, launchRodAngleDeg: -30 })[0]).toMatchObject({ field: 'rodAngle' });
  });

  it('flags wind past 20 mph, and reports it in mph', () => {
    const v = launchLimitViolations({ ...base, windAverage: 20 })[0]!; // 20 m/s ≈ 44.7 mph
    expect(v.field).toBe('windSpeed');
    expect(v.value).toBeCloseTo(44.7, 1);
    expect(v.limit).toBe(MAX_WIND_SPEED_MPH);
  });

  /**
   * The codes are a go/no-go call made from what you can measure at the pad.
   * Nobody is metering the wind at 500 m, so a fast layer aloft is not a reason
   * to refuse a flight — only the ground layer is judged.
   */
  it('judges the wind at the pad, not the wind aloft', () => {
    const aloft = {
      ...base,
      windAverage: 99, // ignored: a profile replaces it at the engine
      windLevels: [
        { altitudeM: 0, speed: 2, directionDeg: 90, stddev: 0 },
        { altitudeM: 500, speed: 25, directionDeg: 90, stddev: 0 },
      ],
    } as LaunchConditions;
    expect(launchLimitViolations(aloft)).toEqual([]);

    const atThePad = {
      ...aloft,
      windLevels: [
        { altitudeM: 0, speed: 15, directionDeg: 90, stddev: 0 },
        { altitudeM: 500, speed: 2, directionDeg: 90, stddev: 0 },
      ],
    } as LaunchConditions;
    expect(launchLimitViolations(atThePad)[0]).toMatchObject({ field: 'windSpeed' });
  });

  it('finds the ground layer by altitude, not by position', () => {
    // The list is not kept sorted, so the first row is not necessarily the pad.
    const unsorted = {
      ...base,
      windLevels: [
        { altitudeM: 500, speed: 2, directionDeg: 90, stddev: 0 },
        { altitudeM: 0, speed: 15, directionDeg: 90, stddev: 0 },
      ],
    } as LaunchConditions;
    expect(launchLimitViolations(unsorted)[0]).toMatchObject({ field: 'windSpeed' });
  });

  it('leaves gusts alone', () => {
    // The codes speak about wind speed; a mean inside the limit with gusts above
    // it is a judgement call this is not equipped to make.
    expect(launchLimitViolations({ ...base, windStdDev: 50 })).toEqual([]);
  });
});

describe('limitText', () => {
  const t = (key: string, vars: Record<string, unknown>) => `${key} ${JSON.stringify(vars)}`;

  it('quotes the rule in the code own units, rounded to one place', () => {
    expect(limitText({ field: 'rodAngle', value: 30.44, limit: 20 }, t)).toBe(
      'limits.rodAngle {"value":30.4,"limit":20}',
    );
  });

  it('reports the wind plainly - it is always the wind at the pad', () => {
    expect(limitText({ field: 'windSpeed', value: 25, limit: 20 }, t)).toBe('limits.wind {"value":25,"limit":20}');
  });
});

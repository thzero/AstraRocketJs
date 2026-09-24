import { describe, it, expect } from 'vitest';
import {
  launchLimitViolations,
  limitText,
  surfaceLevel,
  MAX_ROD_ANGLE_DEG,
  MAX_ROD_ANGLE_RAD,
  MAX_WIND_SPEED_MS,
} from './safetyLimits';
import type { LaunchConditions } from './orkTree';
import { METRIC_UNITS, unitSymbols } from '../prefs/units';

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
      value: (30 * Math.PI) / 180,
      limit: MAX_ROD_ANGLE_RAD,
    });
    // Tilting the other way is the same deviation from vertical.
    expect(launchLimitViolations({ ...base, launchRodAngleDeg: -30 })[0]).toMatchObject({ field: 'rodAngle' });
  });

  it('flags wind past the cap, and reports it in SI', () => {
    // A violation carries SI, so `limitText` can put it in whatever unit the
    // reader has selected. The codes' own 20 mph lives in MAX_WIND_SPEED_MS.
    const v = launchLimitViolations({ ...base, windAverage: 20 })[0]!;
    expect(v.field).toBe('windSpeed');
    expect(v.value).toBe(20);
    expect(v.limit).toBe(MAX_WIND_SPEED_MS);
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
    // it is a judgment call this is not equipped to make.
    expect(launchLimitViolations({ ...base, windStdDev: 50 })).toEqual([]);
  });
});

describe('limitText', () => {
  const t = (key: string, vars: Record<string, unknown>) => `${key} ${JSON.stringify(vars)}`;
  const metric = unitSymbols(METRIC_UNITS, {});

  it('states the rule in the reader units, symbol included', () => {
    // Default settings are metric, so the angle stays in degrees and the wind
    // arrives as m/s rather than the codes' own mph.
    expect(limitText({ field: 'rodAngle', value: (30.44 * Math.PI) / 180, limit: MAX_ROD_ANGLE_RAD }, t, metric)).toBe(
      'limits.rodAngle {"value":"30.4°","limit":"20°"}',
    );
  });

  it('gives both numbers one precision, so the cap does not read as approximate', () => {
    // 20 mph is 8.9408 m/s; shown beside an 11.2 the sentence would otherwise
    // carry two decimal counts for two figures of the same kind.
    expect(limitText({ field: 'windSpeed', value: 11.2, limit: MAX_WIND_SPEED_MS }, t, metric)).toBe(
      'limits.wind {"value":"11.2 m/s","limit":"8.9 m/s"}',
    );
  });
});

describe('surfaceLevel', () => {
  // A profile listed top-down (a CSV, a .ork) has the wind aloft FIRST.
  const topDown = [
    { altitudeM: 3000, speed: 15, directionDeg: 270, stddev: 0 },
    { altitudeM: 500, speed: 6, directionDeg: 200, stddev: 0 },
    { altitudeM: 0, speed: 2, directionDeg: 90, stddev: 0 },
  ];

  it('is the lowest altitude, not the first entry', () => {
    expect(surfaceLevel({ ...base, windLevels: topDown })).toEqual(topDown[2]);
  });

  it('is undefined without a profile', () => {
    expect(surfaceLevel(base)).toBeUndefined();
    expect(surfaceLevel({ ...base, windLevels: [] })).toBeUndefined();
  });

  it('is what the safety code judges the wind on', () => {
    // 15 m/s aloft is over the limit; 2 m/s at the pad is not.
    expect(launchLimitViolations({ ...base, windLevels: topDown })).toEqual([]);
  });
});

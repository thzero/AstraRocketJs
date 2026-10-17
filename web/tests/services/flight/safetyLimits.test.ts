import { describe, it, expect } from 'vitest';
import {
  launchLimitViolations,
  limitText,
  MAX_ROD_ANGLE_DEG,
  MAX_ROD_ANGLE_RAD,
  MAX_WIND_SPEED_MS,
} from '../../../src/services/flight/safetyLimits';
import type { LaunchConditions } from '../../../src/services/design/orkTree';
import { METRIC_UNITS, unitSymbols } from '../../../src/prefs/units';

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
    expect(launchLimitViolations(base, 'model')).toEqual([]);
    for (const cls of ['model', 'highPower'] as const) {
      expect(
        launchLimitViolations(
          { ...base, launchRodAngleDeg: MAX_ROD_ANGLE_DEG[cls], windAverage: MAX_WIND_SPEED_MS },
          cls,
        ),
      ).toEqual([]); // the limit itself is allowed
    }
  });

  /**
   * The NAR Model Rocket Safety Code allows a launcher within 30 degrees of
   * vertical; the NAR and Tripoli high power codes within 20.
   */
  it('allows a model rocket 25 degrees and refuses a high power rocket', () => {
    expect(MAX_ROD_ANGLE_DEG).toEqual({ model: 30, highPower: 20 });
    expect(launchLimitViolations({ ...base, launchRodAngleDeg: 25 }, 'model')).toEqual([]);
    expect(launchLimitViolations({ ...base, launchRodAngleDeg: 25 }, 'highPower')).toEqual([
      { field: 'rodAngle', value: (25 * Math.PI) / 180, limit: MAX_ROD_ANGLE_RAD.highPower, powerClass: 'highPower' },
    ]);
  });

  it('flags a rod angle past the model limit, either side of vertical', () => {
    expect(launchLimitViolations({ ...base, launchRodAngleDeg: 31 }, 'model')[0]).toMatchObject({
      field: 'rodAngle',
      value: (31 * Math.PI) / 180,
      limit: MAX_ROD_ANGLE_RAD.model,
      powerClass: 'model',
    });
    // Tilting the other way is the same deviation from vertical.
    expect(launchLimitViolations({ ...base, launchRodAngleDeg: -31 }, 'model')[0]).toMatchObject({ field: 'rodAngle' });
  });

  it('flags wind past the cap, and reports it in SI', () => {
    // A violation carries SI, so `limitText` can put it in whatever unit the
    // reader has selected. The codes' own 20 mph lives in MAX_WIND_SPEED_MS.
    const v = launchLimitViolations({ ...base, windAverage: 20 }, 'model')[0]!;
    expect(v.field).toBe('windSpeed');
    expect(v.value).toBe(20);
    expect(v.limit).toBe(MAX_WIND_SPEED_MS);
  });

  /**
   * The codes are a go/no-go call made from what you can measure at the pad.
   * Nobody is metering the wind at 500 m, so a fast layer aloft is not a reason
   * to refuse a flight. Only the ground layer is judged.
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
    expect(launchLimitViolations(aloft, 'model')).toEqual([]);

    const atThePad = {
      ...aloft,
      windLevels: [
        { altitudeM: 0, speed: 15, directionDeg: 90, stddev: 0 },
        { altitudeM: 500, speed: 2, directionDeg: 90, stddev: 0 },
      ],
    } as LaunchConditions;
    expect(launchLimitViolations(atThePad, 'model')[0]).toMatchObject({ field: 'windSpeed' });
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
    expect(launchLimitViolations(unsorted, 'model')[0]).toMatchObject({ field: 'windSpeed' });
  });

  it('leaves gusts alone', () => {
    // The codes speak about wind speed; a mean inside the limit with gusts above
    // it is a judgment call this is not equipped to make.
    expect(launchLimitViolations({ ...base, windStdDev: 50 }, 'model')).toEqual([]);
  });
});

describe('limitText', () => {
  const t = (key: string, vars: Record<string, unknown>) => `${key} ${JSON.stringify(vars)}`;
  const metric = unitSymbols(METRIC_UNITS, {});

  it('states the rule in the reader units, symbol included', () => {
    // In metric units the angle stays in degrees and the wind arrives as m/s
    // rather than the codes' own mph.
    expect(
      limitText(
        {
          field: 'rodAngle',
          value: (30.44 * Math.PI) / 180,
          limit: MAX_ROD_ANGLE_RAD.highPower,
          powerClass: 'highPower',
        },
        t,
        metric,
      ),
    ).toBe('limits.rodAngleHighPower {"value":"30.4°","limit":"20°"}');
  });

  it('names the code that sets the angle limit', () => {
    expect(
      limitText(
        { field: 'rodAngle', value: (31 * Math.PI) / 180, limit: MAX_ROD_ANGLE_RAD.model, powerClass: 'model' },
        t,
        metric,
      ),
    ).toBe('limits.rodAngleModel {"value":"31°","limit":"30°"}');
  });

  it('gives both numbers one precision, so the cap does not read as approximate', () => {
    // 20 mph is 8.9408 m/s; shown beside an 11.2 the sentence would otherwise
    // carry two decimal counts for two figures of the same kind.
    expect(
      limitText({ field: 'windSpeed', value: 11.2, limit: MAX_WIND_SPEED_MS, powerClass: 'model' }, t, metric),
    ).toBe('limits.wind {"value":"11.2 m/s","limit":"8.9 m/s"}');
  });
});

describe('the wind judged at the pad', () => {
  // A profile listed top-down (a CSV, a .ork) has the wind aloft first.
  const topDown = [
    { altitudeM: 3000, speed: 15, directionDeg: 270, stddev: 0 },
    { altitudeM: 500, speed: 6, directionDeg: 200, stddev: 0 },
    { altitudeM: 0, speed: 2, directionDeg: 90, stddev: 0 },
  ];

  it('reads the lowest altitude, not the first entry', () => {
    // 15 m/s aloft is over the limit; 2 m/s at the pad is not.
    expect(launchLimitViolations({ ...base, windLevels: topDown }, 'model')).toEqual([]);
  });

  it('judges a negative speed by its magnitude, as the kernel flies it', () => {
    expect(launchLimitViolations({ ...base, windAverage: -40 }, 'model')[0]).toMatchObject({
      field: 'windSpeed',
      value: 40,
    });
    const reversed = [{ altitudeM: 0, speed: -40, directionDeg: 90, stddev: 0 }];
    expect(launchLimitViolations({ ...base, windLevels: reversed }, 'model')[0]).toMatchObject({
      field: 'windSpeed',
      value: 40,
    });
  });

  it('reads an MSL profile at the field altitude, not at its lowest level', () => {
    // Calm at sea level, 20 m/s at 3000 m MSL: a 1500 m field sits in 10 m/s.
    const sounding = [
      { altitudeM: 0, speed: 0, directionDeg: 90, stddev: 0 },
      { altitudeM: 3000, speed: 20, directionDeg: 90, stddev: 0 },
    ];
    const v = launchLimitViolations({ ...base, launchAltitudeM: 1500, windLevels: sounding }, 'model')[0]!;
    expect(v.field).toBe('windSpeed');
    expect(v.value).toBeCloseTo(10, 10);
    // The same numbers measured from the ground put the pad in the calm.
    expect(
      launchLimitViolations(
        { ...base, launchAltitudeM: 1500, windLevels: sounding, windAltitudeReference: 'agl' },
        'model',
      ),
    ).toEqual([]);
  });
});

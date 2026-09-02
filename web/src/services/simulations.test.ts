import { describe, it, expect } from 'vitest';
import { simConditions } from './simulations';
import type { LaunchConditions } from './orkTree';

const base: LaunchConditions = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 0,
  launchRodDirectionDeg: 90,
  windAverage: 2,
  windStdDev: 0.5,
  windDirectionDeg: 45,
  launchAltitudeM: 100,
  latitudeDeg: 40,
  longitudeDeg: -105,
  temperatureC: 15,
  pressureHPa: 1013,
};

const deg2rad = (d: number) => (d * Math.PI) / 180;

describe('simConditions', () => {
  it('converts angles to radians and C→K, hPa→Pa', () => {
    const c = simConditions({ ...base, launchRodAngleDeg: 30 });
    expect(c.launchRodAngle).toBeCloseTo(deg2rad(30), 9);
    expect(c.launchRodDirection).toBeCloseTo(deg2rad(90), 9);
    expect(c.windDirection).toBeCloseTo(deg2rad(45), 9);
    expect(c.temperature).toBeCloseTo(288.15, 6);
    expect(c.pressure).toBeCloseTo(101300, 6);
    expect(c.series).toBe('summary');
  });

  it('leaves temperature/pressure undefined for the ISA standard atmosphere (null)', () => {
    const c = simConditions({ ...base, temperatureC: null, pressureHPa: null });
    expect(c.temperature).toBeUndefined();
    expect(c.pressure).toBeUndefined();
  });

  it('aims the rod into the wind when launchIntoWind is set', () => {
    const c = simConditions({ ...base, launchIntoWind: true, windDirectionDeg: 200, launchRodDirectionDeg: 10 });
    expect(c.launchRodDirection).toBeCloseTo(deg2rad(200), 9); // wind heading, not rod dir
  });

  it('prefers the surface wind level heading when aiming into the wind', () => {
    const c = simConditions({
      ...base,
      launchIntoWind: true,
      windDirectionDeg: 200,
      windLevels: [{ altitudeM: 0, speed: 3, directionDeg: 123, stddev: 0 }],
    });
    expect(c.launchRodDirection).toBeCloseTo(deg2rad(123), 9);
  });

  it('defaults a missing rod direction to 90°', () => {
    const { launchRodDirectionDeg: _omit, ...noDir } = base;
    const c = simConditions(noDir as LaunchConditions);
    expect(c.launchRodDirection).toBeCloseTo(deg2rad(90), 9);
  });

  it('maps multilevel wind to radians per level', () => {
    const c = simConditions({
      ...base,
      windLevels: [
        { altitudeM: 0, speed: 2, directionDeg: 90, stddev: 0.1 },
        { altitudeM: 500, speed: 5, directionDeg: 180, stddev: 0.2 },
      ],
    });
    expect(c.windLevels).toHaveLength(2);
    expect(c.windLevels![1]).toMatchObject({ altitude: 500, speed: 5, stddev: 0.2 });
    expect(c.windLevels![1]!.direction).toBeCloseTo(deg2rad(180), 9);
  });

  it('passes sim prefs through, normalizing a null seed to undefined', () => {
    const c = simConditions(base, { timeStep: 0.01, maxTime: 60, randomSeed: null });
    expect(c.timeStep).toBe(0.01);
    expect(c.maxTime).toBe(60);
    expect(c.randomSeed).toBeUndefined();

    const seeded = simConditions(base, { timeStep: 0.01, maxTime: 60, randomSeed: 42 });
    expect(seeded.randomSeed).toBe(42);
  });
});

import { describe, it, expect } from 'vitest';
import { simConditions, type SimPrefs } from './simulations';
import type { CompleteLaunch } from './requiredLaunch';

const base: CompleteLaunch = {
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

/** The global run preferences, as the app would hand them over. */
const PREFS: SimPrefs = {
  timeStep: 0.01,
  maxTime: 60,
  maxAngleStep: deg2rad(3),
  randomSeed: null,
  deploymentSpeedWarn: 20,
  mainHighSpeedWarn: 30.48,
  mainLowSpeedWarn: 15.24,
};

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
    const c = simConditions(noDir as CompleteLaunch);
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

  it('passes sim prefs through, minting a fresh seed when none is pinned', () => {
    const c = simConditions(base, PREFS);
    expect(c.timeStep).toBe(0.01);
    expect(c.maxTime).toBe(60);

    // NOT undefined, which is what this used to assert. An omitted key does not
    // reach the kernel as "no seed" — the bridge defaults it to the constant 42,
    // so every run of a turbulent-wind flight came back bit-identical.
    expect(c.randomSeed).toEqual(expect.any(Number));
    expect(Number.isInteger(c.randomSeed)).toBe(true);
    expect(c.randomSeed).toBeGreaterThanOrEqual(-(2 ** 31));
    expect(c.randomSeed).toBeLessThan(2 ** 31);

    // A fresh one each call, which is the whole point.
    const seeds = new Set(Array.from({ length: 20 }, () => simConditions(base, PREFS).randomSeed));
    expect(seeds.size).toBeGreaterThan(1);
  });

  /**
   * The recovery-deployment thresholds reach the KERNEL, which is what raises the
   * deployment warning. `deploymentSpeedWarn` used to be a tile color and nothing
   * else: the engine ran on its own hard-coded 20 m/s, so moving the setting
   * changed what the summary painted amber and not what the flight reported.
   */
  it('passes the deployment-warning thresholds to the engine', () => {
    const c = simConditions(base, { ...PREFS, deploymentSpeedWarn: 25, mainHighSpeedWarn: 40, mainLowSpeedWarn: 10 });
    expect(c.recoverySpeedWarn).toBe(25);
    expect(c.mainHighSpeedWarn).toBe(40);
    expect(c.mainLowSpeedWarn).toBe(10);
  });

  it('honors a pinned seed, so a run can be reproduced exactly', () => {
    const seeded = simConditions(base, { ...PREFS, randomSeed: 42 });
    expect(seeded.randomSeed).toBe(42);
    expect(simConditions(base, { ...PREFS, randomSeed: 42 }).randomSeed).toBe(42);
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { simConditions, type SimPrefs } from './simulations';
import { exportOrk, importOrk } from './orkFile';
import { specToTree } from '../engine/api';
import type { RocketSpec } from '../engine/openRocketEngine';
import type { LaunchConditions } from './orkTree';
import type { CompleteLaunch } from './requiredLaunch';

const deg2rad = (d: number) => (d * Math.PI) / 180;

const base: CompleteLaunch = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 0,
  windAverage: 4,
  windStdDev: 0.4,
  launchAltitudeM: 0,
  latitudeDeg: 28.61,
  temperatureC: null,
  pressureHPa: null,
};

const prefs: SimPrefs = {
  timeStep: 0.05,
  maxTime: 1200,
  maxAngleStep: deg2rad(3),
  randomSeed: 42,
  deploymentSpeedWarn: 20,
  mainHighSpeedWarn: 30.48,
  mainLowSpeedWarn: 15.24,
};

describe('simConditions carries the options the bridge gained', () => {
  it('omits humidity entirely when it is ISA', () => {
    // Not sent as the standard value: the bridge reads an ABSENT key as NaN and
    // only leaves standard ISA when temperature, pressure and humidity are all
    // absent. Sending 0 would look like a deliberate bone-dry launch.
    expect(simConditions(base, prefs).relativeHumidity).toBeUndefined();
  });

  it('sends humidity as the kernel fraction, not a percent', () => {
    expect(simConditions({ ...base, relativeHumidity: 0.65 }, prefs).relativeHumidity).toBe(0.65);
  });

  it('sends humidity even when temperature and pressure stay ISA', () => {
    // The case that keying the bridge off temperature/pressure alone would drop.
    const o = simConditions({ ...base, relativeHumidity: 0.8 }, prefs);
    expect(o.temperature).toBeUndefined();
    expect(o.pressure).toBeUndefined();
    expect(o.relativeHumidity).toBe(0.8);
  });

  it('passes the gravity model and its constant', () => {
    expect(simConditions(base, prefs).gravityModel).toBeUndefined(); // bridge defaults to WGS
    const o = simConditions({ ...base, gravityModel: 'constant', constantGravity: 9.81 }, prefs);
    expect(o.gravityModel).toBe('constant');
    expect(o.constantGravity).toBe(9.81);
  });

  it('passes the maximum angle step in radians', () => {
    expect(simConditions(base, prefs).maxAngleStep).toBeCloseTo(deg2rad(3), 12);
    expect(simConditions(base, { ...prefs, maxAngleStep: deg2rad(1) }).maxAngleStep).toBeCloseTo(deg2rad(1), 12);
  });

  it('leaves the angle step out when there are no prefs at all', () => {
    expect(simConditions(base).maxAngleStep).toBeUndefined();
  });
});

describe('the new launch fields round-trip through .ork', () => {
  const spec = {
    noseCone: { length: 0.1, aftRadius: 0.013, thickness: 0.001 },
    bodyTube: { length: 0.2, outerRadius: 0.013, thickness: 0.0005 },
    fins: { count: 4, rootChord: 0.06, tipChord: 0.03, sweep: 0.03, height: 0.05, thickness: 0.003 },
    motorMount: { length: 0.07, outerRadius: 0.0092, thickness: 0.0004 },
    parachute: { diameter: 0.3 },
  } as unknown as RocketSpec;
  const { tree } = specToTree(spec);
  const roundTrip = (launch: LaunchConditions) => importOrk(exportOrk({ name: 'Opts', tree, launch })).launch;

  it('carries humidity, and leaves ISA alone without it', () => {
    expect(roundTrip({ ...base, relativeHumidity: 0.65 })?.relativeHumidity).toBeCloseTo(0.65, 12);
    expect(exportOrk({ name: 'Opts', tree, launch: base })).toContain('<atmosphere model="isa"/>');
  });

  it('leaves ISA once humidity alone is set', () => {
    // Temperature and pressure are still null, so the old both-or-ISA test would
    // have written model="isa" and thrown the humidity away.
    const xml = exportOrk({ name: 'Opts', tree, launch: { ...base, relativeHumidity: 0.9 } });
    expect(xml).not.toContain('<atmosphere model="isa"/>');
    expect(xml).toContain('<relativehumidity>0.9</relativehumidity>');
  });

  it('carries a constant gravity model, and writes nothing for the default', () => {
    const back = roundTrip({ ...base, gravityModel: 'constant', constantGravity: 9.81 });
    expect(back?.gravityModel).toBe('constant');
    expect(back?.constantGravity).toBeCloseTo(9.81, 12);
    expect(exportOrk({ name: 'Opts', tree, launch: base })).not.toContain('<gravitymodel>');
  });

  it('keeps the Earth model that was chosen', () => {
    // It used to be hardcoded to spherical on the way out, so a WGS84 design
    // came back spherical.
    expect(roundTrip({ ...base, geodetic: 'wgs84' })?.geodetic).toBe('wgs84');
    expect(roundTrip({ ...base, geodetic: 'flat' })?.geodetic).toBe('flat');
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { exportOrk, importOrk } from './orkFile';
import { specToTree } from '../engine/api';
import type { RocketSpec } from '../engine/openRocketEngine';
import type { LaunchConditions } from './orkTree';

const spec = {
  noseCone: { length: 0.1, aftRadius: 0.013, thickness: 0.001 },
  bodyTube: { length: 0.2, outerRadius: 0.013, thickness: 0.0005 },
  fins: { count: 4, rootChord: 0.06, tipChord: 0.03, sweep: 0.03, height: 0.05, thickness: 0.003 },
  motorMount: { length: 0.07, outerRadius: 0.0092, thickness: 0.0004 },
  parachute: { diameter: 0.3 },
} as unknown as RocketSpec;

const { tree } = specToTree(spec);

const base: LaunchConditions = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 0,
  windAverage: 4,
  windStdDev: 0.4,
  windDirectionDeg: 90,
  launchAltitudeM: 0,
  latitudeDeg: 28.61,
  temperatureC: null,
  pressureHPa: null,
};

const roundTrip = (launch: LaunchConditions) => importOrk(exportOrk({ name: 'Wind', tree, launch })).launch;

describe('multilevel wind profile round-trips through .ork', () => {
  const profile: LaunchConditions = {
    ...base,
    windLevels: [
      { altitudeM: 0, speed: 4, directionDeg: 90, stddev: 0.4 },
      { altitudeM: 600, speed: 9, directionDeg: 120, stddev: 1.8 },
    ],
    windAltitudeReference: 'agl',
  };

  it('writes a multilevel wind element and selects it', () => {
    const xml = exportOrk({ name: 'Wind', tree, launch: profile });
    expect(xml).toContain('<wind model="multilevel">');
    expect(xml).toContain('<windmodeltype>Multilevel</windmodeltype>');
    // The average block stays as the fallback for a reader without multilevel.
    expect(xml).toContain('<wind model="average">');
  });

  it('brings the levels back, with direction in degrees again', () => {
    const back = roundTrip(profile)?.windLevels ?? [];
    expect(back).toHaveLength(2);
    back.forEach((l, i) => {
      const want = profile.windLevels![i]!;
      expect(l.altitudeM).toBe(want.altitudeM);
      expect(l.speed).toBe(want.speed);
      expect(l.stddev).toBe(want.stddev);
      // Degrees only in memory: the file stores radians, as the desktop's
      // <direction> does, so a heading comes back a float epsilon off itself.
      expect(l.directionDeg).toBeCloseTo(want.directionDeg, 10);
    });
  });

  it('carries the altitude reference', () => {
    expect(roundTrip(profile)?.windAltitudeReference).toBe('agl');
    expect(roundTrip({ ...profile, windAltitudeReference: 'msl' })?.windAltitudeReference).toBe('msl');
  });

  it('writes MSL for a profile that never set a reference', () => {
    const { windAltitudeReference: _drop, ...noRef } = profile;
    // The desktop always writes the element, so the default is made explicit on
    // the way out rather than left for the reader to assume.
    expect(roundTrip(noRef)?.windAltitudeReference).toBe('msl');
  });

  it('reads a file that omits the element as MSL', () => {
    const xml = exportOrk({ name: 'Wind', tree, launch: profile }).replace(
      /<altitudereference>.*?<\/altitudereference>/,
      '',
    );
    // Absent means MSL to the kernel, and an absent value reaches the bridge
    // and the editor as exactly that.
    expect(importOrk(xml).launch?.windAltitudeReference).toBeUndefined();
  });

  it('still writes the average model when there is no profile', () => {
    const xml = exportOrk({ name: 'Wind', tree, launch: base });
    expect(xml).toContain('<windmodeltype>Average</windmodeltype>');
    expect(xml).not.toContain('model="multilevel"');
    expect(roundTrip(base)?.windLevels).toBeUndefined();
  });

  it('keeps writing the legacy turbulence ratio for pre-24 desktops', () => {
    // 0.4 / 4 = 0.1, the INTENSITY rather than the m/s deviation.
    expect(exportOrk({ name: 'Wind', tree, launch: base })).toContain('<windturbulence>0.1</windturbulence>');
  });
});

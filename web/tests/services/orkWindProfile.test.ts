// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { exportOrk, importOrk } from '../../src/services/orkFile';
import { specToTree } from '../../src/engine/api';
import type { RocketSpec } from '../../src/engine/openRocketEngine';
import type { LaunchConditions } from '../../src/services/orkTree';

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
  longitudeDeg: -80.6,
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
    // The altitude reference rides on the element as an attribute, the only
    // place the desktop reads it (OpenRocketSaver.java:367, WindHandler.java:25).
    expect(xml).toContain('<wind model="multilevel" altituderef="AGL">');
    expect(xml).not.toContain('<altitudereference>');
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

  it('reads a file that omits the attribute as MSL', () => {
    const xml = exportOrk({ name: 'Wind', tree, launch: profile }).replace(/ altituderef="AGL"/, '');
    // Absent means MSL to the kernel, and an absent value reaches the bridge
    // and the editor as exactly that.
    expect(importOrk(xml).launch?.windAltitudeReference).toBeUndefined();
  });

  /**
   * A hand-written fragment in the desktop's EXACT form. The reader used to
   * look for a child <altitudereference> element or an attribute of another
   * name, so every AGL profile the desktop saved came in as MSL, which at a
   * 1500 m site is a different wind entirely.
   */
  it('reads the altitude reference from the attribute the desktop writes', () => {
    const desktop = (ref: string) =>
      `<openrocket version="1.10" creator="OpenRocket 24.12"><rocket><name>W</name><subcomponents><stage><name>S</name>` +
      `<subcomponents><bodytube><name>B</name><length>0.3</length><radius>0.012</radius></bodytube></subcomponents>` +
      `</stage></subcomponents></rocket><simulations><simulation status="notsimulated"><name>Simulation 1</name>` +
      `<simulator>RK4Simulator</simulator><calculator>BarrowmanCalculator</calculator><conditions>` +
      `<wind model="average"><speed>2.0</speed><direction>1.5707963267948966</direction><standarddeviation>0.2</standarddeviation></wind>` +
      `<wind model="multilevel" altituderef="${ref}">` +
      `<windlevel altitude="0.0" speed="2.0" direction="1.5707963267948966" standarddeviation="0.2"/>` +
      `<windlevel altitude="500.0" speed="6.0" direction="2.0943951023931953" standarddeviation="1.2"/>` +
      `</wind><windmodeltype>MultiLevel</windmodeltype><atmosphere model="isa"/></conditions></simulation></simulations></openrocket>`;
    expect(importOrk(desktop('AGL')).launch?.windAltitudeReference).toBe('agl');
    expect(importOrk(desktop('MSL')).launch?.windAltitudeReference).toBe('msl');
    expect(importOrk(desktop('AGL')).launch?.windLevels).toHaveLength(2);
  });

  it('still reads the child element this app wrote before it matched the desktop', () => {
    const xml = exportOrk({ name: 'Wind', tree, launch: profile }).replace(
      ' altituderef="AGL">',
      '><altitudereference>AGL</altitudereference>',
    );
    expect(importOrk(xml).launch?.windAltitudeReference).toBe('agl');
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

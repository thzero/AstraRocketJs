import { describe, it, expect } from 'vitest';
import {
  REQUIRED_LAUNCH_KEYS,
  isComplete,
  isFilled,
  missingRequired,
  withRequiredFrom,
  type CompleteLaunch,
} from '../../../src/services/flight/requiredLaunch';

const full: CompleteLaunch = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 0,
  windAverage: 4,
  windStdDev: 0.4,
  launchAltitudeM: 0,
  latitudeDeg: 28.61,
  longitudeDeg: -80.6,
  temperatureC: null,
  pressureHPa: null,
};

describe('isFilled', () => {
  it('counts zero as filled, because six of the seven are legitimately zero', () => {
    // Rod angle straight up, still air, no gusts, sea level, the equator, the prime meridian.
    expect(isFilled(0)).toBe(true);
    expect(isFilled(-3)).toBe(true);
  });

  it('rejects the ways a field can be absent', () => {
    expect(isFilled(null)).toBe(false);
    expect(isFilled(undefined)).toBe(false);
    expect(isFilled(NaN)).toBe(false);
    expect(isFilled(Infinity)).toBe(false);
  });
});

describe('missingRequired', () => {
  it('finds nothing on a complete launch', () => {
    expect(missingRequired(full)).toEqual([]);
    expect(isComplete(full)).toBe(true);
  });

  it('names each blank, and does NOT mistake a zero for one', () => {
    const l = { ...full, launchRodLengthM: null, windAverage: 0, latitudeDeg: null };
    expect(missingRequired(l)).toEqual(['launchRodLengthM', 'latitudeDeg']);
    expect(isComplete(l)).toBe(false);
  });

  it('does not require the single wind under a multilevel profile', () => {
    // SimulationOptions.getWindModel flies MultiLevelPinkNoiseWindModel and
    // never reads the average model while the profile is selected.
    const l = {
      ...full,
      windAverage: null,
      windStdDev: null,
      windLevels: [{ altitudeM: 0, speed: 3, directionDeg: 90, stddev: 0.3 }],
    };
    expect(missingRequired(l)).toEqual([]);
    expect(isComplete(l)).toBe(true);
    // The other required fields still count.
    expect(missingRequired({ ...l, latitudeDeg: null })).toEqual(['latitudeDeg']);
  });

  it('requires the single wind again once the profile is empty', () => {
    const l = { ...full, windAverage: null, windStdDev: null, windLevels: [] };
    expect(missingRequired(l)).toEqual(['windAverage', 'windStdDev']);
  });

  it('reports in panel order however the object was built', () => {
    const l = { ...full, latitudeDeg: null, launchRodAngleDeg: null };
    expect(missingRequired(l)).toEqual(['launchRodAngleDeg', 'latitudeDeg']);
  });

  it('covers exactly the seven non-optional keys', () => {
    expect([...REQUIRED_LAUNCH_KEYS]).toEqual([
      'launchRodLengthM',
      'launchRodAngleDeg',
      'windAverage',
      'windStdDev',
      'launchAltitudeM',
      'latitudeDeg',
      // Longitude is required like latitude: 0° is a real meridian, not "unset".
      'longitudeDeg',
    ]);
  });
});

describe('withRequiredFrom', () => {
  it('fills only the blanks, and leaves real values alone', () => {
    const edited = { ...full, launchRodLengthM: null, windAverage: 9 };
    const out = withRequiredFrom(edited, full);
    expect(out.launchRodLengthM).toBe(full.launchRodLengthM); // restored
    expect(out.windAverage).toBe(9); // kept
    expect(isComplete(out)).toBe(true);
  });

  it('keeps a deliberate zero rather than treating it as missing', () => {
    const out = withRequiredFrom({ ...full, windAverage: 0 }, { ...full, windAverage: 7 });
    expect(out.windAverage).toBe(0);
  });

  it('passes optional fields through untouched', () => {
    const out = withRequiredFrom({ ...full, geodetic: 'wgs84', temperatureC: null }, full);
    expect(out.geodetic).toBe('wgs84');
    expect(out.temperatureC).toBeNull(); // null here means ISA, not missing
  });
});

import { describe, it, expect } from 'vitest';
import { launchDiffKeys, prefDiffKeys } from './simDiff';
import type { Simulation } from './simulations';
import type { LaunchConditions } from './orkTree';

const launch: LaunchConditions = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 0,
  windAverage: 4,
  windStdDev: 0.4,
  launchAltitudeM: 0,
  latitudeDeg: 28.61,
  temperatureC: null,
  pressureHPa: null,
};

const C6 = { designation: 'C6' } as Simulation['motor'];

const sim = (over: Partial<Simulation> = {}): Simulation =>
  ({
    id: Math.random().toString(36),
    name: 'S',
    motor: C6,
    launch,
    result: null,
    extraMotors: {},
    ...over,
  }) as Simulation;

describe('launchDiffKeys', () => {
  it('finds nothing for a single simulation', () => {
    expect(launchDiffKeys([sim()]).size).toBe(0);
  });

  it('finds nothing when the selection agrees', () => {
    expect(launchDiffKeys([sim(), sim(), sim()]).size).toBe(0);
  });

  it('names only the keys that actually differ', () => {
    const a = sim();
    const b = sim({ launch: { ...launch, windAverage: 9 } });
    const keys = launchDiffKeys([a, b]);
    expect([...keys]).toEqual(['windAverage']);
  });

  it('treats null and undefined alike, since both mean not set', () => {
    // temperatureC is null for ISA; an older workspace may lack the key.
    const a = sim({ launch: { ...launch, temperatureC: null } });
    const { temperatureC: _drop, ...noKey } = launch;
    const b = sim({ launch: noKey as LaunchConditions });
    expect(launchDiffKeys([a, b]).has('temperatureC')).toBe(false);
  });

  it('compares wind levels deeply, and by order', () => {
    const lo = { altitudeM: 0, speed: 3, directionDeg: 90, stddev: 0 };
    const hi = { altitudeM: 500, speed: 9, directionDeg: 90, stddev: 0 };
    const a = sim({ launch: { ...launch, windLevels: [lo, hi] } });
    const b = sim({ launch: { ...launch, windLevels: [lo, hi] } });
    expect(launchDiffKeys([a, b]).has('windLevels')).toBe(false);

    // The list is not kept sorted, so order is meaningful.
    const c = sim({ launch: { ...launch, windLevels: [hi, lo] } });
    expect(launchDiffKeys([a, c]).has('windLevels')).toBe(true);
  });

  it('notices a key one simulation has and another lacks', () => {
    const a = sim({ launch: { ...launch, gravityModel: 'constant' } });
    expect(launchDiffKeys([a, sim()]).has('gravityModel')).toBe(true);
  });
});

describe('prefDiffKeys', () => {
  it('is empty when both fall through to the globals', () => {
    expect(prefDiffKeys([sim(), sim()]).size).toBe(0);
  });

  it('flags an override against no override', () => {
    const a = sim({ prefs: { timeStep: 0.01 } });
    expect([...prefDiffKeys([a, sim()])]).toEqual(['timeStep']);
  });

  it('agrees when both pin the same value', () => {
    const a = sim({ prefs: { timeStep: 0.01 } });
    const b = sim({ prefs: { timeStep: 0.01 } });
    expect(prefDiffKeys([a, b]).size).toBe(0);
  });
});

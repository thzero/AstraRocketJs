import { describe, it, expect } from 'vitest';
import { hasThrustCurve, unflyable, unflyableSims, unflyableText } from './runnability';
import { MAX_ROD_ANGLE_DEG, MAX_WIND_SPEED_MS } from './safetyLimits';
import { METRIC_UNITS, unitSymbols } from '../prefs/units';

/** The reader's units, which every limit sentence is now rendered in. */
const units = unitSymbols(METRIC_UNITS, {});
import type { Simulation } from './simulations';
import type { LaunchConditions } from './orkTree';

const launch: LaunchConditions = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 0,
  windAverage: 0,
  windStdDev: 0,
  launchAltitudeM: 0,
  latitudeDeg: 28.61,
  longitudeDeg: -80.6,
  temperatureC: null,
  pressureHPa: null,
};

const CURVE = { designation: 'C6', times: [0, 1], thrusts: [0, 5], masses: [0.02, 0.01] };

const sim = (name: string, over: Partial<Simulation> = {}): Simulation =>
  ({ id: name, name, motor: CURVE, launch, result: null, extraMotors: {}, ...over }) as unknown as Simulation;

const t = (key: string, vars?: Record<string, unknown>) =>
  `${key}${
    vars
      ? `(${Object.entries(vars)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(',')})`
      : ''
  }`;

describe('hasThrustCurve', () => {
  it('needs all three sample arrays', () => {
    expect(hasThrustCurve(CURVE as never)).toBe(true);
    expect(hasThrustCurve(null)).toBe(false);
    expect(hasThrustCurve({ ...CURVE, thrusts: [] } as never)).toBe(false);
    expect(hasThrustCurve({ ...CURVE, masses: [] } as never)).toBe(false);
  });
});

describe('unflyable', () => {
  it('passes a simulation with a real motor and legal conditions', () => {
    expect(unflyable(sim('ok'))).toBeNull();
  });

  it('reports a curve-less motor, which an unresolved .ork import leaves behind', () => {
    expect(unflyable(sim('x', { motor: { designation: 'M' } as never }))?.kind).toBe('noMotor');
  });

  it('reports launch conditions outside the safety codes', () => {
    const hot = sim('x', { launch: { ...launch, windAverage: MAX_WIND_SPEED_MS + 1 } });
    const r = unflyable(hot);
    expect(r?.kind).toBe('limits');
    expect(r && r.kind === 'limits' && r.violations[0]!.field).toBe('windSpeed');
  });

  it('refuses a simulation with a blank required field', () => {
    // The field used to coerce a cleared box to 0, so this state could not
    // exist and an empty rod length flew as a zero-length rod.
    const r = unflyable(sim('x', { launch: { ...launch, launchRodLengthM: null } }));
    expect(r?.kind).toBe('incomplete');
    expect(r && r.kind === 'incomplete' && r.missing).toEqual(['launchRodLengthM']);
  });

  it('does NOT refuse a legitimate zero', () => {
    // Still air, no gusts, sea level, the equator, rod straight up.
    const zeros = sim('x', {
      launch: { ...launch, windAverage: 0, windStdDev: 0, launchAltitudeM: 0, latitudeDeg: 0, launchRodAngleDeg: 0 },
    });
    expect(unflyable(zeros)).toBeNull();
  });

  it('checks completeness BEFORE the safety codes', () => {
    // A blank rod angle is not "within 20 degrees of vertical"; it is nothing
    // to judge, so the missing field is the useful thing to report.
    const r = unflyable(sim('x', { launch: { ...launch, launchRodAngleDeg: null, windAverage: 99 } }));
    expect(r?.kind).toBe('incomplete');
  });

  it('reports the missing motor FIRST, since conditions are moot without one', () => {
    const both = sim('x', {
      motor: { designation: 'M' } as never,
      launch: { ...launch, launchRodAngleDeg: MAX_ROD_ANGLE_DEG + 10 },
    });
    expect(unflyable(both)?.kind).toBe('noMotor');
  });
});

describe('unflyableSims', () => {
  it('names only the rows that cannot fly, in order', () => {
    const rows = [
      sim('A'),
      sim('B', { motor: { designation: 'M' } as never }),
      sim('C'),
      sim('D', { launch: { ...launch, launchRodAngleDeg: 45 } }),
    ];
    expect(unflyableSims(rows).map((u) => u.name)).toEqual(['B', 'D']);
  });

  it('is empty when every row can fly', () => {
    expect(unflyableSims([sim('A'), sim('B')])).toEqual([]);
  });
});

describe('unflyableText', () => {
  it('names the simulation, so a batch message says which row it means', () => {
    const [bad] = unflyableSims([sim('Sustainer', { motor: { designation: 'M' } as never })]);
    expect(unflyableText(bad!, t, units)).toContain('name=Sustainer');
  });

  it('names the blank fields so the message points at what to fill', () => {
    const [bad] = unflyableSims([
      sim('Half done', { launch: { ...launch, launchRodLengthM: null, latitudeDeg: null } }),
    ]);
    const msg = unflyableText(bad!, t, units);
    expect(msg).toContain('sim.incomplete');
    expect(msg).toContain('Half done');
    expect(msg).toContain('launch.field.launchRodLengthM');
    expect(msg).toContain('launch.field.latitudeDeg');
  });

  it('spells out each limit that was broken', () => {
    const [bad] = unflyableSims([sim('Windy', { launch: { ...launch, windAverage: MAX_WIND_SPEED_MS + 5 } })]);
    const msg = unflyableText(bad!, t, units);
    expect(msg).toContain('limits.refused');
    expect(msg).toContain('limits.wind');
  });
});

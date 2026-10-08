import { describe, it, expect } from 'vitest';
import { hasThrustCurve, unflyable, unflyableSims, unflyableText } from '../../../src/services/flight/runnability';
import { MAX_ROD_ANGLE_DEG, MAX_WIND_SPEED_MS } from '../../../src/services/flight/safetyLimits';
import { METRIC_UNITS, unitSymbols } from '../../../src/prefs/units';

/** The reader's units, which every limit sentence is rendered in. */
const units = unitSymbols(METRIC_UNITS, {});
import type { Simulation } from '../../../src/services/flight/simulations';
import type { MotorSpec } from '../../../src/engine/openRocketEngine';
import type { LaunchConditions } from '../../../src/services/design/orkTree';

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

/**
 * A row, with the motor it is judged by hanging off it.
 *
 * The gate takes the motor as an argument because it lives in the row's
 * flight configuration rather than on the row; carrying it here keeps each case
 * readable as one object.
 */
type Row = Simulation & { motor?: MotorSpec };

const sim = (name: string, over: Partial<Row> = {}): Row =>
  ({ id: name, name, motor: CURVE, launch, result: null, ...over }) as unknown as Row;

const gate = (s: Row) => unflyable(s, s.motor);
const gateAll = (rows: Row[]) => unflyableSims(rows, (r) => (r as Row).motor);

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
    expect(gate(sim('ok'))).toBeNull();
  });

  it('reports a curve-less motor, which an unresolved .ork import leaves behind', () => {
    expect(gate(sim('x', { motor: { designation: 'M' } as never }))?.kind).toBe('noMotor');
  });

  /**
   * The kernel keys its wind levels on altitude and throws on the second one at a
   * given height, so left to `simulate()` this comes back as `engine simulate
   * failed: Wind level already exists for altitude: 0.0` -- after the design is
   * built, in the kernel's words, for something the profile editor let the user
   * type. The gate names it before the run starts.
   */
  it('refuses a wind profile with two levels at one altitude', () => {
    const doubled = sim('x', {
      launch: {
        ...launch,
        windLevels: [
          { altitudeM: 0, speed: 4, directionDeg: 90, stddev: 0 },
          { altitudeM: 0, speed: 9, directionDeg: 120, stddev: 0 },
        ],
      },
    });
    expect(gate(doubled)?.kind).toBe('windProfile');
    expect(unflyableText({ id: 'x', name: 'Windy', reason: { kind: 'windProfile' } }, t, units)).toContain(
      'sim.windProfile',
    );
  });

  it('passes a profile with one level per altitude', () => {
    const fine = sim('x', {
      launch: {
        ...launch,
        windLevels: [
          { altitudeM: 0, speed: 4, directionDeg: 90, stddev: 0 },
          { altitudeM: 600, speed: 9, directionDeg: 120, stddev: 0 },
        ],
      },
    });
    expect(gate(fine)).toBeNull();
  });

  it('reports launch conditions outside the safety codes', () => {
    const hot = sim('x', { launch: { ...launch, windAverage: MAX_WIND_SPEED_MS + 1 } });
    const r = gate(hot);
    expect(r?.kind).toBe('limits');
    expect(r && r.kind === 'limits' && r.violations[0]!.field).toBe('windSpeed');
  });

  it('refuses a simulation with a blank required field', () => {
    // A field that coerces a cleared box to 0 cannot reach this state, and an
    // empty rod length flies as a zero-length rod.
    const r = gate(sim('x', { launch: { ...launch, launchRodLengthM: null } }));
    expect(r?.kind).toBe('incomplete');
    expect(r && r.kind === 'incomplete' && r.missing).toEqual(['launchRodLengthM']);
  });

  it('does NOT refuse a legitimate zero', () => {
    // Still air, no gusts, sea level, the equator, rod straight up.
    const zeros = sim('x', {
      launch: { ...launch, windAverage: 0, windStdDev: 0, launchAltitudeM: 0, latitudeDeg: 0, launchRodAngleDeg: 0 },
    });
    expect(gate(zeros)).toBeNull();
  });

  it('checks completeness BEFORE the safety codes', () => {
    // A blank rod angle is not "within 20 degrees of vertical"; it is nothing
    // to judge, so the missing field is the useful thing to report.
    const r = gate(sim('x', { launch: { ...launch, launchRodAngleDeg: null, windAverage: 99 } }));
    expect(r?.kind).toBe('incomplete');
  });

  it('reports the missing motor FIRST, since conditions are moot without one', () => {
    const both = sim('x', {
      motor: { designation: 'M' } as never,
      launch: { ...launch, launchRodAngleDeg: MAX_ROD_ANGLE_DEG + 10 },
    });
    expect(gate(both)?.kind).toBe('noMotor');
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
    expect(gateAll(rows).map((u) => u.name)).toEqual(['B', 'D']);
  });

  it('is empty when every row can fly', () => {
    expect(gateAll([sim('A'), sim('B')])).toEqual([]);
  });
});

describe('unflyableText', () => {
  it('names the simulation, so a batch message says which row it means', () => {
    const [bad] = gateAll([sim('Sustainer', { motor: { designation: 'M' } as never })]);
    expect(unflyableText(bad!, t, units)).toContain('name=Sustainer');
  });

  it('names the blank fields so the message points at what to fill', () => {
    const [bad] = gateAll([sim('Half done', { launch: { ...launch, launchRodLengthM: null, latitudeDeg: null } })]);
    const msg = unflyableText(bad!, t, units);
    expect(msg).toContain('sim.incomplete');
    expect(msg).toContain('Half done');
    expect(msg).toContain('launch.field.launchRodLengthM');
    expect(msg).toContain('launch.field.latitudeDeg');
  });

  it('spells out each limit that was broken', () => {
    const [bad] = gateAll([sim('Windy', { launch: { ...launch, windAverage: MAX_WIND_SPEED_MS + 5 } })]);
    const msg = unflyableText(bad!, t, units);
    expect(msg).toContain('limits.refused');
    expect(msg).toContain('limits.wind');
  });
});

import { describe, it, expect } from 'vitest';
import type { FlightResult, FlightSeries } from '../engine/openRocketEngine';
import { dynamicPressure, eventRows, maxQ, MAX_Q } from './flightEvents';

/**
 * The timeline join and the dynamic-pressure peak. Both are pure, so the two
 * things that could quietly go wrong — sampling the wrong series at an event
 * time, and computing q from ground speed instead of airspeed — are provable
 * without mounting the table.
 */

/** A branch whose series are flat enough to assert exact sampled values. */
function series(over: Partial<FlightSeries> = {}): FlightSeries {
  return {
    time: [0, 1, 2, 3],
    altitude: [0, 100, 200, 300],
    velocity: [0, 10, 20, 30],
    acceleration: [0, 0, 0, 0],
    mass: [1, 1, 1, 1],
    thrust: [0, 0, 0, 0],
    drag: [0, 0, 0, 0],
    mach: [0, 0.1, 0.2, 0.3],
    stability: [2, 2, 2, 2],
    cpLocation: [0.5, 0.5, 0.5, 0.5],
    cgLocation: [0.4, 0.4, 0.4, 0.4],
    aoa: [0, 0, 0, 0],
    ...over,
  };
}

const result = (over: Partial<FlightResult>): FlightResult =>
  ({ summary: {}, events: [], series: series(), ...over }) as FlightResult;

describe('dynamicPressure', () => {
  it('is null when the run recorded no air density (a `summary` series set)', () => {
    expect(dynamicPressure(series({ Vs: [340, 340, 340, 340] }))).toBeNull();
  });

  it('is null when the run recorded no speed of sound', () => {
    expect(dynamicPressure(series({ ρ: [1.2, 1.2, 1.2, 1.2] }))).toBeNull();
  });

  it('computes 0.5 * rho * v^2 from the AIRSPEED, not the ground-frame velocity', () => {
    // velocity (over the ground) is 20 m/s at t=2, but mach * Vs makes the
    // airspeed 0.2 * 340 = 68 m/s — the wind-relative number q is a property of.
    const qs = dynamicPressure(series({ ρ: [1.2, 1.2, 1.2, 1.2], Vs: [340, 340, 340, 340] }))!;
    expect(qs[2]).toBeCloseTo(0.5 * 1.2 * 68 * 68, 6);
    // Using `velocity` would have given 240, which is what this guards against.
    expect(qs[2]).not.toBeCloseTo(0.5 * 1.2 * 20 * 20, 6);
  });

  it('leaves a sample null where the branch has a gap rather than guessing', () => {
    const qs = dynamicPressure(series({ ρ: [1.2, null, 1.2, 1.2], Vs: [340, 340, 340, 340] }))!;
    expect(qs[1]).toBeNull();
    expect(qs[2]).not.toBeNull();
  });
});

describe('maxQ', () => {
  it('returns the peak sample and the state at it', () => {
    // Density falls as it climbs while airspeed rises, so q peaks in the
    // MIDDLE of the branch rather than at either end - which is the whole
    // reason max-Q is a number worth reporting.
    const s = series({ ρ: [1.2, 1.2, 0.6, 0.1], Vs: [340, 340, 340, 340] });
    const peak = maxQ(s)!;
    expect(peak.time).toBe(2);
    expect(peak.q).toBeCloseTo(0.5 * 0.6 * 68 * 68, 6);
    expect(peak.altitude).toBe(200);
    expect(peak.mach).toBe(0.2);
    expect(peak.velocity).toBeCloseTo(68, 6);
  });

  it('is null when q cannot be computed at all', () => {
    expect(maxQ(series())).toBeNull();
  });
});

describe('eventRows', () => {
  it('drops the diagnostics and internal triggers, keeping the real moments', () => {
    const rows = eventRows(
      result({
        events: [
          { type: 'LIFTOFF', time: 0 },
          { type: 'SIM_WARN', time: 0.5 },
          { type: 'ALTITUDE', time: 1 },
          { type: 'APOGEE', time: 2 },
        ],
      }),
    );
    expect(rows.map((r) => r.type)).toEqual(['LIFTOFF', 'APOGEE']);
  });

  it('samples every series at the event time, interpolating between steps', () => {
    const rows = eventRows(result({ events: [{ type: 'APOGEE', time: 1.5 }] }));
    expect(rows[0]!.altitude).toBeCloseTo(150, 6);
    expect(rows[0]!.velocity).toBeCloseTo(15, 6);
    expect(rows[0]!.mach).toBeCloseTo(0.15, 6);
    expect(rows[0]!.stability).toBe(2);
  });

  it('leaves an unrecorded series null rather than zero', () => {
    // Twr is a `full`-only series; this branch has none.
    expect(eventRows(result({ events: [{ type: 'LAUNCHROD', time: 1 }] }))[0]!.twr).toBeNull();
  });

  it('carries the source component, so a drogue is told from a main', () => {
    const rows = eventRows(
      result({
        events: [
          { type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 2, source: 'Drogue' },
          { type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 3, source: 'Main' },
        ],
      }),
    );
    expect(rows.map((r) => r.source)).toEqual(['Drogue', 'Main']);
  });

  it('interleaves every branch on the one launch clock, tagged with its stage', () => {
    const rows = eventRows(
      result({
        branches: [
          { name: 'Sustainer', events: [{ type: 'APOGEE', time: 2 }], series: series() },
          { name: 'Booster', events: [{ type: 'GROUND_HIT', time: 1 }], series: series() },
        ],
      }),
    );
    expect(rows.map((r) => [r.type, r.branchName])).toEqual([
      ['GROUND_HIT', 'Booster'],
      ['APOGEE', 'Sustainer'],
    ]);
  });

  it('adds Max-Q on the stack only, never on a spent booster', () => {
    const s = series({ ρ: [1.2, 1.2, 0.6, 0.1], Vs: [340, 340, 340, 340] });
    const rows = eventRows(
      result({
        branches: [
          { name: 'Sustainer', events: [], series: s },
          { name: 'Booster', events: [], series: s },
        ],
      }),
    );
    expect(rows.filter((r) => r.type === MAX_Q).map((r) => r.branch)).toEqual([0]);
    expect(rows[0]!.q).toBeCloseTo(0.5 * 0.6 * 68 * 68, 6);
  });

  it('keeps two same-instant burnouts apart, as a cluster of separate mounts gives', () => {
    // The kernel queues one BURNOUT per motor at the same time when a stage's
    // motors are in separate mounts, so branch, type and time do not identify
    // a row and a key built from those alone would collide.
    const rows = eventRows(
      result({
        events: [
          { type: 'BURNOUT', time: 1.6, source: 'Outboard 1' },
          { type: 'BURNOUT', time: 1.6, source: 'Outboard 2' },
        ],
      }),
    );
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    expect(rows.map((r) => r.source)).toEqual(['Outboard 1', 'Outboard 2']);
  });

  it('has no Max-Q row when the result predates the full series set', () => {
    const rows = eventRows(result({ events: [{ type: 'APOGEE', time: 2 }] }));
    expect(rows.some((r) => r.type === MAX_Q)).toBe(false);
  });

  it('is empty without a result, so the table can mount before a run', () => {
    expect(eventRows(null)).toEqual([]);
  });
});

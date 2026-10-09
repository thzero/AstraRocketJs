import { describe, it, expect } from 'vitest';
import { deviceDescent, sustainerDescentMass } from '../../../src/services/flight/recoveryFlown';
import type { FlightResult } from '../../../src/engine/openRocketEngine';

/**
 * Reading a run's own figures for a recovery device.
 *
 * The point of this module is that nothing in it computes: the mass and the
 * descent speed are read out of the kernel's series at the time of the kernel's
 * events. So the cases below are about which sample gets read, which is the only
 * decision there is to get wrong.
 */

/** A branch descending under a drogue, then a main, then landing. */
const branch = (name: string, mass: number) => ({
  name,
  events: [
    { type: 'LAUNCH', time: 0 },
    { type: 'APOGEE', time: 5 },
    { type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 5, source: 'Drogue' },
    { type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 15, source: 'Main' },
    { type: 'GROUND_HIT', time: 25 },
  ],
  series: {
    // Mass steps down at apogee so a wrong sample shows as a wrong number.
    time: [0, 5, 10, 15, 20, 25],
    mass: [mass + 0.02, mass, mass, mass, mass, mass],
    // Still slowing right after each opening; settled by the end of each phase.
    velocity: [0, -2, -20, -19, -6, -5.5],
  },
});

const single = (): FlightResult =>
  ({
    summary: {},
    ...branch('', 0.4),
  }) as unknown as FlightResult;

/** A staged flight: the sustainer, plus a booster with its own lighter branch. */
const staged = (): FlightResult =>
  ({
    summary: {},
    ...branch('Sustainer', 0.4),
    branches: [branch('Sustainer', 0.4), { ...branch('Booster', 0.15), events: boosterEvents() }],
  }) as unknown as FlightResult;

const boosterEvents = () => [
  { type: 'STAGE_SEPARATION', time: 3 },
  { type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 5, source: 'Booster chute' },
  { type: 'GROUND_HIT', time: 25 },
];

describe('deviceDescent', () => {
  it('reads the mass the kernel had under that device, not the loaded mass', () => {
    const d = deviceDescent(single(), 'Drogue');
    expect(d?.mass).toBeCloseTo(0.4, 12);
  });

  /**
   * The settled rate, at the end of the device's own phase. Sampled at the
   * opening instead it would report the speed the rocket was still slowing from:
   * -2 m/s at apogee under the drogue, which is not a descent rate.
   */
  it('reads the settled rate at the end of the phase, not at the opening', () => {
    expect(deviceDescent(single(), 'Drogue')?.rate).toBeCloseTo(19, 12);
    expect(deviceDescent(single(), 'Main')?.rate).toBeCloseTo(5.5, 12);
  });

  it('reports a speed, not the negative the series carries on the way down', () => {
    expect(deviceDescent(single(), 'Main')?.rate).toBeGreaterThan(0);
  });

  it('carries the kernel event time', () => {
    expect(deviceDescent(single(), 'Drogue')?.time).toBe(5);
  });

  it('has no branch name to give for a single-branch flight', () => {
    expect(deviceDescent(single(), 'Drogue')?.branch).toBe('');
  });

  /**
   * The case the design-side estimate cannot get right: a separated booster
   * descends on its own branch, so its mass is its own rather than the stack's.
   */
  it('reads a booster from its own branch', () => {
    const b = deviceDescent(staged(), 'Booster chute');
    expect(b?.branch).toBe('Booster');
    expect(b?.mass).toBeCloseTo(0.15, 12);
    const s = deviceDescent(staged(), 'Drogue');
    expect(s?.branch).toBe('Sustainer');
    expect(s?.mass).toBeCloseTo(0.4, 12);
  });

  it('answers nothing for a device the run never deployed', () => {
    expect(deviceDescent(single(), 'Not fitted')).toBeNull();
  });

  it('answers nothing without a run, or without a name to match', () => {
    expect(deviceDescent(null, 'Drogue')).toBeNull();
    expect(deviceDescent(single(), '')).toBeNull();
  });

  /** A run that recorded no mass series has nothing to report rather than a zero. */
  it('answers nothing when the run carries no mass series', () => {
    const r = single() as unknown as { series: Record<string, unknown> };
    delete r.series.mass;
    expect(deviceDescent(r as unknown as FlightResult, 'Drogue')).toBeNull();
  });

  /** Falls back to the last sample when the flight recorded no end to the phase. */
  it('uses the last sample when nothing ends the phase', () => {
    const r = single() as unknown as { events: { type: string; time: number; source?: string }[] };
    r.events = [{ type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 5, source: 'Main' }];
    expect(deviceDescent(r as unknown as FlightResult, 'Main')?.rate).toBeCloseTo(5.5, 12);
  });
});

describe('sustainerDescentMass', () => {
  it('reads the first deployment on the first branch', () => {
    expect(sustainerDescentMass(single())).toBeCloseTo(0.4, 12);
    // The booster's own branch is lighter; the tile is about the sustainer.
    expect(sustainerDescentMass(staged())).toBeCloseTo(0.4, 12);
  });

  it('answers nothing for a flight with no recovery device', () => {
    const r = single() as unknown as { events: { type: string; time: number }[] };
    r.events = [{ type: 'GROUND_HIT', time: 25 }];
    expect(sustainerDescentMass(r as unknown as FlightResult)).toBeNull();
  });

  it('answers nothing without a run', () => {
    expect(sustainerDescentMass(null)).toBeNull();
  });
});

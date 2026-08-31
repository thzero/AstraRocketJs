import { describe, it, expect } from 'vitest';
import { samplesToMotorSpec } from './thrustcurve';

// samplesToMotorSpec's TcMotor param is module-internal; build a shaped literal.
const motor = (over: Record<string, unknown> = {}) =>
  ({
    motorId: 'x',
    designation: 'C6',
    commonName: 'C6',
    manufacturerAbbrev: 'Estes',
    diameter: 18, // mm
    length: 70, // mm
    totalWeightG: 20,
    propWeightG: 10,
    availability: 'regular',
    ...over,
  }) as never;

describe('samplesToMotorSpec', () => {
  it('converts mm→m and sets cg at half length', () => {
    const spec = samplesToMotorSpec(motor(), [{ time: 0, thrust: 10 }, { time: 1, thrust: 10 }], 5);
    expect(spec.diameter).toBeCloseTo(0.018, 9);
    expect(spec.length).toBeCloseTo(0.07, 9);
    expect(spec.cgX).toBeCloseTo(0.035, 9);
    expect(spec.ejectionDelay).toBe(5);
    expect(spec.manufacturer).toBe('Estes');
  });

  it('interpolates mass from loaded down to burnout proportional to cumulative impulse', () => {
    const spec = samplesToMotorSpec(motor(), [{ time: 0, thrust: 10 }, { time: 1, thrust: 10 }], 0);
    expect(spec.masses[0]).toBeCloseTo(0.02, 9); // loaded mass
    expect(spec.masses[spec.masses.length - 1]).toBeCloseTo(0.01, 9); // loaded − prop
  });

  it('prepends a {0,0} sample when the curve does not start at t=0', () => {
    const spec = samplesToMotorSpec(motor(), [{ time: 0.5, thrust: 10 }, { time: 1, thrust: 10 }], 0);
    expect(spec.times[0]).toBe(0);
    expect(spec.thrusts[0]).toBe(0);
    expect(spec.times).toHaveLength(3);
  });

  it('sorts unordered samples by time', () => {
    const spec = samplesToMotorSpec(motor(), [{ time: 1, thrust: 10 }, { time: 0, thrust: 0 }], 0);
    expect(spec.times).toEqual([0, 1]);
  });

  it('keeps mass constant when total impulse is zero', () => {
    const spec = samplesToMotorSpec(motor(), [{ time: 0, thrust: 0 }, { time: 1, thrust: 0 }], 0);
    expect(spec.masses.every((m) => Math.abs(m - 0.02) < 1e-12)).toBe(true);
  });

  it('throws with no samples', () => {
    expect(() => samplesToMotorSpec(motor(), [], 0)).toThrow(/no thrust samples/i);
  });

  it('throws on non-finite catalog weights (guards a TeaVM BigInt crash)', () => {
    expect(() => samplesToMotorSpec(motor({ totalWeightG: NaN }), [{ time: 0, thrust: 1 }, { time: 1, thrust: 1 }], 0))
      .toThrow(/no loaded\/propellant weight/i);
  });

  it('throws when propellant exceeds loaded mass (negative burnout mass)', () => {
    expect(() => samplesToMotorSpec(motor({ totalWeightG: 10, propWeightG: 20 }), [{ time: 0, thrust: 1 }, { time: 1, thrust: 1 }], 0))
      .toThrow(/more propellant/i);
  });
});

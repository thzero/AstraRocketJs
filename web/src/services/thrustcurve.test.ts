import { describe, it, expect } from 'vitest';
import { samplesToMotorSpec, fetchMotorSpec } from './thrustcurve';
import type { CatalogMotor } from './motorDb';

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

describe('fetchMotorSpec — bundled catalog motor (offline path)', () => {
  const bundled = {
    designation: 'C6', manufacturer: 'Estes', class: 'C', diameter: 18, impulse: 8.8, burn: 1,
    mass: 24, length: 70, propWeightG: 10,
    curves: [{ src: 'Certified · RASP', samples: [[0, 0], [0.5, 20], [1, 0]] }],
  } as unknown as CatalogMotor;

  it('builds a MotorSpec entirely from bundled data — no thrustcurve.org fetch', async () => {
    const spec = await fetchMotorSpec(bundled, 5);
    expect(spec.designation).toBe('C6');
    expect(spec.diameter).toBeCloseTo(0.018, 9); // mm → m
    expect(spec.length).toBeCloseTo(0.07, 9);
    expect(spec.ejectionDelay).toBe(5);
    expect(spec.times[0]).toBe(0);
    expect(spec.thrusts).toContain(20);
    expect(spec.curveSrc).toBe('Certified · RASP');
  });

  it('builds from the selected curve index and records its source', async () => {
    const multi = {
      designation: 'X', manufacturer: 'Y', class: 'C', diameter: 18, impulse: 10, burn: 1,
      mass: 20, length: 70, propWeightG: 10,
      curves: [
        { src: 'Certified · RASP', samples: [[0, 0], [1, 10]] },
        { src: 'User · RockSim', samples: [[0, 0], [0.5, 40], [1, 0]] },
      ],
    } as unknown as CatalogMotor;

    const first = await fetchMotorSpec(multi, 0, 0);
    expect(first.curveSrc).toBe('Certified · RASP');
    expect(first.thrusts).toContain(10);

    const second = await fetchMotorSpec(multi, 0, 1);
    expect(second.curveSrc).toBe('User · RockSim');
    expect(second.thrusts).toContain(40);
  });
});

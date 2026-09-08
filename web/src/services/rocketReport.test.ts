import { describe, it, expect } from 'vitest';
import type { MotorSpec } from '../engine/openRocketEngine';
import { motorStats, thrustToWeight } from './rocketReport';

// A simple triangular-ish curve: 10 N held for 2 s → 20 N·s, avg 10 N.
const motor = {
  designation: 'C6',
  manufacturer: 'Estes',
  diameter: 0.018,
  length: 0.07,
  times: [0, 1, 2],
  thrusts: [10, 14, 0],
  masses: [0.024, 0.018, 0.012],
  ejectionDelay: 6,
} as unknown as MotorSpec;

describe('motorStats', () => {
  it('summarises a thrust curve', () => {
    const m = motorStats(motor);
    expect(m.burnTime).toBe(2);
    // Trapezoidal impulse: (10+14)/2 + (14+0)/2 = 12 + 7 = 19 N·s.
    expect(m.totalImpulse).toBeCloseTo(19, 6);
    expect(m.avgThrust).toBeCloseTo(9.5, 6); // 19 / 2
    expect(m.maxThrust).toBe(14);
    expect(m.weight).toBeCloseTo(0.024, 6); // loaded mass = masses[0]
    expect(m.designation).toBe('C6');
  });

  it('handles an empty curve without dividing by zero', () => {
    const m = motorStats({ ...motor, times: [], thrusts: [], masses: [] } as unknown as MotorSpec);
    expect(m.burnTime).toBe(0);
    expect(m.avgThrust).toBe(0);
    expect(m.totalImpulse).toBe(0);
  });
});

describe('thrustToWeight', () => {
  it('is avg thrust over weight', () => {
    expect(thrustToWeight(9.80665, 1)).toBeCloseTo(1, 6); // 1 kg weighs 9.80665 N
    expect(thrustToWeight(50, 0.5)).toBeCloseTo(50 / (0.5 * 9.80665), 6);
    expect(thrustToWeight(50, 0)).toBe(0);
  });
});

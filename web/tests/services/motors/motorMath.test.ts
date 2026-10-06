import { describe, it, expect } from 'vitest';
import {
  G0,
  avgThrustOf,
  ispOf,
  massFracOf,
  curveStats,
  trapezoidImpulse,
  cumulativeImpulse,
} from '../../../src/services/motors/motorMath';
import type { CatalogMotor } from '../../../src/services/motors/motorDb';

const motor = (o: Partial<CatalogMotor>): CatalogMotor =>
  ({
    manufacturer: 'AeroTech',
    designation: 'F67',
    class: 'F',
    diameter: 29,
    impulse: 61,
    burn: 1.2,
    mass: 100,
    ...o,
  }) as CatalogMotor;

describe('motorMath', () => {
  it('holds the conventional standard gravity', () => {
    expect(G0).toBe(9.80665);
  });

  it('prefers the certified average thrust and falls back to impulse over burn', () => {
    expect(avgThrustOf(motor({ avgThrust: 52 }))).toBe(52);
    expect(avgThrustOf(motor({ impulse: 60, burn: 2 }))).toBe(30);
    expect(avgThrustOf(motor({ burn: 0 }))).toBe(0);
  });

  it('computes Isp from impulse and propellant weight, NaN when unknown', () => {
    // 61 N.s over 30 g of propellant: 61 / (0.030 * 9.80665) = 207.3 s
    expect(ispOf(motor({ propWeightG: 30 }))).toBeCloseTo(207.34, 1);
    expect(ispOf(motor({}))).toBeNaN();
    expect(ispOf(motor({ propWeightG: 0 }))).toBeNaN();
  });

  it('computes the propellant mass fraction as a percentage, NaN when unknown', () => {
    expect(massFracOf(motor({ propWeightG: 30, mass: 100 }))).toBe(30);
    expect(massFracOf(motor({ propWeightG: 30, mass: 0 }))).toBeNaN();
    expect(massFracOf(motor({ mass: 100 }))).toBeNaN();
  });

  it('integrates a thrust curve by the trapezoid rule', () => {
    // A 2 s burn ramping 0 -> 10 -> 0 N: area of a triangle, 10 N.s.
    const s = curveStats([
      [0, 0],
      [1, 10],
      [2, 0],
    ]);
    expect(s.impulse).toBeCloseTo(10, 9);
    expect(s.burn).toBe(2);
    expect(s.avg).toBeCloseTo(5, 9);
    expect(s.max).toBe(10);
  });

  it('is all zeros for an empty curve rather than NaN', () => {
    expect(curveStats([])).toEqual({ impulse: 0, burn: 0, avg: 0, max: 0 });
  });
});

describe('trapezoidImpulse / cumulativeImpulse', () => {
  // A triangle from 0 to 100 N over 0.5 s and back to 0 at 1 s: 50 N·s.
  const times = [0, 0.5, 1];
  const thrusts = [0, 100, 0];

  it('integrates a curve by the trapezoid rule', () => {
    expect(trapezoidImpulse(times, thrusts)).toBeCloseTo(50, 12);
  });

  it('is 0 for fewer than two samples', () => {
    expect(trapezoidImpulse([], [])).toBe(0);
    expect(trapezoidImpulse([0.3], [40])).toBe(0);
  });

  it('runs the same sum, ending at the total', () => {
    const cum = cumulativeImpulse(times, thrusts);
    expect(cum).toEqual([0, 25, 50]);
    expect(cum[cum.length - 1]).toBe(trapezoidImpulse(times, thrusts));
  });

  it('is empty for an empty curve', () => {
    expect(cumulativeImpulse([], [])).toEqual([]);
  });
});

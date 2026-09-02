import { describe, it, expect } from 'vitest';
import { thrustAt, impulse, combineCurves, impulseClass, type Sample } from './motorCombine';

const A: Sample[] = [[0, 0], [1, 10], [2, 0]]; // triangle, impulse 10, burn 2
const B: Sample[] = [[0, 0], [0.5, 20], [1, 0]]; // triangle, impulse 10, burn 1

describe('thrustAt', () => {
  it('interpolates linearly inside the curve', () => {
    expect(thrustAt(A, 0.5)).toBeCloseTo(5, 9);
    expect(thrustAt(A, 1.5)).toBeCloseTo(5, 9);
  });
  it('is zero before ignition and after burnout', () => {
    expect(thrustAt(A, -1)).toBe(0);
    expect(thrustAt(A, 5)).toBe(0);
  });
});

describe('impulse', () => {
  it('trapezoid-integrates a curve', () => {
    expect(impulse(A)).toBeCloseTo(10, 9);
    expect(impulse(B)).toBeCloseTo(10, 9);
  });
});

describe('combineCurves', () => {
  it('sums simultaneous curves and aggregates cluster stats', () => {
    const c = combineCurves([A, B]);
    expect(c.motorCount).toBe(2);
    expect(c.burnTime).toBeCloseTo(2, 9);          // longest-burning motor
    expect(c.totalImpulse).toBeCloseTo(20, 6);     // 10 + 10
    // At t=0.5, A gives 5 and B peaks at 20 → 25 N combined peak region.
    expect(c.peakThrust).toBeCloseTo(25, 6);
    expect(c.avgThrust).toBeCloseTo(10, 6);        // 20 N·s / 2 s
  });
  it('returns a zeroed result for no usable curves', () => {
    expect(combineCurves([]).motorCount).toBe(0);
    expect(combineCurves([[[0, 0]]]).totalImpulse).toBe(0); // single point = degenerate
  });
});

describe('impulseClass', () => {
  it('maps N·s to the NAR/TRA class letter', () => {
    expect(impulseClass(2.5)).toBe('A');
    expect(impulseClass(2.51)).toBe('B');
    expect(impulseClass(5)).toBe('B');
    expect(impulseClass(10)).toBe('C');
    expect(impulseClass(20)).toBe('D');
    expect(impulseClass(320)).toBe('H');
    expect(impulseClass(1280)).toBe('J');
  });
  it('is "—" below A', () => {
    expect(impulseClass(1)).toBe('—');
    expect(impulseClass(0)).toBe('—');
  });
});

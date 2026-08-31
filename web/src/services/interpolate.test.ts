import { describe, it, expect } from 'vitest';
import { lerpAt } from './interpolate';

describe('lerpAt', () => {
  const xs = [0, 1, 2, 3];
  const ys = [0, 10, 20, 30];

  it('returns null for an empty series', () => {
    expect(lerpAt([], [], 5)).toBeNull();
  });

  it('clamps below the first knot to ys[0]', () => {
    expect(lerpAt(xs, ys, -5)).toBe(0);
    expect(lerpAt(xs, ys, 0)).toBe(0); // x === xs[0]
  });

  it('clamps above the last knot to the last y', () => {
    expect(lerpAt(xs, ys, 99)).toBe(30);
  });

  it('returns the exact value at an interior knot', () => {
    expect(lerpAt(xs, ys, 2)).toBe(20);
  });

  it('linearly interpolates between knots', () => {
    expect(lerpAt(xs, ys, 0.5)).toBe(5);
    expect(lerpAt(xs, ys, 1.25)).toBe(12.5);
  });

  it('steps past a null endpoint of the bracketing span', () => {
    // ys[1] is null → interpolating in [0,1] falls back to the non-null neighbour
    expect(lerpAt([0, 1, 2], [0, null, 20], 0.5)).toBe(0); // y1 null → y0
    expect(lerpAt([0, 1, 2], [null, 10, 20], 0.5)).toBe(10); // y0 null → y1
  });

  it('returns null when both bracketing samples are null', () => {
    expect(lerpAt([0, 1, 2], [null, null, 20], 0.5)).toBeNull();
  });

  it('returns null when the clamped endpoint sample is null', () => {
    expect(lerpAt([0, 1], [null, 10], -1)).toBeNull();
  });

  it('does not divide by zero on a zero-width span', () => {
    expect(lerpAt([1, 1], [5, 9], 1)).toBe(5); // x <= xs[0] → ys[0]
    expect(lerpAt([0, 1, 1, 2], [0, 5, 9, 12], 1)).toBe(5); // first knot with x<=xs[i] wins
  });
});

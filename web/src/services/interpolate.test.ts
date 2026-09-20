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
    // ys[1] is null → interpolating in [0,1] falls back to the non-null neighbor
    expect(lerpAt([0, 1, 2], [0, null, 20], 0.5)).toBe(0); // y1 null → y0
    expect(lerpAt([0, 1, 2], [null, 10, 20], 0.5)).toBe(10); // y0 null → y1
  });

  it('returns null when both bracketing samples are null', () => {
    expect(lerpAt([0, 1, 2], [null, null, 20], 0.5)).toBeNull();
  });

  it('returns null when the clamped endpoint sample is null', () => {
    expect(lerpAt([0, 1], [null, 10], -1)).toBeNull();
  });

  it('extrapolates off the END OF THE X-DOMAIN when ys is longer than xs', () => {
    // The regression the other cases cannot see: every one of them passes an
    // equal-length pair, where `ys[ys.length-1]` and `ys[xs.length-1]` are the
    // same element. The clamp used to index off `ys`, so a longer `ys` returned
    // a value from outside the x-domain entirely.
    expect(lerpAt([0, 1], [0, 10, 999], 5)).toBe(10);
    expect(lerpAt([0, 1, 2], [0, 10, 20, 30, 40], 99)).toBe(20);
    // A null at the true last knot still reads as no data, not as the surplus.
    expect(lerpAt([0, 1], [0, null, 999], 5)).toBeNull();
  });

  it('does not divide by zero on a zero-width span', () => {
    expect(lerpAt([1, 1], [5, 9], 1)).toBe(5); // x <= xs[0] → ys[0]
    expect(lerpAt([0, 1, 1, 2], [0, 5, 9, 12], 1)).toBe(5); // first knot with x<=xs[i] wins
  });
});

/**
 * The binary-search rewrite, checked against the scan it replaced on random
 * sorted inputs. The reference is the previous implementation verbatim, so any
 * knot the search lands on differently (duplicates, null neighbors, the ends)
 * shows up as a mismatch here rather than as a wrong hover readout.
 */
describe('lerpAt binary search agrees with the linear scan', () => {
  const linear = (xs: readonly number[], ys: readonly (number | null)[], x: number): number | null => {
    if (!xs.length) return null;
    if (x <= xs[0]!) return ys[0] ?? null;
    for (let i = 1; i < xs.length; i++) {
      if (x <= xs[i]!) {
        const y0 = ys[i - 1],
          y1 = ys[i];
        if (y0 == null || y1 == null) return y1 ?? y0 ?? null;
        return y0 + ((x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!)) * (y1 - y0);
      }
    }
    return ys[xs.length - 1] ?? null;
  };
  // Deterministic PRNG so a failure reproduces.
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  it('matches on random sorted arrays with duplicates and nulls', () => {
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(rnd() * 40);
      const xs: number[] = [];
      let x = rnd() * 10;
      for (let i = 0; i < n; i++) {
        // A zero step now and then, so duplicate knots are exercised.
        x += rnd() < 0.15 ? 0 : rnd() * 3;
        xs.push(x);
      }
      const ys = xs.map(() => (rnd() < 0.1 ? null : rnd() * 100));
      // Probe below, inside, on knots and above the domain.
      const probes = [xs[0]! - 1, xs[n - 1]! + 1, ...xs, ...xs.map((v) => v + rnd() * 0.5)];
      for (const p of probes) {
        const a = lerpAt(xs, ys, p);
        const b = linear(xs, ys, p);
        if (a === null || b === null) expect(a).toBe(b);
        else expect(a).toBeCloseTo(b, 9);
      }
    }
  });

  it('lands on the same value for a longer ys', () => {
    const xs = [0, 1, 2, 3];
    const ys = [0, 10, 20, 30, 999];
    for (const p of [-1, 0, 0.5, 1, 2.5, 3, 4]) expect(lerpAt(xs, ys, p)).toBe(linear(xs, ys, p));
  });
});

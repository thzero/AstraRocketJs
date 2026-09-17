import { describe, it, expect } from 'vitest';
import {
  shapeParamDefault,
  shapeUsesParameter,
  shapeParamMax,
  shapeIsClippable,
  shapeRadius,
  outerProfile,
} from './shapeProfile';

describe('shape parameter metadata', () => {
  // Transition.Shape's own defaultParameter() overrides: OGIVE 1.0 ("Tangent
  // ogive by default", Transition.java:1039-1041), POWER 0.5 (:1104-1106),
  // PARABOLIC 1.0 (:1150-1152); the shapes that do not use the parameter
  // report 0. HAACK's ceiling is maxParameter() = 1.0/3.0 ("Range 0...1/3",
  // :1187-1189) — the LV-Haack end of the series.
  it('defaults per shape (ogive/parabolic 1, power 0.5, rest 0)', () => {
    expect(shapeParamDefault('ogive')).toBe(1);
    expect(shapeParamDefault('parabolic')).toBe(1);
    expect(shapeParamDefault('power')).toBe(0.5);
    expect(shapeParamDefault('conical')).toBe(0);
    expect(shapeParamDefault('haack')).toBe(0);
  });

  it('knows which shapes actually use the parameter', () => {
    expect(shapeUsesParameter('ogive')).toBe(true);
    expect(shapeUsesParameter('haack')).toBe(true);
    expect(shapeUsesParameter('conical')).toBe(false);
    expect(shapeUsesParameter('ellipsoid')).toBe(false);
  });

  it('caps haack at 1/3 and everything else at 1', () => {
    expect(shapeParamMax('haack')).toBeCloseTo(1 / 3);
    expect(shapeParamMax('ogive')).toBe(1);
  });

  it('marks ellipsoid / power / haack as clippable, the rest not', () => {
    expect(shapeIsClippable('ellipsoid')).toBe(true);
    expect(shapeIsClippable('power')).toBe(true);
    expect(shapeIsClippable('haack')).toBe(true);
    expect(shapeIsClippable('conical')).toBe(false);
    expect(shapeIsClippable('ogive')).toBe(false);
  });
});

describe('shapeRadius', () => {
  it('conical is a straight taper from tip to base', () => {
    expect(shapeRadius('conical', 0, 0.05, 1, 0)).toBeCloseTo(0);
    expect(shapeRadius('conical', 0.5, 0.05, 1, 0)).toBeCloseTo(0.025);
    expect(shapeRadius('conical', 1, 0.05, 1, 0)).toBeCloseTo(0.05);
  });

  it('every shape reaches the full radius at its base (x = length)', () => {
    for (const shape of ['conical', 'ellipsoid', 'power', 'parabolic', 'haack', 'ogive']) {
      const param = shapeParamDefault(shape);
      expect(shapeRadius(shape, 1, 0.05, 1, param), shape).toBeCloseTo(0.05);
    }
  });

  it('a blunt power series (param≈0) is a flat cylinder off the tip', () => {
    expect(shapeRadius('power', 0, 0.05, 1, 0)).toBe(0);
    expect(shapeRadius('power', 0.5, 0.05, 1, 0)).toBe(0.05);
  });

  it('power series scales as (x/length)^param', () => {
    expect(shapeRadius('power', 0.25, 0.05, 1, 0.5)).toBeCloseTo(0.05 * Math.sqrt(0.25));
  });
});

describe('outerProfile', () => {
  it('samples a nose cone (foreR 0) from tip to base with steps+1 points', () => {
    const pts = outerProfile('conical', 0, 0.1, 0, 0.05, 4);
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[2]![0]).toBeCloseTo(0.05);
    expect(pts[2]![1]).toBeCloseTo(0.025);
    expect(pts[4]![0]).toBeCloseTo(0.1);
    expect(pts[4]![1]).toBeCloseTo(0.05);
  });

  it('draws a straight tube when the ends are equal', () => {
    const pts = outerProfile('conical', 0, 0.1, 0.02, 0.02, 4);
    expect(pts.every(([, r]) => r === 0.02)).toBe(true);
  });

  it('flips so the fore radius leads for a shrinking transition', () => {
    const pts = outerProfile('conical', 0, 0.1, 0.05, 0.02, 4);
    expect(pts[0]![1]).toBeCloseTo(0.05);
    expect(pts[pts.length - 1]![1]).toBeCloseTo(0.02);
  });

  it('merges an exact extra abscissa without dropping the even ladder', () => {
    const pts = outerProfile('conical', 0, 0.1, 0, 0.05, 4, [0.03]);
    expect(pts).toHaveLength(6);
    expect(pts.some(([x]) => Math.abs(x - 0.03) < 1e-9)).toBe(true);
    expect(pts.map(([x]) => x)).toEqual([...pts.map(([x]) => x)].sort((a, b) => a - b)); // sorted
  });

  it('replaces (not duplicates) an extra abscissa that coincides with a sample', () => {
    const pts = outerProfile('conical', 0, 0.1, 0, 0.05, 4, [0.05]); // 0.05 is already a sample
    expect(pts).toHaveLength(5);
  });

  it('the clipped flag is ignored on a non-clippable shape', () => {
    const clipped = outerProfile('conical', undefined, 0.1, 0.02, 0.05, 8, undefined, true);
    const unclipped = outerProfile('conical', undefined, 0.1, 0.02, 0.05, 8, undefined, false);
    expect(clipped).toEqual(unclipped);
  });

  it('the clipped flag changes a clippable transition', () => {
    const clipped = outerProfile('ellipsoid', undefined, 0.1, 0.02, 0.05, 8, undefined, true);
    const unclipped = outerProfile('ellipsoid', undefined, 0.1, 0.02, 0.05, 8, undefined, false);
    expect(clipped).not.toEqual(unclipped);
  });
});

/**
 * The clipped profile — `calculateClip()`, the binary search that positions
 * every clipped ellipsoid / power / haack transition.
 *
 * It had no test at all, and it is the one piece of this port whose output is
 * not obvious by inspection: it solves for how far up a VIRTUAL nose cone the
 * transition starts. The kernel states the equation it solves, in the comment
 * over `Transition.calculateClip` (Transition.java:695-700):
 *
 *     r1 == type.getRadius(clipLength, r2, clipLength + length, shapeParameter)
 *
 * so these tests recover `clipLength` here by an INDEPENDENT solve of that same
 * published equation and check the drawn profile against it. A drifted binary
 * search — wrong bracket, wrong convergence, clipping something it should not —
 * fails; a rewrite that still solves the kernel's equation passes.
 */
describe('calculateClip (via the clipped profile)', () => {
  const CLIPPABLE = ['ellipsoid', 'power', 'haack'] as const;

  /** Solve the kernel's equation independently: plain 200-iteration bisection. */
  const solveClip = (shape: string, param: number, length: number, r1: number, r2: number): number => {
    let lo = 0;
    let hi = length;
    while (shapeRadius(shape, hi, r2, hi + length, param) < r1) hi *= 2;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (shapeRadius(shape, mid, r2, mid + length, param) > r1) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };

  // The second geometry is deliberately near-cylindrical: a 0.5 mm rise over
  // 200 mm sits so far up the virtual nose that `max = length` does not even
  // bracket the root, so it is the case that exercises the doubling loop the
  // search opens with. Without that loop the bisection converges on the wrong
  // side and the profile is wrong everywhere but its endpoints.
  const GEOMS: [number, number, number][] = [
    [0.1, 0.02, 0.04],
    [0.2, 0.0495, 0.05],
  ];

  it.each(CLIPPABLE)('%s draws the tail of the virtual nose it was cut from', (shape) => {
    const p = shapeParamDefault(shape);
    for (const [len, r1, r2] of GEOMS) {
      const clip = solveClip(shape, p, len, r1, r2);
      for (const [x, r] of outerProfile(shape, p, len, r1, r2, 16)) {
        if (x <= 0 || x >= len) continue; // the endpoints are returned verbatim
        expect(r).toBeCloseTo(shapeRadius(shape, clip + x, r2, clip + len, p), 5);
      }
    }
  });

  it.each(CLIPPABLE)('%s meets both end radii', (shape) => {
    const p = shapeParamDefault(shape);
    const pts = outerProfile(shape, p, 0.1, 0.02, 0.04, 16);
    expect(pts[0]![1]).toBeCloseTo(0.02, 12);
    expect(pts[pts.length - 1]![1]).toBeCloseTo(0.04, 12);
    // ...and arrives there continuously, rather than jumping at the first
    // interior sample, which is what a clipLength solved off the curve looks
    // like on screen.
    expect(pts[1]![1]).toBeGreaterThan(0.02);
    expect(pts[1]![1]).toBeLessThan(0.024);
  });

  it.each(CLIPPABLE)('%s grows monotonically from fore to aft', (shape) => {
    const pts = outerProfile(shape, shapeParamDefault(shape), 0.1, 0.02, 0.04, 32);
    for (let i = 1; i < pts.length; i++) expect(pts[i]![1]).toBeGreaterThanOrEqual(pts[i - 1]![1]);
  });

  it('a nose cone (foreR 0) is never clipped — clipLength is 0 by definition', () => {
    // r1 == 0 short-circuits the search: the profile IS the shape itself.
    for (const shape of CLIPPABLE) {
      const p = shapeParamDefault(shape);
      for (const [x, r] of outerProfile(shape, p, 0.1, 0, 0.04, 8)) {
        expect(r).toBeCloseTo(shapeRadius(shape, x, 0.04, 0.1, p), 12);
      }
    }
  });

  it('an explicit clipped=false draws the unclipped delta shape instead', () => {
    // The kernel's other branch: r1 + getRadius(x, r2 - r1, length).
    const p = shapeParamDefault('ellipsoid');
    for (const [x, r] of outerProfile('ellipsoid', p, 0.1, 0.02, 0.04, 8, undefined, false)) {
      expect(r).toBeCloseTo(0.02 + shapeRadius('ellipsoid', x, 0.02, 0.1, p), 12);
    }
  });

  it('a shrinking transition is the mirror of the growing one', () => {
    // Transition.getRadius() normalises to the small end and flips back, so a
    // boat tail must be the same curve read backwards — not a different solve.
    const p = shapeParamDefault('haack');
    const grow = outerProfile('haack', p, 0.1, 0.02, 0.04, 16);
    const shrink = outerProfile('haack', p, 0.1, 0.04, 0.02, 16);
    for (let i = 0; i < grow.length; i++) {
      expect(shrink[i]![1]).toBeCloseTo(grow[grow.length - 1 - i]![1], 12);
    }
  });

  it('a zero-length transition degenerates to the fore radius', () => {
    // `length <= 0` returns clipLength 0 in the kernel; outerProfile short-
    // circuits earlier still, and must not divide by the zero length.
    const pts = outerProfile('haack', 0, 0, 0.02, 0.04, 4);
    expect(pts.every(([, r]) => r === 0.02)).toBe(true);
  });

  it('a near-cylindrical clipped transition still lands on both radii', () => {
    // A 1 mm rise over 200 mm pushes the search's opening bracket: the first
    // guess sits far up a very shallow virtual nose.
    const pts = outerProfile('ellipsoid', 0, 0.2, 0.0495, 0.05, 16);
    expect(pts[0]![1]).toBeCloseTo(0.0495, 12);
    expect(pts[pts.length - 1]![1]).toBeCloseTo(0.05, 12);
    expect(pts.every(([, r]) => Number.isFinite(r))).toBe(true);
  });
});

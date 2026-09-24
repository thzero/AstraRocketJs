import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIGMA,
  centroid,
  convexHull,
  driftEllipse,
  driftRegion,
  ellipsePolygon,
  polygonArea,
} from './driftEllipse';
import type { GroundPoint } from './groundTrack';

/**
 * The two shapes a sweep's landings turn into, against figures worked out by
 * hand rather than against the code's own output.
 *
 * The cases that matter are the degenerate ones, because a sweep produces them
 * routinely: one heading gives a straight line of landings, a calm sweep gives
 * a cluster of near-identical points, and a single-cell sweep gives one.
 */

const p = (east: number, north: number): GroundPoint => ({ east, north });

describe('the centroid', () => {
  it('is the mean of the landings', () => {
    expect(centroid([p(0, 0), p(4, 0), p(0, 6)])).toEqual({ east: 4 / 3, north: 2 });
  });

  it('is null for no landings at all', () => {
    expect(centroid([])).toBeNull();
  });
});

describe('the swept envelope', () => {
  it('drops points inside the boundary', () => {
    const hull = convexHull([p(0, 0), p(10, 0), p(10, 10), p(0, 10), p(5, 5), p(2, 8)]);
    expect(hull).toHaveLength(4);
    expect(new Set(hull.map((q) => `${q.east},${q.north}`))).toEqual(new Set(['0,0', '10,0', '10,10', '0,10']));
  });

  /**
   * A point exactly ON an edge adds nothing: keeping it would put a vertex in
   * the middle of a straight side, which draws identically and makes the vertex
   * count useless as a test of whether the region has an area.
   */
  it('drops a point lying on an edge', () => {
    expect(convexHull([p(0, 0), p(10, 0), p(10, 10), p(0, 10), p(5, 0)])).toHaveLength(4);
  });

  /** One heading swept over several speeds: every landing on one ray from the pad. */
  it('collapses a collinear sweep to its two ends', () => {
    const hull = convexHull([p(1, 1), p(2, 2), p(3, 3), p(4, 4)]);
    expect(hull).toEqual([p(1, 1), p(4, 4)]);
  });

  it('collapses identical landings to one point', () => {
    expect(convexHull([p(3, 3), p(3, 3), p(3, 3)])).toEqual([p(3, 3)]);
  });

  it('winds counterclockwise, so the area is the shoelace magnitude', () => {
    expect(polygonArea(convexHull([p(0, 0), p(10, 0), p(10, 10), p(0, 10)]))).toBe(100);
  });

  it('gives a collinear hull no area', () => {
    expect(polygonArea(convexHull([p(0, 0), p(5, 5)]))).toBe(0);
  });
});

describe('the drift ellipse', () => {
  /**
   * Four landings at (+-3, 0) and (0, +-1): east variance 18/3 = 6, north
   * variance 2/3, no covariance. At one sigma the semi-axes are the roots of
   * those, and the long one points east.
   */
  it('takes its axes from the sample variances', () => {
    const e = driftEllipse([p(3, 0), p(-3, 0), p(0, 1), p(0, -1)], 1)!;
    expect(e.center.east).toBeCloseTo(0, 10);
    expect(e.center.north).toBeCloseTo(0, 10);
    expect(e.semiMajorM).toBeCloseTo(Math.sqrt(6), 10);
    expect(e.semiMinorM).toBeCloseTo(Math.sqrt(2 / 3), 10);
    expect(e.bearingDeg).toBeCloseTo(90, 10);
  });

  /**
   * Axis-aligned with no covariance, atan2 has nothing to work from. Picking
   * the axis by which variance is larger is what stops a purely north-south
   * spread being reported as an east-west one.
   */
  it('points along north when the spread is north-south', () => {
    const e = driftEllipse([p(0, 5), p(0, -5), p(1, 0), p(-1, 0)], 1)!;
    expect(e.bearingDeg).toBeCloseTo(0, 10);
    expect(e.semiMajorM).toBeGreaterThan(e.semiMinorM);
  });

  it('leans with a correlated spread', () => {
    const e = driftEllipse([p(1, 1), p(2, 2), p(3, 3), p(-1, -1)], 1)!;
    expect(e.bearingDeg).toBeCloseTo(45, 6);
    // Perfectly collinear: nothing at all in the short direction.
    expect(e.semiMinorM).toBeCloseTo(0, 6);
  });

  it('scales with sigma', () => {
    const one = driftEllipse([p(3, 0), p(-3, 0), p(0, 1), p(0, -1)], 1)!;
    const two = driftEllipse([p(3, 0), p(-3, 0), p(0, 1), p(0, -1)], 2)!;
    expect(two.semiMajorM).toBeCloseTo(one.semiMajorM * 2, 10);
  });

  it('is null for a single landing, which has no spread', () => {
    expect(driftEllipse([p(4, 4)])).toBeNull();
    expect(driftEllipse([])).toBeNull();
  });

  it('draws as a closed ring the drawing can map straight through', () => {
    const e = driftEllipse([p(3, 0), p(-3, 0), p(0, 1), p(0, -1)], 1)!;
    const ring = ellipsePolygon(e, 8);
    expect(ring).toHaveLength(8);
    // First vertex is one semi-major out along the major axis, which here is due east.
    expect(ring[0]!.east).toBeCloseTo(e.semiMajorM, 10);
    expect(ring[0]!.north).toBeCloseTo(0, 10);
    // A quarter of the way round is one semi-minor out along the minor axis,
    // which is the major turned a quarter turn — here, due north.
    expect(ring[2]!.east).toBeCloseTo(0, 10);
    expect(ring[2]!.north).toBeCloseTo(e.semiMinorM, 10);
  });
});

describe('a stage region', () => {
  const samples = [p(0, 0), p(10, 0), p(10, 10), p(0, 10), p(5, 5)];

  it('carries the range band a walk has to cover', () => {
    const r = driftRegion(0, samples)!;
    expect(r.minRangeM).toBe(0);
    expect(r.maxRangeM).toBeCloseTo(Math.hypot(10, 10), 10);
    expect(r.areaM2).toBe(100);
    expect(r.branch).toBe(0);
  });

  it('defaults to a two-sigma ellipse', () => {
    expect(driftRegion(0, samples)!.ellipse!.sigma).toBe(DEFAULT_SIGMA);
  });

  it('is null when nothing landed', () => {
    expect(driftRegion(0, [])).toBeNull();
  });

  it('still describes a lone landing, without an ellipse', () => {
    const r = driftRegion(1, [p(30, 40)])!;
    expect(r.ellipse).toBeNull();
    expect(r.maxRangeM).toBe(50);
    expect(r.hull).toEqual([p(30, 40)]);
    expect(r.areaM2).toBe(0);
  });
});

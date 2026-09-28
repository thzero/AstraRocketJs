import { describe, it, expect } from 'vitest';
import { outerProfile } from '../../src/tree/shapeProfile';

/**
 * calculateClip()'s bisection exited only on `max - min < precision`. With a
 * non-finite length `max - min` is NaN, NaN compares false against everything,
 * and the loop never returned: a hostile `.ork` with an absurd transition
 * length hung the tab from the schematic, the 3D view, the report and the
 * mesh exporter. The Java has the same loop; its callers cannot hand it NaN.
 * Ours read a file.
 */
describe('outerProfile on hostile lengths', () => {
  // Every clippable shape takes the bisection path when the radii differ.
  const shapes = ['ellipsoid', 'power', 'haack'] as const;

  it.each(shapes)('%s: returns for a NaN length', (shape) => {
    const pts = outerProfile(shape, undefined, Number.NaN, 0.01, 0.02);
    expect(Array.isArray(pts)).toBe(true);
  });

  it.each(shapes)('%s: returns for an infinite length', (shape) => {
    const pts = outerProfile(shape, undefined, Number.POSITIVE_INFINITY, 0.01, 0.02);
    expect(Array.isArray(pts)).toBe(true);
  });

  it.each(shapes)('%s: returns for a length whose doubling overflows', (shape) => {
    // The samples themselves are garbage at this length (x/length overflows);
    // what matters is that the call returns instead of spinning forever.
    const pts = outerProfile(shape, undefined, 1e308, 0.01, 0.02);
    expect(Array.isArray(pts)).toBe(true);
  });

  it('a sane transition still clips (the guard did not disable clipping)', () => {
    const clipped = outerProfile('ellipsoid', undefined, 0.1, 0.01, 0.03, 8, undefined, true);
    const unclipped = outerProfile('ellipsoid', undefined, 0.1, 0.01, 0.03, 8, undefined, false);
    expect(clipped).not.toEqual(unclipped);
    expect(clipped[0]![1]).toBeCloseTo(0.01, 6);
    expect(clipped[clipped.length - 1]![1]).toBeCloseTo(0.03, 6);
  });
});

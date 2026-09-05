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
    expect(pts[2][0]).toBeCloseTo(0.05);
    expect(pts[2][1]).toBeCloseTo(0.025);
    expect(pts[4][0]).toBeCloseTo(0.1);
    expect(pts[4][1]).toBeCloseTo(0.05);
  });

  it('draws a straight tube when the ends are equal', () => {
    const pts = outerProfile('conical', 0, 0.1, 0.02, 0.02, 4);
    expect(pts.every(([, r]) => r === 0.02)).toBe(true);
  });

  it('flips so the fore radius leads for a shrinking transition', () => {
    const pts = outerProfile('conical', 0, 0.1, 0.05, 0.02, 4);
    expect(pts[0][1]).toBeCloseTo(0.05);
    expect(pts[pts.length - 1][1]).toBeCloseTo(0.02);
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

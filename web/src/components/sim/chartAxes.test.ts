import { describe, it, expect } from 'vitest';
import { chartScales, linePath, baselineArea, type XY } from './chartAxes';

const dims = { width: 100, height: 100, padL: 10, padR: 10, padT: 10, padB: 10 };

describe('chartScales', () => {
  const { X, Y } = chartScales(dims, 10, 20);

  it('maps t∈[0,tMax] across the padded plot width', () => {
    expect(X(0)).toBe(10); // left pad
    expect(X(10)).toBe(90); // width - padR
    expect(X(5)).toBe(50); // midpoint
  });

  it('maps f∈[0,fMax] up from the baseline (Y grows downward)', () => {
    expect(Y(0)).toBe(90); // baseline at height - padB
    expect(Y(20)).toBe(10); // fMax at top pad
    expect(Y(10)).toBe(50);
  });
});

describe('linePath', () => {
  const { X, Y } = chartScales(dims, 10, 20);
  it('emits an M then L commands at 1-decimal coordinates', () => {
    const pts: XY[] = [
      [0, 0],
      [5, 10],
      [10, 20],
    ];
    expect(linePath(pts, X, Y)).toBe('M 10.0 90.0 L 50.0 50.0 L 90.0 10.0');
  });
});

describe('baselineArea', () => {
  const { X, Y } = chartScales(dims, 10, 20);
  it('closes the curve down to the f=0 baseline across [0,tMax]', () => {
    const pts: XY[] = [
      [0, 0],
      [10, 20],
    ];
    // opens at baseline, traces the points, drops back to the baseline at tMax, closes
    expect(baselineArea(pts, X, Y, 10)).toBe('M 10.0 90.0 L 10.0 90.0 L 90.0 10.0 L 90.0 90.0 Z');
  });
  it('is empty for no points', () => {
    expect(baselineArea([], X, Y, 10)).toBe('');
  });
});

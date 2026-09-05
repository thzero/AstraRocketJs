import { describe, it, expect } from 'vitest';
import { STD_DIAMS, fitIdx, parseDelays, initialThrust } from './motorPicker';

describe('fitIdx', () => {
  it('picks the largest standard diameter that fits the bore (+1mm tolerance)', () => {
    expect(STD_DIAMS[fitIdx(17.6)]).toBe(18); // default 18mm mount bore → 18
    expect(STD_DIAMS[fitIdx(24)]).toBe(24);
    expect(STD_DIAMS[fitIdx(5)]).toBe(6); // never below the smallest
    expect(STD_DIAMS[fitIdx(999)]).toBe(150); // clamps to the largest
  });
});

describe('parseDelays', () => {
  it('parses comma and dash separated numeric delays', () => {
    expect(parseDelays('4,6,7,8,10')).toEqual({ delays: [4, 6, 7, 8, 10], plugged: false });
    expect(parseDelays('0-3-5-7')).toEqual({ delays: [0, 3, 5, 7], plugged: false });
  });

  it('detects a plugged option and separates it from numbers', () => {
    expect(parseDelays('0,3,P')).toEqual({ delays: [0, 3], plugged: true });
    expect(parseDelays('P')).toEqual({ delays: [], plugged: true });
  });

  it('de-dupes, sorts, and handles empty input', () => {
    expect(parseDelays('6,4,4')).toEqual({ delays: [4, 6], plugged: false });
    expect(parseDelays(undefined)).toEqual({ delays: [], plugged: false });
  });
});

describe('initialThrust', () => {
  it('averages thrust over the first 0.5 s (trapezoid)', () => {
    expect(
      initialThrust([
        [0, 0],
        [0.5, 20],
        [1, 0],
      ]),
    ).toBeCloseTo(10, 9);
  });

  it('clips the window when a sample spans past it', () => {
    // ramp 0→20 N over 1 s; the 0–0.5 s slice averages 5 N.
    expect(
      initialThrust([
        [0, 0],
        [1, 20],
      ]),
    ).toBeCloseTo(5, 9);
  });

  it('returns null for fewer than two samples', () => {
    expect(initialThrust([[0, 5]])).toBeNull();
    expect(initialThrust([])).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import {
  hasIntensity,
  stdDevForIntensity,
  turbulenceIntensity,
  turbulenceLevel,
} from '../../src/services/windTurbulence';

describe('turbulenceIntensity', () => {
  it('is the standard deviation over the average', () => {
    expect(turbulenceIntensity(10, 2)).toBeCloseTo(0.2, 12);
    expect(turbulenceIntensity(4, 1)).toBeCloseTo(0.25, 12);
  });

  it('answers 0 or 1 at zero wind, as the kernel does', () => {
    // PinkNoiseWindModel.getTurbulenceIntensity: no ratio exists, so no scatter
    // reads as none and any scatter reads as total. Export leans on this to
    // write <windturbulence> a pre-24 desktop can read back.
    expect(turbulenceIntensity(0, 0)).toBe(0);
    expect(turbulenceIntensity(0, 3)).toBe(1);
  });

  it('treats an average inside the kernel epsilon as zero', () => {
    expect(turbulenceIntensity(1e-12, 1)).toBe(1);
    expect(turbulenceIntensity(1e-6, 1)).toBeCloseTo(1e6, 0);
  });
});

describe('stdDevForIntensity', () => {
  it('round-trips against turbulenceIntensity', () => {
    for (const [avg, sd] of [
      [10, 2],
      [3.5, 0.7],
      [22, 0],
    ]) {
      expect(stdDevForIntensity(avg!, turbulenceIntensity(avg!, sd!))).toBeCloseTo(sd!, 12);
    }
  });

  it('never returns a negative scatter', () => {
    expect(stdDevForIntensity(-5, 0.2)).toBe(0);
  });
});

describe('turbulenceLevel', () => {
  it('names each rung of the kernel ladder', () => {
    expect(turbulenceLevel(0)).toBe('none');
    expect(turbulenceLevel(0.02)).toBe('veryLow');
    expect(turbulenceLevel(0.07)).toBe('low');
    expect(turbulenceLevel(0.12)).toBe('medium');
    expect(turbulenceLevel(0.18)).toBe('high');
    expect(turbulenceLevel(0.22)).toBe('veryHigh');
    expect(turbulenceLevel(0.4)).toBe('extreme');
  });

  it('puts each boundary on the upper rung', () => {
    expect(turbulenceLevel(0.001)).toBe('veryLow');
    expect(turbulenceLevel(0.05)).toBe('low');
    expect(turbulenceLevel(0.1)).toBe('medium');
    expect(turbulenceLevel(0.15)).toBe('high');
    expect(turbulenceLevel(0.2)).toBe('veryHigh');
    expect(turbulenceLevel(0.25)).toBe('extreme');
  });
});

describe('hasIntensity', () => {
  it('is false only where the ratio would be the 0-or-1 stand-in', () => {
    expect(hasIntensity(0)).toBe(false);
    expect(hasIntensity(1e-12)).toBe(false);
    expect(hasIntensity(0.5)).toBe(true);
  });
});

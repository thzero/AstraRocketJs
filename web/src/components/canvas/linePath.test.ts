import { describe, it, expect } from 'vitest';
import { buildLinePath } from './AeroAnalysis';

// Identity scales keep the assertions about the PATH STRUCTURE, not arithmetic.
const X = (m: number) => m;
const Y = (v: number) => v;

describe('buildLinePath', () => {
  it('starts with M and continues with L', () => {
    expect(buildLinePath([0, 1, 2], [10, 20, 30], X, Y)).toBe('M0.0,10.0 L1.0,20.0 L2.0,30.0');
  });

  /**
   * The bug: the command letter came from the array INDEX (`${i ? 'L' : 'M'}`),
   * so a non-finite first sample produced a `d` beginning with `L…`. That is
   * invalid path data — the browser drops the whole <path> silently and the
   * curve renders blank with no error anywhere.
   */
  it('still starts with M when the first sample is non-finite', () => {
    const d = buildLinePath([0, 1, 2], [NaN, 20, 30], X, Y);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toBe('M1.0,20.0 L2.0,30.0');
  });

  it('breaks the line at a gap instead of bridging straight across it', () => {
    // A hole in the middle should read as a hole, not a fabricated straight
    // segment joining the two sides.
    const d = buildLinePath([0, 1, 2, 3], [10, NaN, 30, 40], X, Y);
    expect(d).toBe('M0.0,10.0 M2.0,30.0 L3.0,40.0');
  });

  it('skips a non-finite Mach as well as a non-finite value', () => {
    expect(buildLinePath([0, NaN, 2], [10, 20, 30], X, Y)).toBe('M0.0,10.0 M2.0,30.0');
  });

  it('is empty when nothing is plottable, rather than emitting junk', () => {
    expect(buildLinePath([0, 1], [NaN, NaN], X, Y)).toBe('');
    expect(buildLinePath([], [], X, Y)).toBe('');
  });

  it('treats a missing value as a gap', () => {
    // `vals` shorter than `machs` — the sweep can return a shorter series.
    expect(buildLinePath([0, 1, 2], [10], X, Y)).toBe('M0.0,10.0');
  });
});

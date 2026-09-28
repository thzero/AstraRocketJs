import { describe, it, expect } from 'vitest';
import { maxFlightTime } from '../../../src/components/canvas/FlightChart';
import type { FlightSeries } from '../../../src/engine/openRocketEngine';

const branch = (time: number[]) => ({ series: { time } as unknown as FlightSeries });

describe('maxFlightTime', () => {
  it('spans every branch, not just the first', () => {
    // A booster that lands after the sustainer still has to fit on the axis —
    // its descent runs on the same launch clock.
    expect(maxFlightTime([branch([0, 1, 2]), branch([0, 1, 2, 3, 9.5])], 2)).toBe(9.5);
  });

  it('uses the summary flight time when it outlasts the samples', () => {
    expect(maxFlightTime([branch([0, 1, 2])], 30)).toBe(30);
  });

  it('never returns less than 1, so the axis is never degenerate', () => {
    expect(maxFlightTime([], undefined)).toBe(1);
    expect(maxFlightTime([branch([])], 0)).toBe(1);
    expect(maxFlightTime([branch([0, 0.2])], 0.2)).toBe(1);
  });

  it('tolerates a branch with no time series', () => {
    expect(maxFlightTime([{ series: {} as FlightSeries }], 4)).toBe(4);
  });

  /**
   * The bug: this was `Math.max(flightTime, ...branches.flatMap((b) =>
   * b.series.time))`. A long, fine-timestep, multi-stage flight puts a
   * six-figure argument list into that call, which throws
   * `RangeError: Maximum call stack size exceeded` — and because it ran in the
   * render body rather than a memo, it threw on every pointer move over the
   * chart, blanking the whole panel.
   */
  it('handles a sample count that would overflow the call-argument stack', () => {
    const many = Array.from({ length: 300_000 }, (_, i) => i * 0.001);
    expect(() => Math.max(1, ...many)).toThrow(RangeError); // the shape of the old code
    expect(maxFlightTime([branch(many)], 1)).toBeCloseTo(299.999, 6);
  });
});

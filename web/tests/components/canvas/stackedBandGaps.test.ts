import { describe, it, expect } from 'vitest';
import { stackedBands, buildLinePath, type ChartSeries } from '../../../src/components/canvas/aeroTables';

/**
 * One NaN sample must not take out the whole chart.
 *
 * `stackedBands` accumulates into a running sum, so an unguarded non-finite
 * sample would put the literal string `NaN` into the path data and poison every
 * band stacked above it. The browser silently drops a `<path>` whose `d` it
 * cannot parse, so the chart would lose whole series with nothing said anywhere.
 *
 * Non-finite samples do occur: `sweep.nonFinite` is surfaced in the UI. The
 * sibling `buildLinePath` in the same module handles them too, and these tests
 * compare the two.
 */
const X = (m: number) => m * 100;
const Y = (v: number) => 200 - v * 10;

const series = (color: string, values: (number | undefined)[]): ChartSeries => ({
  name: color,
  color,
  values: values as number[],
});

describe('stackedBands survives a non-finite sample', () => {
  const machs = [0, 0.5, 1, 1.5];

  it('emits no NaN in the path data', () => {
    const bands = stackedBands([series('#f00', [1, NaN, 3, 4])], machs, X, Y);
    for (const b of bands) expect(b.d).not.toContain('NaN');
  });

  it('keeps the band ABOVE the hole intact', () => {
    // Worse than a gap in a line: a running sum that carries the NaN forward
    // would destroy the second series with the first one's bad sample.
    const bands = stackedBands([series('#f00', [1, NaN, 3, 4]), series('#0f0', [1, 1, 1, 1])], machs, X, Y);
    expect(bands).toHaveLength(2);
    expect(bands[1]!.d).not.toContain('NaN');
    expect(bands[1]!.d.length).toBeGreaterThan(0);
  });

  it('counts the unreadable sample as zero, so the stack stays where it was', () => {
    // Not as a hole in the arithmetic: the bands above are measured from this
    // running sum, and they must sit at the height the readable samples put them.
    const withHole = stackedBands([series('#f00', [2, NaN, 2, 2]), series('#0f0', [1, 1, 1, 1])], machs, X, Y);
    const withZero = stackedBands([series('#f00', [2, 0, 2, 2]), series('#0f0', [1, 1, 1, 1])], machs, X, Y);
    expect(withHole[1]!.d).toBe(withZero[1]!.d);
  });

  it('splits the band into separate polygons around the hole', () => {
    // A gap that reads as a gap, like `buildLinePath`'s fresh `M`, rather than a
    // band pinched down to the axis at that Mach.
    const d = stackedBands([series('#f00', [1, 2, NaN, 4, 5])], [0, 0.5, 1, 1.5, 2], X, Y).at(0)!.d;
    expect((d.match(/M/g) ?? []).length).toBe(2);
    expect((d.match(/Z/g) ?? []).length).toBe(2);
  });

  it('draws an ordinary series as one closed polygon, unchanged', () => {
    const d = stackedBands([series('#f00', [1, 2, 3, 4])], machs, X, Y).at(0)!.d;
    expect((d.match(/M/g) ?? []).length).toBe(1);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('emits nothing for a series with no readable pair of samples', () => {
    // One point has no area, and a band of one sample is nothing to draw.
    expect(stackedBands([series('#f00', [NaN, 1, NaN, NaN])], machs, X, Y).at(0)!.d).toBe('');
  });

  it('skips a non-finite MACH as well as a non-finite value', () => {
    const d = stackedBands([series('#f00', [1, 2, 3, 4])], [0, NaN, 1, 1.5], X, Y).at(0)!.d;
    expect(d).not.toContain('NaN');
  });

  it('breaks at the same sample the sibling line path breaks at', () => {
    // The two surfaces read the same sweep. If one drew through a hole the other
    // broke on, the chart would contradict itself. The counts are not identical,
    // and should not be: a run of one readable sample is a point the line can
    // draw and a band cannot, because a one-sample band has no area.
    const vals = [1, NaN, 3, 4];
    expect((buildLinePath(machs, vals, X, Y).match(/M/g) ?? []).length).toBe(2);
    const d = stackedBands([series('#f00', vals)], machs, X, Y).at(0)!.d;
    expect((d.match(/M/g) ?? []).length).toBe(1);
    // And what it draws is the run after the hole, not a span across it: the two
    // x values are Mach 1 and Mach 1.5, and Mach 0 is not in there.
    const xs = [...d.matchAll(/([-\d.]+),/g)].map((m) => Number(m[1]));
    expect([...new Set(xs)].sort((a, b) => a - b)).toEqual([X(1), X(1.5)]);
  });
});

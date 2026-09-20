import { describe, it, expect } from 'vitest';
import { eventStripHeight, packEventLabels } from './FlightChartEvents';
import { EVENT_ROW_H, PAD_L, PAD_R } from './flightChartAxis';

/**
 * The event-label row packing. It was an inline useMemo; now it is a pure
 * function, so the "never overlap" promise in its comment is held here.
 */

const width = () => 40; // every label 40 px wide, so half = 20

describe('packEventLabels', () => {
  it('keeps well-separated labels on row 0', () => {
    const out = packEventLabels(
      [
        { x: 100, type: 'LAUNCH' },
        { x: 200, type: 'APOGEE' },
      ],
      640,
      width,
    );
    expect(out.map((l) => l.row)).toEqual([0, 0]);
  });

  it('bumps a label that would overlap the previous one to the next row', () => {
    const out = packEventLabels(
      [
        { x: 100, type: 'LAUNCH' },
        { x: 120, type: 'BURNOUT' },
        { x: 130, type: 'APOGEE' },
      ],
      640,
      width,
    );
    // 100 and 120 overlap (halves of 20 each), 130 overlaps both.
    expect(out.map((l) => l.row)).toEqual([0, 1, 2]);
  });

  it('reuses a row once its last label has cleared', () => {
    const out = packEventLabels(
      [
        { x: 100, type: 'LAUNCH' },
        { x: 120, type: 'BURNOUT' },
        { x: 300, type: 'APOGEE' },
      ],
      640,
      width,
    );
    expect(out[2]!.row).toBe(0);
  });

  it('drops clusters outside the plot area, with the 2 px grace', () => {
    const w = 640;
    const out = packEventLabels(
      [
        { x: PAD_L - 3, type: 'A' },
        { x: PAD_L - 2, type: 'B' },
        { x: w - PAD_R + 2, type: 'C' },
        { x: w - PAD_R + 3, type: 'D' },
      ],
      w,
      width,
    );
    expect(out.map((l) => l.type)).toEqual(['B', 'C']);
  });
});

describe('eventStripHeight', () => {
  it('is zero with no labels so the strip does not render', () => {
    expect(eventStripHeight([])).toBe(0);
  });

  it('grows by one row height per packed row', () => {
    const one = eventStripHeight([{ x: 0, type: 'A', row: 0 }]);
    const two = eventStripHeight([
      { x: 0, type: 'A', row: 0 },
      { x: 0, type: 'B', row: 1 },
    ]);
    expect(two - one).toBe(EVENT_ROW_H);
  });
});

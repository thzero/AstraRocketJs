import { describe, it, expect } from 'vitest';
import { bearingFromPad, distanceFromPad, groundTrackLine, rangeRings, trackExtent, trackPoints } from './groundTrack';
import type { FlightSeries } from '../engine/openRocketEngine';

const series = (Px: (number | null)[], Py: (number | null)[]) => ({ Px, Py }) as unknown as FlightSeries;

describe('trackPoints', () => {
  it('pairs the east and north series the kernel already ships', () => {
    expect(trackPoints(series([0, 10, 20], [0, 5, 9]))).toEqual([
      { east: 0, north: 0 },
      { east: 10, north: 5 },
      { east: 20, north: 9 },
    ]);
  });

  /**
   * Zero is the PAD, so substituting it for a missing sample would draw a line
   * back to the launch point and out again — a track that reads as a flight
   * that briefly teleported home.
   */
  it('drops a sample whose other half is missing, rather than calling it zero', () => {
    expect(trackPoints(series([0, null, 20], [0, 5, 9]))).toEqual([
      { east: 0, north: 0 },
      { east: 20, north: 9 },
    ]);
    expect(trackPoints(series([0, 10, 20], [0, Infinity, 9]))).toHaveLength(2);
  });

  it('draws nothing when the run carried no horizontal series at all', () => {
    expect(trackPoints(undefined)).toEqual([]);
    expect(trackPoints({} as FlightSeries)).toEqual([]);
  });

  it('stops at the shorter of the two, so a ragged pair cannot read past its end', () => {
    expect(trackPoints(series([0, 1, 2, 3], [0, 1]))).toHaveLength(2);
  });
});

describe('distance and bearing from the pad', () => {
  it('measures a straight line, whatever the direction', () => {
    expect(distanceFromPad({ east: 3, north: 4 })).toBe(5);
    expect(distanceFromPad({ east: -3, north: -4 })).toBe(5);
  });

  it('reads as a compass: 0 north, 90 east, 180 south, 270 west', () => {
    expect(bearingFromPad({ east: 0, north: 10 })).toBe(0);
    expect(bearingFromPad({ east: 10, north: 0 })).toBe(90);
    expect(bearingFromPad({ east: 0, north: -10 })).toBe(180);
    // Not -90: a bearing is stated 0-360, which is how it is read off a compass
    // and how the flight-path export already writes it.
    expect(bearingFromPad({ east: -10, north: 0 })).toBe(270);
  });
});

describe('groundTrackLine', () => {
  it('lands on the last usable sample and measures the walk from the pad', () => {
    const l = groundTrackLine('k', 'C6', '#38bdf8', series([0, 30, 40], [0, 0, 30]));
    expect(l.landing).toEqual({ east: 40, north: 30 });
    expect(l.distance).toBe(50);
    expect(Math.round(l.bearing)).toBe(53);
  });

  it('has no landing point at all when there is no track', () => {
    const l = groundTrackLine('k', 'C6', '#38bdf8', undefined);
    expect(l.landing).toBeNull();
    expect(l.distance).toBe(0);
  });
});

/**
 * The frame is SQUARE and centered on the pad. Scaling the axes independently
 * would bend a straight drift into a curve and make a circle of equal distance
 * read as an ellipse, which is exactly what the range rings are there to deny.
 */
describe('trackExtent', () => {
  it('spans the furthest point on EITHER axis, across every track', () => {
    const a = groundTrackLine('a', 'A', '#fff', series([0, 100], [0, 10]));
    const b = groundTrackLine('b', 'B', '#fff', series([0, 10], [0, 250]));
    expect(trackExtent([a, b])).toBeCloseTo(275, 6); // 250 + 10% air
  });

  it('counts a drift the other way just the same', () => {
    const a = groundTrackLine('a', 'A', '#fff', series([0, -400], [0, 0]));
    expect(trackExtent([a])).toBeCloseTo(440, 6);
  });

  it('never returns zero, so a rocket that never left the pad still has an axis', () => {
    expect(trackExtent([])).toBe(1);
    expect(trackExtent([groundTrackLine('a', 'A', '#fff', series([0, 0], [0, 0]))])).toBe(1);
  });
});

describe('rangeRings', () => {
  it('steps on the 1/2/5 ladder, so the labels are numbers a person reads', () => {
    // The step rounds UP onto the ladder, so `count` is a ceiling rather than a
    // target: 275/4 is 68.75, which rounds to 100 and rings twice. Sparse is the
    // right way to be wrong here - a ring is a reference, and a map crowded with
    // them is harder to read than one with two.
    expect(rangeRings(275)).toEqual([100, 200]);
    expect(rangeRings(1000)).toEqual([500, 1000]);
    expect(rangeRings(4)).toEqual([1, 2, 3, 4]);
  });

  it('never rings past the extent, so no label sits outside the frame', () => {
    for (const extent of [3, 17, 240, 999, 12345]) {
      for (const r of rangeRings(extent)) expect(r).toBeLessThanOrEqual(extent + 1e-9);
    }
  });

  it('honors a different ring count', () => {
    expect(rangeRings(1000, 2).length).toBeLessThanOrEqual(2);
  });

  it('never rings a zero extent', () => {
    expect(rangeRings(0)).toEqual([]);
  });
});

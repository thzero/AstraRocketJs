import { describe, it, expect } from 'vitest';
import { clampWindow, minWindow, resolveWindow, zoomWindow } from './flightChartAxis';

/**
 * The zoom/pan window math, now pure so the clamps that used to live inside
 * the component's closures can be pinned without a pointer.
 */

describe('clampWindow', () => {
  it('collapses a window that covers the whole flight to null', () => {
    expect(clampWindow(0, 10, 10)).toBeNull();
    expect(clampWindow(-5, 50, 10)).toBeNull();
  });

  it('keeps an interior window as is', () => {
    expect(clampWindow(2, 4, 10)).toEqual({ t0: 2, t1: 4 });
  });

  it('slides a window that runs off either end back inside', () => {
    expect(clampWindow(-1, 1, 10)).toEqual({ t0: 0, t1: 2 });
    expect(clampWindow(9, 11, 10)).toEqual({ t0: 8, t1: 10 });
  });

  it('never goes narrower than the minimum window', () => {
    const w = clampWindow(5, 5.0001, 10);
    expect(w).not.toBeNull();
    expect(w!.t1 - w!.t0).toBeCloseTo(minWindow(10), 9);
  });
});

describe('zoomWindow', () => {
  it('keeps the anchor at the same fraction of the window', () => {
    // Anchor at 25% of [0, 8]; zoom in by half; anchor must still be at 25%.
    const w = zoomWindow(0, 8, 0.5, 2, 10)!;
    expect(w.t1 - w.t0).toBeCloseTo(4, 9);
    expect((2 - w.t0) / (w.t1 - w.t0)).toBeCloseTo(0.25, 9);
  });

  it('zooming out past the flight returns to full view', () => {
    expect(zoomWindow(2, 4, 100, 3, 10)).toBeNull();
  });
});

describe('resolveWindow', () => {
  it('is the full flight when there is no zoom', () => {
    expect(resolveWindow(null, 10)).toEqual({ t0: 0, t1: 10, zoomed: false });
  });

  it('clamps a stale window to a flight that re-ran shorter', () => {
    // The window was zoomed on a 30 s run; the re-run lands at 8 s.
    const r = resolveWindow({ t0: 20, t1: 25 }, 8);
    expect(r.t1).toBe(8);
    expect(r.t0).toBeLessThan(r.t1);
    expect(r.zoomed).toBe(true);
  });
});

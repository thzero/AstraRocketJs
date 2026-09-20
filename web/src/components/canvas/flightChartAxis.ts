import type { FlightSeries } from '../../engine/openRocketEngine';

/**
 * Owns the flight chart's shared x-axis: the horizontal layout constants every
 * panel and the event strip agree on, the axis extent, and the pure
 * time-window math behind zoom and pan (clamp, zoom about an anchor, resolve
 * a saved window against the current flight). No React here; useChartZoom
 * holds the state and calls these.
 */

// Shared horizontal geometry so the crosshair lines up across panels; the
// scroll host's px-3 (12px) left inset is added back when mapping pointer x.
export const PAD_L = 44;
export const PAD_R = 12;
export const HOST_INSET = 12;
export const PANEL_H = 208;
export const EVENT_ROW_H = 12; // one row of the event-label strip

/** The narrowest zoom window: 1/500 of the flight, never under 50 ms. */
export const minWindow = (maxT: number) => Math.max(maxT / 500, 0.05);

/**
 * The x-axis extent: the longest time any branch reaches.
 *
 * Loop, do not spread. This used to be
 *   Math.max(flightTime, ...branches.flatMap((b) => b.series.time))
 * evaluated in the render body, so it re-ran on EVERY pointer move (hover sets
 * state) and, for a fine-timestep multi-stage flight, pushed a six-figure
 * argument list into Math.max — which throws RangeError and blanks the panel.
 * FlightPath3D avoids the identical hazard the identical way.
 */
export function maxFlightTime(branches: { series: FlightSeries }[], flightTime: number | undefined): number {
  let m = Math.max(flightTime || 1, 1);
  for (const b of branches) for (const t of b.series.time ?? []) if (t > m) m = t;
  return m;
}

/** Visible time window; null = the full flight. */
export interface TimeWindow {
  t0: number;
  t1: number;
}

/**
 * Clamp a proposed window [a, b] to the flight: never narrower than
 * `minWindow`, never wider than the flight, never past either end. A window
 * that covers the whole flight collapses to null (fully zoomed out).
 */
export function clampWindow(a: number, b: number, maxT: number): TimeWindow | null {
  const width = Math.min(Math.max(b - a, minWindow(maxT)), maxT);
  if (width >= maxT - 1e-9) return null; // fully zoomed out → no window
  const lo = Math.min(Math.max(a, 0), maxT - width);
  return { t0: lo, t1: lo + width };
}

/** Zoom the window [t0, t1] by `factor` (<1 = in), keeping `anchorT` under
 *  the same screen x. */
export function zoomWindow(t0: number, t1: number, factor: number, anchorT: number, maxT: number): TimeWindow | null {
  const nw = (t1 - t0) * factor;
  const na0 = anchorT - (anchorT - t0) * factor;
  return clampWindow(na0, na0 + nw, maxT);
}

/**
 * The window actually shown for a saved zoom, clamped to the CURRENT flight's
 * span at read time: a re-run of the same simulation can land shorter than
 * the window zoomed on the previous run, and the window used to be reset by
 * an effect keyed on the trace list, which a re-run does not change, so the
 * stale window survived it.
 */
export function resolveWindow(zoom: TimeWindow | null, maxT: number): { t0: number; t1: number; zoomed: boolean } {
  const t1 = zoom ? Math.min(zoom.t1, maxT) : maxT;
  const t0 = zoom ? Math.min(zoom.t0, Math.max(0, t1 - minWindow(maxT))) : 0;
  return { t0, t1, zoomed: t1 - t0 < maxT - 1e-9 };
}

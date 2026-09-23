import type { FlightSeries } from '../engine/openRocketEngine';

/**
 * The flight seen from directly above: where the rocket went over the GROUND,
 * with height thrown away.
 *
 * The 3D path view answers "how did it fly"; this answers "where does it come
 * down, and how far from the pad" — which on a breezy day is the difference
 * between a walk and a search. The app could already answer it OUTSIDE itself
 * (`flightPathExport.ts` projects the same drift onto lat/lon and ships KML and
 * GPX), so this is the same question asked without leaving the app.
 *
 * Meters from the pad, not lat/lon. A plan view is read against the field you
 * are standing on, so the pad is the origin and the numbers are the ones you
 * pace out; projecting to coordinates would add the geodesy the export needs
 * and answer nothing extra. `Px` / `Py` are what the kernel ships (east and
 * north, meters), in the default summary set, so no engine work is involved.
 */

/** One point of a track: meters east and north of the pad. */
export interface GroundPoint {
  east: number;
  north: number;
}

/** One flight's (or one stage's) path over the ground. */
export interface GroundTrackLine {
  /** Matches the flight chart's trace key, so the two views agree on identity. */
  key: string;
  name: string;
  color: string;
  points: GroundPoint[];
  /** Where it came down: the last usable sample, or null for an empty track. */
  landing: GroundPoint | null;
  /** Straight-line distance from the pad to `landing`, meters. */
  distance: number;
  /** Compass bearing from the pad to `landing`, degrees clockwise from north. */
  bearing: number;
}

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/**
 * Pull the horizontal track out of one branch's series.
 *
 * A sample is kept only when BOTH components are finite. Dropping a half-valid
 * sample rather than substituting zero matters: zero is the pad, so a single
 * null would otherwise draw a line back to the launch point and out again.
 */
export function trackPoints(series: FlightSeries | undefined): GroundPoint[] {
  const east = series?.['Px'];
  const north = series?.['Py'];
  if (!east || !north) return [];
  const n = Math.min(east.length, north.length);
  const out: GroundPoint[] = [];
  for (let i = 0; i < n; i++) {
    const e = east[i];
    const nr = north[i];
    if (finite(e) && finite(nr)) out.push({ east: e, north: nr });
  }
  return out;
}

/** Distance from the pad, meters. */
export const distanceFromPad = (p: GroundPoint): number => Math.hypot(p.east, p.north);

/** Compass bearing from the pad, degrees clockwise from north (0 = due north). */
export const bearingFromPad = (p: GroundPoint): number => ((Math.atan2(p.east, p.north) * 180) / Math.PI + 360) % 360;

/** Build one drawable line from a branch's series. */
export function groundTrackLine(
  key: string,
  name: string,
  color: string,
  series: FlightSeries | undefined,
): GroundTrackLine {
  const points = trackPoints(series);
  const landing = points.length ? points[points.length - 1]! : null;
  return {
    key,
    name,
    color,
    points,
    landing,
    distance: landing ? distanceFromPad(landing) : 0,
    bearing: landing ? bearingFromPad(landing) : 0,
  };
}

/**
 * The closest this view ever zooms in: half a side, so a hundred meters across.
 *
 * Sizing purely to the flight is right for a breezy day and absurd for a calm
 * one. Still air lands a rocket about a tenth of a meter from the pad, and a
 * plan view scaled to THAT is a picture of ten centimeters of grass: range
 * rings labeled 0.05 m, a track that is a straight line whatever it did, and no
 * aerial imagery at all, because nobody photographs the ground that closely.
 *
 * A hundred meters across is the frame the question is actually asked in. It is
 * the pad, the flight line and the near treeline; a landing on the pad reads as
 * a dot ON the pad, which is the truth, and a fifty-meter walk still reads as
 * half the radius. It also sits inside the best aerial imagery's resolution, so
 * the map under the track is a map rather than four blown-up pixels.
 */
export const MIN_EXTENT_M = 50;

/**
 * The square half-extent, in meters, that contains every track and the pad.
 *
 * SQUARE, and centered on the pad, on purpose: a plan view whose axes are scaled
 * differently is not a map — it would bend a straight drift into a curve and
 * make a circle of equal distance read as an ellipse. Centering on the pad keeps
 * the launch point where the reader expects it rather than drifting with the
 * wind.
 *
 * Floored at {@link MIN_EXTENT_M}, so a flight that never left the pad gets a
 * field around it rather than an axis measured in centimeters.
 */
export function trackExtent(lines: readonly GroundTrackLine[]): number {
  let m = 0;
  for (const l of lines) {
    for (const p of l.points) {
      const d = Math.max(Math.abs(p.east), Math.abs(p.north));
      if (d > m) m = d;
    }
  }
  // A little air around the furthest point so a landing marker is not clipped
  // by the frame it sits on.
  return Math.max(MIN_EXTENT_M, m * 1.1);
}

/**
 * Radii for the range rings, in meters: at most `count`, on a 1/2/5 × 10ⁿ step.
 *
 * The rings are what turn the picture into a measurement — without them a drift
 * is just a squiggle. The step comes off the same 1/2/5 ladder chart axes use,
 * so the labels are numbers a person reads ("200 m") rather than whatever the
 * extent divided by four happened to be.
 */
export function rangeRings(extent: number, count = 4): number[] {
  if (!(extent > 0)) return [];
  const rough = extent / count;
  const exp = Math.floor(Math.log10(rough));
  const mag = 10 ** exp;
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  // Rounded to the step's own decade, because neither `i * step` nor a running
  // `r += step` is exact: both give 0.1, 0.2, 0.30000000000000004 for a 0.1 m
  // step. Every radius is an integer multiple of `mag = 10**exp`, so it has at
  // most `-exp` real decimals and anything past that is float noise. Rounding
  // it off here means a caller that prints the radius unformatted still gets a
  // readable label, rather than depending on its own formatter to hide this.
  const dp = Math.max(0, -exp);
  const out: number[] = [];
  for (let i = 1; i * step <= extent + 1e-9; i++) out.push(Number((i * step).toFixed(dp)));
  return out;
}

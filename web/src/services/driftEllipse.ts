import { distanceFromPad, type GroundPoint } from './groundTrack';

/**
 * The ground a rocket could come down on, from the landings a wind sweep flew.
 *
 * Two shapes, because they answer two different questions and neither is the
 * other:
 *
 * - The HULL is the exact swept envelope. The sweep is a grid, so its landings
 *   are not a sample from anything — they are the whole set of answers to the
 *   conditions that were asked about, and the smallest convex region holding
 *   them is a statement with no statistics in it: fly one of these winds and
 *   the rocket lands in here. That is the shape to walk out and look at.
 * - The ELLIPSE is the familiar recovery-ellipse reading: the spread of those
 *   landings as a center, two axes and a bearing. It compresses the picture to
 *   four numbers you can write on a flight card, and it is the shape that
 *   compares across designs, motors and days.
 *
 * The ellipse is deliberately NOT called a confidence region. A confidence
 * region needs a distribution over the conditions, and a grid sweep asserts
 * none — every cell is flown once, whatever its real-world likelihood. What the
 * ellipse describes is the scatter of the landings that were flown, at a stated
 * number of standard deviations. Over a whole-compass sweep it will sit INSIDE
 * the ring of landings, which is correct and is exactly why the hull is drawn
 * as well.
 *
 * Everything here is meters east and north of the pad, the same plane
 * `groundTrack.ts` works in.
 */

/** How many standard deviations the drawn ellipse spans. */
export const DEFAULT_SIGMA = 2;

/** Mean landing point, or null for an empty set. */
export function centroid(points: readonly GroundPoint[]): GroundPoint | null {
  if (!points.length) return null;
  let east = 0;
  let north = 0;
  for (const p of points) {
    east += p.east;
    north += p.north;
  }
  return { east: east / points.length, north: north / points.length };
}

/** Cross product of (o→a) and (o→b); positive when o→a→b turns counterclockwise. */
const cross = (o: GroundPoint, a: GroundPoint, b: GroundPoint): number =>
  (a.east - o.east) * (b.north - o.north) - (a.north - o.north) * (b.east - o.east);

/**
 * The convex hull, counterclockwise, by Andrew's monotone chain.
 *
 * Collinear points are dropped (`<= 0`, not `< 0`), so a sweep of one heading —
 * whose landings lie on a straight line out from the pad — comes back as its
 * two ends rather than as every sample along it. That degenerate hull is a line
 * segment, which is the truth about that sweep, and the drawing treats it as
 * one rather than pretending to an area.
 *
 * Fewer than three distinct points cannot bound anything, so they are returned
 * as they are.
 */
export function convexHull(points: readonly GroundPoint[]): GroundPoint[] {
  const pts = [...points].sort((a, b) => a.east - b.east || a.north - b.north);
  // Duplicate landings are common: two cells of the grid can land in the same
  // place to the millimeter when the wind barely moved. They add nothing and
  // they upset the turn test.
  const uniq = pts.filter((p, i) => i === 0 || p.east !== pts[i - 1]!.east || p.north !== pts[i - 1]!.north);
  if (uniq.length < 3) return uniq;

  const half = (source: GroundPoint[]): GroundPoint[] => {
    const out: GroundPoint[] = [];
    for (const p of source) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop(); // the shared endpoint, contributed by the other half
    return out;
  };

  const hull = [...half(uniq), ...half([...uniq].reverse())];
  // Every point collinear: both halves reduce to the two ends, and what comes
  // back is that segment rather than a zero-area ring of four.
  return hull.length >= 3 ? hull : uniq.slice(0, 1).concat(uniq.slice(-1));
}

/** The area a closed polygon encloses, square meters (shoelace, sign dropped). */
export function polygonArea(points: readonly GroundPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.east * b.north - b.east * a.north;
  }
  return Math.abs(sum) / 2;
}

/** The scatter of a set of landings, as an oriented ellipse. */
export interface DriftEllipse {
  center: GroundPoint;
  /** Half the long axis, meters. */
  semiMajorM: number;
  /** Half the short axis, meters. */
  semiMinorM: number;
  /** Compass bearing of the long axis, degrees clockwise from north. */
  bearingDeg: number;
  /** How many standard deviations the axes span. */
  sigma: number;
}

/**
 * The covariance ellipse of these landings, at `sigma` standard deviations.
 *
 * The sample covariance (divided by n-1, so two landings describe the spread
 * BETWEEN them rather than half of it) diagonalized by hand: a symmetric 2x2
 * has closed-form eigenvalues and eigenvectors, and pulling in a matrix library
 * for one would be four hundred kilobytes to avoid six lines.
 *
 * Null below two points, because one landing has no spread to describe. A
 * perfectly collinear set gives a zero minor axis, which draws as a line and is
 * again the truth rather than a failure.
 */
export function driftEllipse(points: readonly GroundPoint[], sigma = DEFAULT_SIGMA): DriftEllipse | null {
  const center = centroid(points);
  if (!center || points.length < 2) return null;

  let see = 0;
  let snn = 0;
  let sen = 0;
  for (const p of points) {
    const de = p.east - center.east;
    const dn = p.north - center.north;
    see += de * de;
    snn += dn * dn;
    sen += de * dn;
  }
  const n = points.length - 1;
  see /= n;
  snn /= n;
  sen /= n;

  const mean = (see + snn) / 2;
  // The eigenvalue gap. Clamped at zero because a covariance matrix's
  // discriminant is non-negative in exact arithmetic and can land a hair below
  // it in floating point, which would make the square root NaN.
  const gap = Math.sqrt(Math.max(0, ((see - snn) / 2) ** 2 + sen * sen));
  const major = Math.max(0, mean + gap);
  const minor = Math.max(0, mean - gap);

  // Eigenvector for the larger eigenvalue. With no covariance the axes are
  // already the eigenvectors, and which of the two is the long one is decided
  // by which variance is larger — atan2(0, 0) would otherwise answer 0 and call
  // a north-south spread an east-west one.
  const [ve, vn] = sen !== 0 ? [major - snn, sen] : see >= snn ? [1, 0] : [0, 1];

  return {
    center,
    semiMajorM: sigma * Math.sqrt(major),
    semiMinorM: sigma * Math.sqrt(minor),
    bearingDeg: ((Math.atan2(ve, vn) * 180) / Math.PI + 360) % 360,
    sigma,
  };
}

/**
 * The ellipse as a closed polygon, so whoever draws it only has to map points
 * through the same projection the tracks use.
 *
 * An SVG `<ellipse>` with a rotation transform would have to be re-derived
 * against whatever transform the view already applies, and would silently go
 * wrong the first time the two axes stopped sharing a scale. A polygon cannot.
 */
export function ellipsePolygon(e: DriftEllipse, segments = 72): GroundPoint[] {
  // The major axis as a unit vector in east/north, from its compass bearing.
  const rad = (e.bearingDeg * Math.PI) / 180;
  const me = Math.sin(rad);
  const mn = Math.cos(rad);
  // The minor axis is the major turned a quarter turn; in east/north that is
  // (e, n) -> (-n, e).
  return Array.from({ length: segments }, (_, i) => {
    const th = (2 * Math.PI * i) / segments;
    const a = e.semiMajorM * Math.cos(th);
    const b = e.semiMinorM * Math.sin(th);
    return { east: e.center.east + a * me - b * mn, north: e.center.north + a * mn + b * me };
  });
}

/** One stage's drift, everything the ground track draws and reads out. */
export interface DriftRegion {
  /** Branch index, matching the ground track's own per-stage traces. */
  branch: number;
  samples: GroundPoint[];
  centroid: GroundPoint;
  /** The swept envelope, counterclockwise. Two points for a collinear sweep. */
  hull: GroundPoint[];
  /** Null when fewer than two landings were flown. */
  ellipse: DriftEllipse | null;
  /** The furthest landing from the pad, meters — the walk to plan for. */
  maxRangeM: number;
  /** The nearest landing, meters. */
  minRangeM: number;
  /** Ground the envelope covers, square meters. Zero for a collinear sweep. */
  areaM2: number;
}

/** Everything derivable from one stage's landings, or null if there are none. */
export function driftRegion(
  branch: number,
  samples: readonly GroundPoint[],
  sigma = DEFAULT_SIGMA,
): DriftRegion | null {
  const center = centroid(samples);
  if (!center) return null;
  const ranges = samples.map(distanceFromPad);
  const hull = convexHull(samples);
  return {
    branch,
    samples: [...samples],
    centroid: center,
    hull,
    ellipse: driftEllipse(samples, sigma),
    maxRangeM: Math.max(...ranges),
    minRangeM: Math.min(...ranges),
    areaM2: polygonArea(hull),
  };
}

/**
 * OpenRocket's **Import from image** for a freeform fin, and the **Export CSV**
 * beside it.
 *
 * Trace a fin off a photograph or a scanned plan: the image is reduced to black
 * and white, the outline is walked pixel by pixel from the bottom edge, and the
 * result is simplified into the handful of vertices a fin actually has. Ported
 * from `CustomFinImporter`, edge-follower and simplifier both, because the
 * simplifier's tolerance is what decides whether a traced fin comes back as six
 * points or six hundred.
 *
 * ONE PIXEL IS ONE MILLIMETER, which is upstream's fixed scale and not a
 * guess. The traced fin therefore comes in at whatever size the image happens
 * to be, and Scale fin is the other half of the workflow.
 */

/** Anything with the pixels of an image: a canvas `ImageData`, or a fixture. */
export type Pixels = {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel, row by row from the top left. */
  data: Uint8ClampedArray | Uint8Array;
};

export type FinPoint = [number, number];

/** A pixel is fin when it is dark: `CustomFinImporter.validateImage`'s luma cut. */
const LUMA_CUT = 200;

/** How far a point may sit off a straight line and still be dropped (m). */
const FLATNESS = 0.0008;

/** Meters per pixel. Upstream's fixed scale, not a calibration. */
const M_PER_PIXEL = 0.001;

/**
 * The image could not be read as a fin.
 *
 * Its own class because the one failure mode worth naming is the SHAPE of the
 * image rather than a coding error: a fin that does not touch the bottom edge
 * has no root for the tracer to start from, which is what the desktop's own
 * message says.
 */
export class FinImageError extends Error {
  constructor(public readonly reason: 'notTouchingBottom' | 'noOutline') {
    super(reason);
    this.name = 'FinImageError';
  }
}

type Facing = 'up' | 'down' | 'left' | 'right';

/** Luma, then threshold: `0.299 R + 0.587 G + 0.114 B`, dark is fin. */
function darkMask(img: Pixels): Uint8Array {
  const mask = new Uint8Array(img.width * img.height);
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4;
    const luma = 0.299 * (img.data[p] ?? 0) + 0.587 * (img.data[p + 1] ?? 0) + 0.114 * (img.data[p + 2] ?? 0);
    mask[i] = luma > LUMA_CUT ? 0 : 1;
  }
  return mask;
}

/**
 * Walk the outline clockwise from the leftmost fin pixel on the bottom edge.
 *
 * A wall follower: prefer to turn left, else go straight, else turn right, else
 * turn around. It stops when it comes back down to the bottom edge, which is the
 * fin's root, so the outline it returns is the fin's planform and not the whole
 * image boundary.
 */
function traceOutline(img: Pixels, mask: Uint8Array, startX: number): FinPoint[] {
  const { width, height } = img;
  const isFin = (x: number, y: number): boolean =>
    x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] === 1;

  const left: Record<Facing, [number, number]> = { down: [1, 0], up: [-1, 0], left: [0, 1], right: [0, -1] };
  const right: Record<Facing, [number, number]> = { down: [-1, 0], up: [1, 0], left: [0, -1], right: [0, 1] };
  const ahead: Record<Facing, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
  const turnLeft: Record<Facing, Facing> = { up: 'left', right: 'up', down: 'right', left: 'down' };
  const turnRight: Record<Facing, Facing> = { up: 'right', right: 'down', down: 'left', left: 'up' };
  const about: Record<Facing, Facing> = { up: 'down', down: 'up', right: 'left', left: 'right' };

  const points: FinPoint[] = [[0, 0]];
  let facing: Facing = 'up';
  let x = startX;
  let y = height - 1;
  let offBottom = false;
  // The image is the bound on the walk: a follower that somehow fails to come
  // back to the bottom edge would otherwise circle forever.
  const limit = 8 * width * height;

  for (let step = 0; step < limit; step++) {
    if (isFin(x + left[facing][0], y + left[facing][1])) facing = turnLeft[facing];
    else if (isFin(x + ahead[facing][0], y + ahead[facing][1])) {
      // Straight on.
    } else if (isFin(x + right[facing][0], y + right[facing][1])) facing = turnRight[facing];
    else facing = about[facing];

    const [dx, dy] = ahead[facing];
    // Clamped rather than wrapped: the tracer follows the image edge where the
    // fin runs off it, which is how a fin drawn flush to the side is read.
    x = Math.min(width - 1, Math.max(0, x + dx));
    y = Math.min(height - 1, Math.max(0, y + dy));

    if (y < height - 1) offBottom = true;
    if (isFin(x, y)) points.push([(x - startX) * M_PER_PIXEL, (height - y - 1) * M_PER_PIXEL]);
    if (offBottom && y >= height - 1) break;
  }
  return points;
}

/** The closest point to `p` on the segment `a`-`b`. */
function closestOnSegment(a: FinPoint, b: FinPoint, p: FinPoint): FinPoint {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const numerator = (p[0] - a[0]) * dx + (p[1] - a[1]) * dy;
  if (numerator <= 0) return a;
  const denom = dx * dx + dy * dy;
  if (numerator >= denom) return b;
  const t = numerator / denom;
  return [a[0] + dx * t, a[1] + dy * t];
}

function distanceFromLine(a: FinPoint, b: FinPoint, p: FinPoint): number {
  const c = closestOnSegment(a, b, p);
  return Math.hypot(p[0] - c[0], p[1] - c[1]);
}

/**
 * Collapse runs of points that lie on a straight line, longest run first.
 *
 * `CustomFinImporter.optimizePoints`, and the greedy direction matters: from
 * each surviving point it reaches for the FURTHEST point it can still see in a
 * straight line, so a traced straight edge comes back as its two ends rather
 * than as a staircase of short segments. Upstream repeats the whole pass until
 * it stops removing anything, and so does this.
 */
function simplify(input: FinPoint[]): FinPoint[] {
  let points = input;
  for (;;) {
    const before = points.length;
    const out: FinPoint[] = [];
    let i = 0;
    while (i < points.length) {
      out.push(points[i]!);
      if (i === points.length - 1) break;
      let best = i + 1;
      for (let j = points.length - 1; j > i + 1; j--) {
        let flat = true;
        for (let k = i + 1; k < j; k++) {
          if (distanceFromLine(points[i]!, points[j]!, points[k]!) > FLATNESS) {
            flat = false;
            break;
          }
        }
        if (flat) {
          best = j;
          break;
        }
      }
      i = best;
    }
    points = out;
    if (points.length === before) return points;
  }
}

/**
 * The fin outline traced out of an image, in meters, root on `y = 0`.
 *
 * Throws {@link FinImageError} when the image cannot be read as a fin: nothing
 * dark on the bottom edge, so there is no root to start from, or a trace that
 * comes back with fewer than three points.
 */
export function finPointsFromImage(img: Pixels): FinPoint[] {
  if (!(img.width > 0 && img.height > 0)) throw new FinImageError('notTouchingBottom');
  const mask = darkMask(img);
  // The leftmost dark pixel on the bottom row: the fin's leading root corner,
  // and the origin every traced point is measured from.
  let startX = -1;
  const bottom = (img.height - 1) * img.width;
  for (let x = 0; x < img.width; x++) {
    if (mask[bottom + x] === 1) {
      startX = x;
      break;
    }
  }
  if (startX < 0) throw new FinImageError('notTouchingBottom');
  const traced = simplify(traceOutline(img, mask, startX));
  if (traced.length < 3) throw new FinImageError('noOutline');
  return traced;
}

/**
 * The point table as OpenRocket writes it: an `X / <unit>, Y / <unit>` header
 * and one row per point, in the unit the editor is showing.
 *
 * The trailing separator on every line and the CRLF endings are upstream's, kept
 * so a script that already reads these files keeps working. It does mean a
 * spreadsheet shows a third, empty column.
 */
export function finPointsCsv(points: readonly FinPoint[], unitSymbol: string, toUi: (m: number) => number): string {
  const rows = [`X / ${unitSymbol}, Y / ${unitSymbol}, `];
  for (const [x, y] of points) rows.push(`${toUi(x)}, ${toUi(y)}, `);
  return rows.join('\r\n') + '\r\n';
}

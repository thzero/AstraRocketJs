/**
 * Nose-cone / transition radius profiles: an exact port of the carved
 * kernel's Transition.Shape.getRadius() implementations and the
 * Transition.getRadius() outer-profile logic (incl. the clipped path), so the
 * 2D schematic and the 3D view draw the same geometry the engine flies.
 *
 * Kernel semantics mirrored here:
 * - A nose cone is never clipped (NoseCone.isClipped() → false): its profile
 *   is Shape.getRadius(x, aftRadius, length, param) directly.
 * - A transition built by the bridge keeps the kernel default clipped state,
 *   which setShapeType() leaves at type.isClippable(), so ellipsoid / power /
 *   haack transitions simulate (and therefore must draw) clipped: the profile
 *   is the continuation of the virtual nose shape, cut off at the fore radius.
 *   Conical / ogive / parabolic transitions are never clippable.
 * - A node can override that default (the .ork <shapeclipped> flag, forwarded
 *   to the engine bridge as node['clipped']): outerProfile's `clipped`
 *   argument mirrors Transition.isClipped(). Non-clippable shapes ignore it
 *   entirely, absent means the kernel default (clipped), and an explicit
 *   false draws the unclipped delta shape r1 + shape(x, r2−r1, length), the
 *   same profile the engine then flies.
 */
import type { ComponentNode } from '../engine/openRocketEngine';
import { KERNEL_DEFAULTS, KERNEL_SHAPES } from './kernelDefaults';
import { num, numOpt } from './nodeProps';

const MINFEATURE = 0.001;
const CLIP_PRECISION = 0.0001;
// Hard ceiling on the bisection in calculateClip(). 60 halvings take any
// double-precision interval below CLIP_PRECISION; see the guard there.
const CLIP_MAX_HALVINGS = 60;

const safeSqrt = (v: number): number => Math.sqrt(Math.max(0, v));
const pow2 = (x: number): number => x * x;
const pow3 = (x: number): number => x * x * x;

/** Mirrors Transition.Shape.defaultParameter() in the carved kernel. */
export function shapeParamDefault(shape: string): number {
  switch (shape) {
    case 'ogive':
    case 'parabolic':
      return 1.0;
    case 'power':
      return 0.5;
    default:
      return 0.0; // conical, ellipsoid, haack
  }
}

/** Mirrors Shape.usesParameter(): whether the shape-parameter field matters. */
export function shapeUsesParameter(shape: string): boolean {
  return shape === 'ogive' || shape === 'power' || shape === 'parabolic' || shape === 'haack';
}

/** Mirrors Shape.maxParameter() (haack tops out at LV-Haack, 1/3). */
export function shapeParamMax(shape: string): number {
  return shape === 'haack' ? 1 / 3 : 1;
}

/** Mirrors Shape.isClippable(): ellipsoid, power and haack transitions clip. */
export function shapeIsClippable(shape: string): boolean {
  return shape === 'ellipsoid' || shape === 'power' || shape === 'haack';
}

/**
 * Shape.getRadius(x, radius, length, param): radius of the pure shape at
 * distance x from its (virtual) tip. Exact port, shape by shape.
 */
export function shapeRadius(shape: string, x: number, radius: number, length: number, param: number): number {
  // A degenerate shape (zero/negative/non-finite length or radius) has no
  // profile: every branch below divides by `length` (or, for ogive, by
  // `radius`), so return 0 rather than emit Infinity/NaN. outerProfile already
  // guards length<=0 and passes a positive delta radius, so this only shields
  // direct callers.
  if (!(length > 0) || !(radius > 0)) return 0;
  switch (shape) {
    case 'conical':
      return (radius * x) / length;
    case 'ellipsoid': {
      const xs = (x * radius) / length;
      return safeSqrt(2 * radius * xs - xs * xs); // radius/length * sphere
    }
    case 'power': {
      if (param <= 0.00001) {
        return x <= 0.00001 ? 0 : radius;
      }
      return radius * Math.pow(x / length, param);
    }
    case 'parabolic':
      return radius * (((2 * x) / length - param * pow2(x / length)) / (2 - param));
    case 'haack': {
      const theta = Math.acos(1 - (2 * x) / length);
      if (param === 0) {
        return radius * safeSqrt((theta - Math.sin(2 * theta) / 2) / Math.PI);
      }
      return radius * safeSqrt((theta - Math.sin(2 * theta) / 2 + param * pow3(Math.sin(theta))) / Math.PI);
    }
    case 'ogive':
    default: {
      // Impossible to calculate ogive for length < radius, scale instead.
      if (length < radius) {
        x = (x * radius) / length;
        length = radius;
      }
      if (param < MINFEATURE) {
        return shapeRadius('conical', x, radius, length, param);
      }
      const R = safeSqrt(
        ((pow2(length) + pow2(radius)) * (pow2((2 - param) * length) + pow2(param * radius))) /
          (4 * pow2(param * radius)),
      );
      const L = length / param;
      const y0 = safeSqrt(R * R - L * L);
      return safeSqrt(R * R - (L - x) * (L - x)) - y0;
    }
  }
}

/**
 * Transition.calculateClip(): solve clipLength from
 * r1 == getRadius(clipLength, r2, clipLength + length) by binary search.
 * Assumes r1 < r2 (the caller has already flipped).
 */
function calculateClip(shape: string, param: number, length: number, r1: number, r2: number): number {
  let min = 0;
  let max = length;
  // Non-finite input makes `max - min` NaN below, and NaN compares false
  // against everything, so the bisection's only exit could never fire and a
  // hostile transition length would hang the tab. The Java has the same loop but its
  // callers can never hand it NaN; ours read a file.
  if (r1 === 0 || !Number.isFinite(length) || length <= 0 || !Number.isFinite(r1) || !Number.isFinite(r2)) return 0;
  let n = 0;
  while (shapeRadius(shape, max, r2, max + length, param) - r1 < 0) {
    min = max;
    max *= 2;
    n++;
    if (n > 10) break;
  }
  // Halving a finite interval reaches any precision within a few dozen steps;
  // the cap only matters when the doubling above overflowed to Infinity.
  for (let i = 0; i < CLIP_MAX_HALVINGS; i++) {
    const clip = (min + max) / 2;
    if (max - min < CLIP_PRECISION) return clip;
    const val = shapeRadius(shape, clip, r2, clip + length, param);
    if (val - r1 > 0) {
      max = clip;
    } else {
      min = clip;
    }
  }
  return Number.isFinite(max) ? (min + max) / 2 : min;
}

/**
 * The abscissas outerProfile() samples: the even 0..length ladder, plus any
 * caller-supplied `extra` merged in (sorted, deduped, clamped to the span).
 *
 * Why the extras exist: a consumer that has to read the profile at some x
 * (services/report/reportGeometry.ts, sizing a part at a station) otherwise lands on a
 * chord between two samples instead of on the true curve. The error is tiny
 * (a 3" 4:1 tangent ogive has a ~1238 mm ogive radius, so a 4.76 mm chord has
 * a 0.0023 mm sagitta, three orders below print resolution, and it is the same
 * on both sides of the cut so the pieces still mate) but asking for the exact
 * sample costs nothing and keeps "the printed part is the geometry the engine
 * flies" literally true.
 *
 * The no-extras path returns exactly the even ladder, bit for bit, and
 * shapeProfile.test.ts pins that.
 */
function sampleXs(length: number, steps: number, extra?: readonly number[]): number[] {
  // Floor steps to >=1: steps=0 would make the divisor 0 and emit a single NaN
  // abscissa. Integer steps>=1 are unchanged (bit-identical), which the tests pin.
  const s = Math.max(1, Math.floor(steps));
  const xs: number[] = [];
  for (let i = 0; i <= s; i++) xs.push((i / s) * length);
  if (!extra || extra.length === 0) return xs;
  for (const e of extra) {
    if (!Number.isFinite(e) || e < 0 || e > length) continue;
    // Within a collapse tolerance of an existing sample, replace it: the
    // caller's abscissa is the one that must survive (it is a cut plane), and
    // two points 1 nm apart would be collapsed to one downstream anyway.
    const j = xs.findIndex((v) => Math.abs(v - e) <= 1e-9);
    if (j >= 0) xs[j] = e;
    else xs.push(e);
  }
  xs.sort((a, b) => a - b);
  return xs;
}

/**
 * Sampled outer profile of a nose cone or transition: steps+1 points
 * [x, r] with x from 0 (fore end) to `length` (aft end). The shape
 * parameter is clamped exactly like Transition.setShapeParameter().
 * Nose cones are this with foreR = 0.
 *
 * `extraX` (optional, meters, in this profile's own x) merges exact samples at
 * the given abscissas (see sampleXs()). Purely additive: omit it and nothing
 * changes.
 *
 * `clipped` (optional) is the node's stored clipped flag (node['clipped'],
 * from .ork <shapeclipped>). Absent = kernel default = clipped; it only
 * matters on clippable shapes (ellipsoid/power/haack), exactly as
 * Transition.isClipped(), which returns false outright for the rest.
 */
export function outerProfile(
  shape: string,
  param: number | undefined,
  length: number,
  foreR: number,
  aftR: number,
  steps = 32,
  extraX?: readonly number[],
  clipped?: boolean,
): [number, number][] {
  const p = Math.min(Math.max(param ?? shapeParamDefault(shape), 0), shapeParamMax(shape));
  const pts: [number, number][] = [];
  const xs = sampleXs(length, steps, extraX);

  if (foreR === aftR || length <= 0) {
    for (const x of xs) pts.push([x, foreR]);
    return pts;
  }

  // Transition.getRadius() normalizes to the small end first: r1 < r2,
  // x measured from the small end, flipped back afterwards.
  const flipped = foreR > aftR;
  const r1 = flipped ? aftR : foreR;
  const r2 = flipped ? foreR : aftR;
  // (clipped ?? true): the kernel default is clipped; the flag can only turn
  // clipping off, and only on clippable shapes (Transition.isClipped()).
  const clip = r1 > 0 && shapeIsClippable(shape) && (clipped ?? true);
  const clipLength = clip ? calculateClip(shape, p, length, r1, r2) : 0;

  const radiusAt = (x: number): number => {
    if (x <= 0) return r1;
    if (x >= length) return r2;
    if (clip) return shapeRadius(shape, clipLength + x, r2, clipLength + length, p);
    return r1 + shapeRadius(shape, x, r2 - r1, length, p);
  };

  for (const x of xs) {
    pts.push([x, radiusAt(flipped ? length - x : x)]);
  }
  return pts;
}

/**
 * A nose cone or transition's profile shape: its own `shape` key, or the one the
 * kernel builds when the key is absent (KERNEL_SHAPES). Every reader of a
 * profile goes through this, so a keyless node is drawn, meshed and measured as
 * the shape that flies.
 */
export function nodeShape(node: ComponentNode): string {
  const shape = node['shape'];
  if (typeof shape === 'string') return shape;
  return node.type === 'nosecone' ? KERNEL_SHAPES.nosecone : KERNEL_SHAPES.transition;
}

/**
 * A nose cone's or transition's radius at its fore and aft ends (m), the pair
 * every profile reader passes to {@link outerProfile}.
 *
 * A nose cone runs from its tip to its base, and `aftRadius` holds the base.
 * Flipped, it is a tail cone: the kernel moves the base to the fore end
 * (`NoseCone.setFlipped`), so the profile runs from the base down to the tip.
 */
export function profileEnds(node: ComponentNode): { fore: number; aft: number } {
  if (node.type === 'nosecone') {
    const base = num(node, 'aftRadius', KERNEL_DEFAULTS.nosecone.aftRadius);
    return node['flipped'] === true ? { fore: base, aft: 0 } : { fore: 0, aft: base };
  }
  return { fore: num(node, 'foreRadius'), aft: num(node, 'aftRadius') };
}

/**
 * The outer radius of a symmetric component at one station along it, in meters.
 *
 * `SymmetricComponent.getRadius(x)`: a tube is one radius end to end, a nose
 * cone runs from a point to its base and a transition between its two ends. The
 * station is clamped into the part, as the kernel's own getter does.
 *
 * `extraX` gives the profile an exact sample at the station asked for, so this
 * reads the true curve rather than a chord between two even samples. Note
 * `reportGeometry` keeps its own copy of the same call: it already has the pair
 * of radii in hand from its walk, and would have to look them up again to use
 * this.
 */
export function stationRadius(node: ComponentNode, x: number): number {
  const length = num(node, 'length');
  switch (node.type) {
    case 'nosecone':
    case 'transition': {
      const { fore: foreR, aft: aftR } = profileEnds(node);
      if (!(length > 0)) return Math.max(foreR, aftR);
      const clipped = typeof node['clipped'] === 'boolean' ? node['clipped'] : undefined;
      const at = Math.max(0, Math.min(length, x));
      const pts = outerProfile(nodeShape(node), numOpt(node, 'shapeParameter'), length, foreR, aftR, 1, [at], clipped);
      return pts.find(([px]) => Math.abs(px - at) < 1e-9)?.[1] ?? aftR;
    }
    default:
      return num(node, 'outerRadius');
  }
}

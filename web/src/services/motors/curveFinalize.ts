import { mathEquals } from './mathEquals';

/**
 * The most samples one imported motor curve may carry, in either file format.
 *
 * Every custom motor is stored in one blob that is parsed and validated on
 * each picker open and `.ork` save, and a `.rse` member of an imported `.ork`
 * is read with no file picker at all. The longest real curve is a few thousand
 * samples.
 */
export const MAX_CURVE_SAMPLES = 20_000;

/**
 * Desktop's `AbstractMotorLoader.sortLists`: every list reordered by ascending
 * `primary`, ties kept in file order. Desktop runs it before
 * {@link finalizeThrustCurve} on every `.rse` and `.eng` it reads.
 */
export function sortLists(primary: number[], ...lists: unknown[][]): void {
  const order = primary.map((_, i) => i).sort((a, b) => primary[a]! - primary[b]! || a - b);
  for (const list of [primary, ...lists]) {
    const copy = [...list];
    order.forEach((from, to) => (list[to] = copy[from]));
  }
}

/**
 * Desktop's `AbstractMotorLoader.finalizeThrustCurve`, in place, on a curve
 * already sorted by time; `lists` ride along index for index:
 *   1. no point at t = 0: add one at zero thrust, each list repeating its first entry;
 *   2. two points at t = 0: drop the first (the zero-thrust one);
 *   3. a point repeated exactly: drop the repeat;
 *   4. two final points at one time, one of them zero: drop the zero.
 *
 * In step 2 desktop drops the point from `time` and `thrust` only, leaving each
 * list one entry longer and shifted, and its digest hashes those lists as they
 * stand. `alignLists` drops the lists' first entry too, so each entry stays
 * with its own point; a digest must leave it off to match desktop's.
 */
export function finalizeThrustCurve(
  time: number[],
  thrust: number[],
  lists: unknown[][] = [],
  { alignLists = false }: { alignLists?: boolean } = {},
): void {
  const eq = mathEquals;
  if (time.length === 0) return;
  if (!eq(time[0]!, 0)) {
    time.unshift(0);
    thrust.unshift(0);
    for (const l of lists) l.unshift(l[0]);
  }
  if (time.length > 1 && eq(time[0]!, 0) && eq(time[1]!, 0)) {
    time.shift();
    thrust.shift();
    if (alignLists) for (const l of lists) l.shift();
  }
  for (let i = 0; i < time.length - 1; i++) {
    while (i < time.length - 1 && eq(time[i]!, time[i + 1]!) && eq(thrust[i]!, thrust[i + 1]!)) {
      time.splice(i, 1);
      thrust.splice(i, 1);
      for (const l of lists) l.splice(i, 1);
    }
  }
  const n = time.length - 1;
  if (n > 0 && eq(time[n - 1]!, time[n]!)) {
    const drop = eq(thrust[n - 1]!, 0) ? n - 1 : eq(thrust[n]!, 0) ? n : -1;
    if (drop >= 0) for (const l of [time, thrust, ...lists]) l.splice(drop, 1);
  }
}

/**
 * A thrust curve as the kernel will take it: starting at t = 0, with every time
 * after the one before it. `ThrustCurveMotor.Builder.build()` refuses anything
 * else ("Curve starts at time …", "Two thrust values for single time point"),
 * and thrustcurve.org's files break both rules often enough to matter.
 *
 * The kernel this app ships does not carry desktop's file loaders, so their
 * cleanup is here: {@link sortLists}, then {@link finalizeThrustCurve} with
 * each point's other fields kept with it. Desktop stops there, and cannot load
 * a curve that still steps between two thrusts at one instant. The last step
 * keeps the later of the two, which is how the rest of the app reads such a
 * step (`motorCombine.thrustAt`).
 *
 * Points carry extra fields (a measured mass) through unchanged, so a column
 * that rides along stays against the right times.
 */
export function finalizeCurve<P extends { time: number; thrust: number }>(input: readonly P[]): P[] {
  const time = input.map((p) => p.time);
  const thrust = input.map((p) => p.thrust);
  const points = [...input];
  sortLists(time, thrust, points);
  finalizeThrustCurve(time, thrust, [points], { alignLists: true });
  const pts = time.map((t, i) => ({ ...points[i]!, time: t, thrust: thrust[i]! }));
  // A step between two thrusts at one instant: the later value holds.
  return pts.filter((p, i) => i === pts.length - 1 || !mathEquals(p.time, pts[i + 1]!.time));
}

/** {@link finalizeCurve} for `[time, thrust]` pairs, the catalog's own shape. */
export function finalizeSamples(samples: readonly [number, number][]): [number, number][] {
  return finalizeCurve(samples.map(([time, thrust]) => ({ time, thrust }))).map((p) => [p.time, p.thrust]);
}

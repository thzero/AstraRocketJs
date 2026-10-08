/**
 * A thrust curve as the kernel will take it: starting at t = 0, with every time
 * after the one before it. `ThrustCurveMotor.Builder.build()` refuses anything
 * else ("Curve starts at time …", "Two thrust values for single time point"),
 * and thrustcurve.org's files break both rules often enough to matter.
 *
 * The first four steps are desktop OpenRocket's `AbstractMotorLoader
 * .finalizeThrustCurve`, which runs on every file desktop reads; the kernel
 * this app ships does not carry the file loaders, so the step is here:
 *   1. no point at t = 0: add one at zero thrust;
 *   2. two points at t = 0: drop the first (the zero-thrust one);
 *   3. a point repeated exactly: drop the repeat;
 *   4. two final points at one time, one of them zero: drop the zero.
 * Desktop stops there, and cannot load a curve that still steps between two
 * thrusts at one instant. The last step keeps the later of the two, which is
 * how the rest of the app already reads such a step (`motorCombine.thrustAt`).
 *
 * Points carry extra fields (a measured mass) through unchanged, so a column
 * that rides along stays against the right times.
 */
export function finalizeCurve<P extends { time: number; thrust: number }>(input: readonly P[]): P[] {
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const pts = [...input].sort((a, b) => a.time - b.time);
  if (pts.length === 0) return pts;
  if (!eq(pts[0]!.time, 0)) pts.unshift({ ...pts[0]!, time: 0, thrust: 0 });
  if (pts.length > 1 && eq(pts[0]!.time, 0) && eq(pts[1]!.time, 0)) pts.shift();
  for (let i = 0; i < pts.length - 1; i++) {
    while (i < pts.length - 1 && eq(pts[i]!.time, pts[i + 1]!.time) && eq(pts[i]!.thrust, pts[i + 1]!.thrust)) {
      pts.splice(i, 1);
    }
  }
  const n = pts.length - 1;
  if (n > 0 && eq(pts[n - 1]!.time, pts[n]!.time)) {
    if (eq(pts[n - 1]!.thrust, 0)) pts.splice(n - 1, 1);
    else if (eq(pts[n]!.thrust, 0)) pts.splice(n, 1);
  }
  // A step between two thrusts at one instant: the later value holds.
  return pts.filter((p, i) => i === pts.length - 1 || !eq(p.time, pts[i + 1]!.time));
}

/** {@link finalizeCurve} for `[time, thrust]` pairs, the catalog's own shape. */
export function finalizeSamples(samples: readonly [number, number][]): [number, number][] {
  return finalizeCurve(samples.map(([time, thrust]) => ({ time, thrust }))).map((p) => [p.time, p.thrust]);
}

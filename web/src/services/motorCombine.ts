/**
 * Pure helpers for the Motor Dashboard's "combine" tool: sum several motors'
 * thrust curves into one combined curve (simultaneous ignition at t=0) and the
 * aggregate performance of a cluster. No React/DOM — unit-tested directly.
 */

export type Sample = [number, number]; // [time s, thrust N]

/**
 * Thrust (N) at time `t` by linear interpolation; 0 before the first sample and
 * after the last (a burnt-out motor contributes nothing).
 *
 * AT the final sample the curve still has whatever thrust that sample states.
 * Returning 0 there dropped the last trapezoid for any curve that ends
 * non-zero, because `combineCurves` evaluates at the union of all breakpoints
 * and that union includes each curve's own last time. Most published curves
 * end at zero and were unaffected; of the 1477 in the bundled catalog, 6 do
 * not, and the largest error among them is 0.4% (a D9, 0.09 N-s). Small, but
 * it is the combined total this panel exists to report.
 */
export function thrustAt(samples: Sample[], t: number): number {
  const n = samples.length;
  if (n === 0) return 0;
  if (t < samples[0]![0]) return 0;
  if (t > samples[n - 1]![0]) return 0; // past burnout
  // A thrust curve can hold TWO samples at the same time to encode a vertical
  // step - an instant ignition spike, or a cut-off. Going forward from `t` the
  // curve's value is the LAST sample at that time, not the first. Returning
  // the first read a step-up as the value before it: K543 in the bundled
  // catalog starts [0, 0] then [0, 2117] and was summed as if it made no
  // thrust at ignition.
  let last: number | undefined;
  for (let i = 0; i < n; i++) if (samples[i]![0] === t) last = samples[i]![1];
  if (last !== undefined) return last;
  for (let i = 1; i < n; i++) {
    const [t1, f1] = samples[i]!;
    if (t <= t1) {
      const [t0, f0] = samples[i - 1]!;
      const span = t1 - t0;
      return span <= 0 ? f1 : f0 + (f1 - f0) * ((t - t0) / span);
    }
  }
  return 0;
}

/** Trapezoidal integral of a thrust curve → total impulse (N·s). */
export function impulse(samples: Sample[]): number {
  let a = 0;
  for (let i = 1; i < samples.length; i++) {
    a += ((samples[i]![0] - samples[i - 1]![0]) * (samples[i]![1] + samples[i - 1]![1])) / 2;
  }
  return a;
}

/** How long an abruptly-ending motor takes to stop, for the terminator point. */
const END_DROP_S = 1e-6;

export interface Combined {
  samples: Sample[];
  totalImpulse: number; // N·s
  peakThrust: number; // N
  avgThrust: number; // N (over the longest burn)
  burnTime: number; // s (the longest-burning motor)
  motorCount: number;
}

/**
 * Combine N thrust curves as a simultaneously-ignited cluster: sum thrust at
 * the union of every curve's time breakpoints. Empty/degenerate curves are
 * skipped. Returns a zeroed result when nothing usable is given.
 */
export function combineCurves(curves: Sample[][]): Combined {
  const usable = curves.filter((c) => c.length >= 2);
  if (usable.length === 0) {
    return { samples: [], totalImpulse: 0, peakThrust: 0, avgThrust: 0, burnTime: 0, motorCount: 0 };
  }
  // Union of all time points (each curve starts at 0), sorted + de-duped.
  //
  // Plus a TERMINATOR just after any curve that ends non-zero. Summing at the
  // breakpoints alone cannot represent a motor that stops abruptly: between
  // its last sample and the next breakpoint the interpolation ramps its thrust
  // down instead of cutting it, so the cluster keeps being credited with a
  // motor that has already stopped. (Before `thrustAt` was fixed the same gap
  // showed up as the opposite error, the curve's own last trapezoid being
  // dropped.) One extra point a microsecond later, where that curve reads 0,
  // makes the drop vertical and the integral exact.
  const times = new Set<number>();
  for (const c of usable) {
    for (const [t] of c) times.add(t);
    const last = c[c.length - 1]!;
    if (last[1] !== 0) times.add(last[0] + END_DROP_S);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const samples: Sample[] = sorted.map((t) => [t, usable.reduce((sum, c) => sum + thrustAt(c, t), 0)]);
  const burnTime = Math.max(...usable.map((c) => c[c.length - 1]![0]));
  // Summed from the CURVES, not integrated from the resampled points above.
  // Simultaneous ignition means the cluster's impulse is the sum of the
  // motors' impulses, exactly, by linearity of the integral - no resampling,
  // no de-duplication, nothing to lose at a step or a breakpoint. Integrating
  // the resampled curve understated K543 by 63% and overstated a cluster whose
  // shorter motor ended abruptly.
  const totalImpulse = usable.reduce((sum, c) => sum + impulse(c), 0);
  const peakThrust = samples.reduce((m, s) => Math.max(m, s[1]), 0);
  const avgThrust = burnTime > 0 ? totalImpulse / burnTime : 0;
  return { samples, totalImpulse, peakThrust, avgThrust, burnTime, motorCount: usable.length };
}

/**
 * Classes below A, by their index `n`: 1/8A is n = -2, 1/4A is -1, 1/2A is 0.
 *
 * These are real NAR designations for motors people actually fly (MicroMaxx is
 * 1/4A territory), not a rounding artifact. Reporting a dash for all of them
 * threw away information the impulse plainly gives.
 */
const SUB_A_CLASSES = ['1/8A', '1/4A', '1/2A'];

/**
 * NAR/TRA total-impulse class for an impulse in N-s.
 *
 * Class n (A = 1) tops out at 2.5*2^(n-1) N-s: A <= 2.5, B <= 5, C <= 10, and
 * downward through 1/2A <= 1.25, 1/4A <= 0.625, 1/8A <= 0.3125. Clamped at O
 * above, and a dash below 1/8A where there is no standard class left.
 *
 * THE one classifier. `engParser` had a second copy whose
 * `Math.max(0, ...)` clamped every sub-A motor to index 0, so it filed a
 * 0.75 N-s MicroMaxx as an "A" - a motor with a third of A-class impulse,
 * labeled A in the picker and the dashboard.
 */
export function impulseClass(ns: number): string {
  if (!Number.isFinite(ns) || ns <= 0) return '—';
  const n = Math.ceil(Math.log2(ns / 2.5)) + 1;
  if (n > 15) return 'O';
  if (n >= 1) return String.fromCharCode(64 + n);
  return SUB_A_CLASSES[n + 2] ?? '—';
}

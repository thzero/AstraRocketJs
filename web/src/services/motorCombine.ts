/**
 * Pure helpers for the Motor Dashboard's "combine" tool: sum several motors'
 * thrust curves into one combined curve (simultaneous ignition at t=0) and the
 * aggregate performance of a cluster. No React/DOM — unit-tested directly.
 */

export type Sample = [number, number]; // [time s, thrust N]

/** Thrust (N) at time `t` by linear interpolation; 0 before the first sample
 *  and after the last (a burnt-out motor contributes nothing). */
export function thrustAt(samples: Sample[], t: number): number {
  const n = samples.length;
  if (n === 0) return 0;
  if (t <= samples[0]![0]) return t < samples[0]![0] ? 0 : samples[0]![1];
  if (t >= samples[n - 1]![0]) return 0; // past burnout
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
  const times = [...new Set(usable.flatMap((c) => c.map((s) => s[0])))].sort((a, b) => a - b);
  const samples: Sample[] = times.map((t) => [t, usable.reduce((sum, c) => sum + thrustAt(c, t), 0)]);
  const burnTime = Math.max(...usable.map((c) => c[c.length - 1]![0]));
  const totalImpulse = impulse(samples);
  const peakThrust = samples.reduce((m, s) => Math.max(m, s[1]), 0);
  const avgThrust = burnTime > 0 ? totalImpulse / burnTime : 0;
  return { samples, totalImpulse, peakThrust, avgThrust, burnTime, motorCount: usable.length };
}

/**
 * NAR/TRA total-impulse class letter for an impulse in N·s. Class n (A = 1) tops
 * out at 2.5·2^(n-1) N·s (A ≤ 2.5, B ≤ 5, C ≤ 10 …). Below A → "—"; clamped at O.
 */
export function impulseClass(ns: number): string {
  if (!Number.isFinite(ns) || ns <= 1.25) return '—';
  const n = Math.ceil(Math.log2(ns / 2.5)) + 1;
  if (n < 1) return 'A';
  if (n > 15) return 'O';
  return String.fromCharCode(64 + n);
}

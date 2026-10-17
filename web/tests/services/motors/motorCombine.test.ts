import { NO_VALUE } from '../../../src/i18n/noValue';
import { describe, it, expect } from 'vitest';
import { finalizeSamples } from '../../../src/services/motors/curveFinalize';
import { thrustAt, impulse, combineCurves, impulseClass, type Sample } from '../../../src/services/motors/motorCombine';

const A: Sample[] = [
  [0, 0],
  [1, 10],
  [2, 0],
]; // triangle, impulse 10, burn 2
const B: Sample[] = [
  [0, 0],
  [0.5, 20],
  [1, 0],
]; // triangle, impulse 10, burn 1

describe('thrustAt', () => {
  it('interpolates linearly inside the curve', () => {
    expect(thrustAt(A, 0.5)).toBeCloseTo(5, 9);
    expect(thrustAt(A, 1.5)).toBeCloseTo(5, 9);
  });
  it('is zero before ignition and after burnout', () => {
    expect(thrustAt(A, -1)).toBe(0);
    expect(thrustAt(A, 5)).toBe(0);
  });
});

describe('impulse', () => {
  it('trapezoid-integrates a curve', () => {
    expect(impulse(A)).toBeCloseTo(10, 9);
    expect(impulse(B)).toBeCloseTo(10, 9);
  });
});

describe('combineCurves', () => {
  it('sums simultaneous curves and aggregates cluster stats', () => {
    const c = combineCurves([A, B]);
    expect(c.motorCount).toBe(2);
    expect(c.totalImpulse).toBeCloseTo(20, 6); // 10 + 10
    // At t=0.5, A gives 5 and B peaks at 20 → 25 N combined peak region.
    expect(c.peakThrust).toBeCloseTo(25, 6);
  });
  it('returns a zeroed result for no usable curves', () => {
    expect(combineCurves([]).motorCount).toBe(0);
    expect(combineCurves([[[0, 0]]]).totalImpulse).toBe(0); // single point = degenerate
  });
});

describe('impulseClass', () => {
  it('maps N·s to the NAR/TRA class letter', () => {
    expect(impulseClass(2.5)).toBe('A');
    expect(impulseClass(2.51)).toBe('B');
    expect(impulseClass(5)).toBe('B');
    expect(impulseClass(10)).toBe('C');
    expect(impulseClass(20)).toBe('D');
    expect(impulseClass(320)).toBe('H');
    expect(impulseClass(1280)).toBe('J');
  });
  /** The sub-A classes are real NAR designations: a 0.75 N-s MicroMaxx is a 1/2A. */
  it('names the fractional classes below A', () => {
    // NAR boundaries: 1/8A <= 0.3125, 1/4A <= 0.625, 1/2A <= 1.25, A <= 2.5.
    expect(impulseClass(0.3125)).toBe('1/8A');
    expect(impulseClass(0.5)).toBe('1/4A');
    expect(impulseClass(0.625)).toBe('1/4A');
    expect(impulseClass(0.75)).toBe('1/2A'); // a MicroMaxx-class motor
    expect(impulseClass(1)).toBe('1/2A');
    expect(impulseClass(1.25)).toBe('1/2A');
    expect(impulseClass(1.26)).toBe('A'); // A starts here
    expect(impulseClass(2.5)).toBe('A');
  });

  it('is the no-value glyph only where there is no class left', () => {
    expect(impulseClass(0.1)).toBe(NO_VALUE); // below 1/8A
    expect(impulseClass(0)).toBe(NO_VALUE);
    expect(impulseClass(-5)).toBe(NO_VALUE);
    expect(impulseClass(NaN)).toBe(NO_VALUE);
  });
});

/**
 * A curve's last sample is part of the curve.
 *
 * `combineCurves` evaluates at the union of every curve's breakpoints, which
 * includes each curve's own last time. If `thrustAt` returned 0 at the final
 * sample time rather than only past it, the last trapezoid would be integrated
 * as if the motor had already stopped.
 *
 * Most published curves end at zero thrust; a few in the bundled catalog do not.
 */
describe('thrustAt at the end of a curve', () => {
  const abrupt: Sample[] = [
    [0, 0],
    [0.1, 10],
    [1.8, 5],
  ];

  it('reports the final sample thrust AT its time, and 0 after', () => {
    expect(thrustAt(abrupt, 1.8)).toBe(5);
    expect(thrustAt(abrupt, 1.80001)).toBe(0);
    expect(thrustAt(abrupt, 100)).toBe(0);
  });

  it('keeps the tail in the combined impulse', () => {
    // Trapezoid truth: 0.5*10*0.1 + 0.5*(10+5)*1.7 = 13.25 N-s.
    expect(impulse(abrupt)).toBeCloseTo(13.25, 9);
    // Summed from the curve itself, so the terminator point does not enter it.
    expect(combineCurves([abrupt]).totalImpulse).toBeCloseTo(13.25, 4);
  });

  it('agrees with the raw integral for a curve that ends at zero', () => {
    const clean: Sample[] = [
      [0, 0],
      [0.1, 10],
      [1.8, 5],
      [1.81, 0],
    ];
    expect(combineCurves([clean]).totalImpulse).toBeCloseTo(impulse(clean), 9);
  });

  it('sums two motors without losing either tail', () => {
    const a: Sample[] = [
      [0, 0],
      [1, 4],
    ];
    const b: Sample[] = [
      [0, 0],
      [2, 6],
    ];
    // Each curve integrates to its own trapezoid; simultaneous ignition sums.
    // Summing at the breakpoints alone would give 10 N-s here, not 8: motor `a`
    // ends abruptly at t=1 and would be credited with a linear ramp down to t=2.
    expect(combineCurves([a, b]).totalImpulse).toBeCloseTo(impulse(a) + impulse(b), 4);
  });
});

/**
 * A step encoded as two samples at the same timestamp.
 *
 * Thrust curves use a duplicated time to mean a vertical edge: an instant
 * ignition spike, or a cut-off. The union of breakpoints de-duplicates those
 * times, so `thrustAt` has to return the last sample at a time, not the first,
 * or a step up reads as the value before it. Bundled curves such as Cesaroni's
 * 2493K575-P begin `[0, 0], [0, 16]`.
 */
describe('a curve with a step at a duplicated timestamp', () => {
  const stepUp: Sample[] = [
    [0, 0],
    [0, 100],
    [1, 100],
    [1, 0],
  ];

  it('reads the value AFTER the step, not before it', () => {
    expect(thrustAt(stepUp, 0)).toBe(100);
    expect(thrustAt(stepUp, 0.5)).toBe(100);
    expect(thrustAt(stepUp, 1)).toBe(0); // the cut-off is a step down
  });

  it('reports the true impulse', () => {
    expect(impulse(stepUp)).toBeCloseTo(100, 9);
    expect(combineCurves([stepUp]).totalImpulse).toBeCloseTo(100, 9);
  });

  it('reports the true peak', () => {
    expect(combineCurves([stepUp]).peakThrust).toBe(100);
  });
});

/**
 * The whole bundled catalog, as the check on the two rules above.
 *
 * `totalImpulse` is `impulse` summed over the curves, so it says nothing about
 * resampling. What the panel plots and peaks is the resampled curve, so that is
 * what is integrated here, against the curve as the kernel flies it
 * (`finalizeSamples`), which is what `combineCurves` sums.
 *
 * Without a duplicated timestamp, the breakpoints are the source's own times,
 * and the only permitted difference is the microsecond terminator a non-zero
 * ending gets. With a step encoded as two samples at one time, the union of
 * breakpoints has one point where the source has two, so the check is that the
 * resampled point is the later sample.
 */
describe('every curve in the bundled catalog', () => {
  const load = async () => {
    const { readFileSync } = await import('node:fs');
    const raw = JSON.parse(readFileSync('public/data/motors.generated.json', 'utf8')) as Record<string, unknown>;
    const motors = (Array.isArray(raw) ? raw : (Object.values(raw).find(Array.isArray) as unknown[])) as {
      designation?: string;
      curves?: { samples?: Sample[] }[];
    }[];
    const curves: { name: string; s: Sample[] }[] = [];
    for (const m of motors) {
      for (const c of m.curves ?? []) {
        const s = (c.samples ?? []) as Sample[];
        if (s.length >= 2) curves.push({ name: m.designation ?? '?', s });
      }
    }
    return curves;
  };
  const hasStep = (s: Sample[]) => new Set(s.map(([t]) => t)).size !== s.length;

  it('resamples to a curve whose own trapezoid matches the source impulse', async () => {
    const curves = (await load()).filter(({ s }) => !hasStep(s));
    const wrong: string[] = [];
    for (const { name, s } of curves) {
      const truth = impulse(finalizeSamples(s));
      // The resampled curve itself, not the pre-summed total.
      const shown = impulse(combineCurves([s]).samples);
      // The terminator ramps a non-zero ending to 0 over 1e-6 s: at most
      // F_end * 5e-7 N-s, about 5e-8 relative on the worst shipped curve.
      if (Math.abs(truth - shown) / Math.max(truth, 1e-9) > 1e-4) {
        wrong.push(`${name}: ${truth.toFixed(3)} vs ${shown.toFixed(3)}`);
      }
    }
    expect(curves.length).toBeGreaterThan(1000); // the catalog really was loaded
    expect(wrong).toEqual([]);
  });

  it('reads the later sample at every duplicated timestamp', async () => {
    const curves = (await load()).filter(({ s }) => hasStep(s));
    const wrong: string[] = [];
    for (const { name, s } of curves) {
      const resampled = new Map(combineCurves([s]).samples);
      const flown = new Map(finalizeSamples(s));
      for (let i = 1; i < s.length; i++) {
        const [t, f] = s[i]!;
        if (s[i - 1]![0] !== t) continue;
        // The last sample at `t` wins in `thrustAt`, and the resampled curve
        // carries the point the flown curve keeps there.
        const last = s.filter(([tt]) => tt === t).at(-1)![1];
        if (thrustAt(s, t) !== last || resampled.get(t) !== flown.get(t)) {
          wrong.push(`${name} @ ${t}s: got ${thrustAt(s, t)} / ${resampled.get(t)}, want ${last} (not ${f})`);
        }
      }
    }
    expect(curves.length).toBeGreaterThan(30); // 41 in the shipped catalog
    expect(wrong).toEqual([]);
  });
});

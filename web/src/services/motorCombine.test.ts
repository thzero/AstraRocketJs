import { describe, it, expect } from 'vitest';
import { thrustAt, impulse, combineCurves, impulseClass, type Sample } from './motorCombine';

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
    expect(c.burnTime).toBeCloseTo(2, 9); // longest-burning motor
    expect(c.totalImpulse).toBeCloseTo(20, 6); // 10 + 10
    // At t=0.5, A gives 5 and B peaks at 20 → 25 N combined peak region.
    expect(c.peakThrust).toBeCloseTo(25, 6);
    expect(c.avgThrust).toBeCloseTo(10, 6); // 20 N·s / 2 s
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
  /**
   * The sub-A classes are real NAR designations, not a rounding artifact:
   * MicroMaxx is 1/4A territory and people fly it. Reporting a dash for all of
   * them threw away what the impulse plainly says.
   */
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

  it('is "—" only where there is no class left', () => {
    expect(impulseClass(0.1)).toBe('—'); // below 1/8A
    expect(impulseClass(0)).toBe('—');
    expect(impulseClass(-5)).toBe('—');
    expect(impulseClass(NaN)).toBe('—');
  });
});

/**
 * A curve's LAST sample is part of the curve.
 *
 * `thrustAt` returned 0 at the final sample time, not just past it, and
 * `combineCurves` evaluates at the union of every curve's breakpoints - which
 * includes each curve's own last time. So the last trapezoid was integrated
 * as if the motor had already stopped.
 *
 * Most published curves end at zero thrust and never noticed. Of the 1477 in
 * the bundled catalog 6 do not, and their real error runs 0.0% to 0.4%. The
 * synthetic case below is far worse than anything shipped, which is the point:
 * it is what the code does, not what the data happens to avoid.
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
    // Exact to within the terminator's own microsecond-wide ramp (~2.5e-6 N-s),
    // which is the deliberate cost of representing an abrupt stop at all.
    expect(combineCurves([abrupt]).totalImpulse).toBeCloseTo(13.25, 4);
  });

  it('agrees with the raw integral for a curve that ends at zero, as before', () => {
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
    // Summing at the breakpoints alone gave 10 N-s here, not 8: motor `a` ends
    // abruptly at t=1 and was credited with a linear ramp down to t=2.
    expect(combineCurves([a, b]).totalImpulse).toBeCloseTo(impulse(a) + impulse(b), 4);
  });
});

/**
 * A step encoded as two samples at the same timestamp.
 *
 * Thrust curves use a duplicated time to mean a vertical edge: an instant
 * ignition spike, or a cut-off. The union of breakpoints de-duplicates those
 * times, and `thrustAt` returned the FIRST sample at a time rather than the
 * last, so a step UP read as the value before it. K543 in the bundled catalog
 * begins `[0, 0], [0, 2117]` and was summed as making no thrust at ignition:
 * 771.8 N-s reported for a 2117.3 N-s motor, a 63.5% understatement on a
 * K-class motor shown as if it were barely a J.
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
 * The whole bundled catalog, as the ultimate check on the two fixes above.
 *
 * Reading a combined total is the panel's entire job, and 9 of the 781 motors
 * it can show reported one that was wrong, the worst by 63.5%. A synthetic
 * case proves the code path; this proves the shipped data.
 */
describe('every curve in the bundled catalog', () => {
  it('combines to exactly its own trapezoidal impulse', async () => {
    const { readFileSync } = await import('node:fs');
    const raw = JSON.parse(readFileSync('public/data/motors.generated.json', 'utf8')) as Record<string, unknown>;
    const motors = (Array.isArray(raw) ? raw : (Object.values(raw).find(Array.isArray) as unknown[])) as {
      designation?: string;
      curves?: { samples?: Sample[] }[];
    }[];

    const wrong: string[] = [];
    let checked = 0;
    for (const m of motors) {
      for (const c of m.curves ?? []) {
        const s = (c.samples ?? []) as Sample[];
        if (s.length < 2) continue;
        checked++;
        const truth = impulse(s);
        const shown = combineCurves([s]).totalImpulse;
        if (Math.abs(truth - shown) / Math.max(truth, 1e-9) > 1e-9) {
          wrong.push(`${m.designation ?? '?'}: ${truth.toFixed(1)} vs ${shown.toFixed(1)}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(1000); // the catalog really was loaded
    expect(wrong).toEqual([]);
  });
});

/**
 * Wind turbulence intensity: the wind's scatter as a FRACTION of its average
 * (standard deviation / average) rather than in m/s.
 *
 * This is how OpenRocket states gustiness and how the hobby talks about it.
 * "20% turbulence" means something on its own; "2 m/s" only means something once
 * you also know the wind speed, and the same 2 m/s is a gale at 3 m/s average
 * and nothing at 18.
 *
 * Nothing here reaches the engine. The bridge passes the average and the
 * standard deviation (`OpenRocketEngine.java` builds a `PinkNoiseWindModel` and
 * sets both explicitly), which is exactly what `LaunchConditions` stores, so a
 * given pair flies identically whatever this says about it. This is a second
 * reading of values we already hold — mirrored function for function from the
 * kernel we ship (`PinkNoiseWindModel.getTurbulenceIntensity`,
 * `setTurbulenceIntensity`, `getIntensityDescription`) so the two cannot drift.
 */

/**
 * `MathUtil.equals(x, 0)` — the kernel's near-zero test, which is what
 * `getTurbulenceIntensity` branches on. Its epsilon halves for a comparison
 * against zero (`MathUtil.EPSILON` is 1e-8), so the threshold is 5e-9.
 */
const isZero = (x: number) => Math.abs(x) < 0.00000001 / 2;

/**
 * Standard deviation over average.
 *
 * Zero average has no ratio, so the kernel answers with the two extremes rather
 * than dividing: no scatter is 0, any scatter at all is 1. The `.ork` ≤23.09
 * `<windturbulence>` element stores THIS value, which is why import and export
 * both go through here.
 */
export function turbulenceIntensity(average: number, stdDev: number): number {
  if (isZero(average)) return isZero(stdDev) ? 0 : 1;
  return stdDev / average;
}

/**
 * True when the average is far enough from zero for the ratio to be a real
 * fraction rather than the 0-or-1 stand-in above.
 */
export function hasIntensity(average: number): boolean {
  return !isZero(average);
}

/** The standard deviation an intensity means at a given average wind speed. */
export function stdDevForIntensity(average: number, intensity: number): number {
  // `setStandardDeviation` floors at zero; a negative average would otherwise
  // hand back a negative scatter.
  return Math.max(intensity * average, 0);
}

/** The rungs of OpenRocket's `getIntensityDescription` ladder. */
export type TurbulenceLevel = 'none' | 'veryLow' | 'low' | 'medium' | 'high' | 'veryHigh' | 'extreme';

/**
 * The descriptive rung an intensity falls on, with the kernel's own thresholds.
 * Naming it is the point of the feature: the number tells you where you are,
 * the word tells you whether that is somewhere you wanted to be.
 */
export function turbulenceLevel(intensity: number): TurbulenceLevel {
  if (intensity < 0.001) return 'none';
  if (intensity < 0.05) return 'veryLow';
  if (intensity < 0.1) return 'low';
  if (intensity < 0.15) return 'medium';
  if (intensity < 0.2) return 'high';
  if (intensity < 0.25) return 'veryHigh';
  return 'extreme';
}

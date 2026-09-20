import type { MotorSpec } from '../engine/openRocketEngine';

/**
 * THE "does this motor carry a usable thrust curve" predicate.
 *
 * Four thresholds used to exist, one per module: `runnability.hasThrustCurve`
 * accepted any non-empty arrays, `buildRocket` and `engine/api` seated a motor
 * at two or more time samples, `motorDb.hasCurve` wanted two catalog samples,
 * and `motorStore.isThrustSampleArray` wanted one finite sample. So a
 * one-sample motor was "flyable" to the Run button, left the mount empty at
 * build time, and then failed the kernel's own "too short thrust curve" check
 * from some other path. One predicate, matching the builder
 * (`openRocketEngine.setMotorById`): at least {@link MIN_CURVE_SAMPLES}
 * samples, the three arrays in lockstep, every value finite.
 */
export const MIN_CURVE_SAMPLES = 2;

const finiteArray = (xs: unknown): xs is number[] => Array.isArray(xs) && xs.every((x) => Number.isFinite(x));

/** Whether `m` carries a curve the kernel will accept. Null-safe. */
export function hasUsableCurve(m: MotorSpec | null | undefined): boolean {
  if (!m) return false;
  const { times, thrusts, masses } = m;
  if (!finiteArray(times) || !finiteArray(thrusts) || !finiteArray(masses)) return false;
  if (times.length < MIN_CURVE_SAMPLES) return false;
  return thrusts.length === times.length && masses.length === times.length;
}

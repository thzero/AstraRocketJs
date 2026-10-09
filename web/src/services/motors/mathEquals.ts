/**
 * `MathUtil.equals` from the kernel: relative to `b`, with a half-epsilon
 * absolute test when `b` is near zero. Desktop's `finalizeThrustCurve` compares
 * with it, and an embedded curve's digest only matches the desktop's when this
 * app drops exactly the points the desktop drops.
 */
const MATH_EPSILON = 0.00000001;

export function mathEquals(a: number, b: number, epsilon = MATH_EPSILON): boolean {
  const absb = Math.abs(b);
  if (absb < epsilon / 2) return Math.abs(a) < epsilon / 2;
  return Math.abs(a - b) < epsilon * absb;
}

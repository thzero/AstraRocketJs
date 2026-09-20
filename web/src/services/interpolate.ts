/**
 * Linear interpolation of a series `ys` (index-aligned to sorted, ascending `xs`)
 * at position `x`. Clamps to the endpoints, returns null when there's no data,
 * and steps past null samples gracefully. Shared by the flight-panel, drag-sweep
 * and rail-margin readouts, which all sample a curve at a hovered/target x.
 */
export function lerpAt(xs: readonly number[], ys: readonly (number | null)[], x: number): number | null {
  if (!xs.length) return null;
  if (x <= xs[0]!) return ys[0] ?? null;
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]!) {
      const y0 = ys[i - 1],
        y1 = ys[i];
      if (y0 == null || y1 == null) return y1 ?? y0 ?? null;
      const span = xs[i]! - xs[i - 1]!;
      // No `span === 0` branch: reaching index `i` means `x > xs[i-1]`, and
      // `xs` is required sorted-ascending, so `xs[i] === xs[i-1]` cannot hold
      // here. The guard that used to sit here read as a real divide-by-zero
      // check while being unreachable; the genuine empty-input guard is above.
      return y0 + ((x - xs[i - 1]!) / span) * (y1 - y0);
    }
  }
  // Indexed off `xs`, not `ys`: a `ys` longer than `xs` was returning a value
  // from OUTSIDE the x-domain. `lerpAt([0,1],[0,10,999],5)` gave 999, not 10.
  return ys[xs.length - 1] ?? null;
}

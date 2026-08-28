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
      const y0 = ys[i - 1], y1 = ys[i];
      if (y0 == null || y1 == null) return y1 ?? y0 ?? null;
      const span = xs[i]! - xs[i - 1]!;
      return span === 0 ? y1 : y0 + ((x - xs[i - 1]!) / span) * (y1 - y0);
    }
  }
  return ys[ys.length - 1] ?? null;
}

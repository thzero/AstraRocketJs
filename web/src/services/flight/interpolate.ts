/**
 * Linear interpolation of a series `ys` (index-aligned to sorted, ascending `xs`)
 * at position `x`. Clamps to the endpoints, returns null when there's no data,
 * and steps past missing samples gracefully. A NaN sample is missing too: the
 * kernel records stability and CP as NaN while the rocket is on the rail, and the
 * first real value lands exactly at the rail departure, so blending it with the
 * NaN before it turned the rail-exit margin into NaN. Shared by the flight-panel, drag-sweep
 * and rail-margin readouts, which all sample a curve at a hovered/target x.
 *
 * Binary search, not a linear scan. FlightChart calls this once per stage per
 * panel on EVERY pointer move, over a fine-timestep flight's six-figure sample
 * arrays; a scan from index 1 walked most of the array for any hover past the
 * boost phase. `xs` is documented sorted ascending, which is all a lower-bound
 * search needs, and it lands on the same knot the scan did: the FIRST index
 * with `x <= xs[i]`, so duplicate knots resolve identically.
 */
export function lerpAt(xs: readonly number[], ys: readonly (number | null)[], x: number): number | null {
  const n = xs.length;
  if (!n) return null;
  if (x <= xs[0]!) return finite(ys[0]);
  // Indexed off `xs`, not `ys`: a `ys` longer than `xs` was returning a value
  // from OUTSIDE the x-domain. `lerpAt([0,1],[0,10,999],5)` gave 999, not 10.
  if (x > xs[n - 1]!) return finite(ys[n - 1]);
  // Lower bound: the smallest i in [1, n-1] with x <= xs[i].
  let lo = 1;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x <= xs[mid]!) hi = mid;
    else lo = mid + 1;
  }
  const i = lo;
  const y0 = finite(ys[i - 1]);
  const y1 = finite(ys[i]);
  if (y0 == null || y1 == null) return y1 ?? y0;
  const span = xs[i]! - xs[i - 1]!;
  // No `span === 0` branch: reaching index `i` means `x > xs[i-1]`, and
  // `xs` is required sorted-ascending, so `xs[i] === xs[i-1]` cannot hold
  // here. A guard here would read as a real divide-by-zero check while being
  // unreachable; the genuine empty-input guard is above.
  return y0 + ((x - xs[i - 1]!) / span) * (y1 - y0);
}

/** A sample, or null when it is missing or not a finite number. */
function finite(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

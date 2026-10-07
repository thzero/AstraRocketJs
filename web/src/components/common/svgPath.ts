/** A point already in screen coordinates. */
export type ScreenPoint = readonly [x: number, y: number];

/**
 * SVG `d` for a polyline through screen points, skipping non-finite ones.
 *
 * The command letter comes from whether one has been EMITTED, not from the
 * array index. With `${i ? 'L' : 'M'}` a non-finite first point gives a `d`
 * that starts with `L`, which is invalid path data: the browser drops the whole
 * <path> and the line renders blank with no error. A gap mid-line starts a
 * fresh `M`, so a hole reads as a break rather than a straight line across it,
 * and so does any point `breakBefore` names (a wrap from 359 to 1 degrees).
 *
 * `comma` writes `M1.0,2.0`, `space` writes `M 1.0 2.0`.
 */
export function polylinePath(
  pts: readonly ScreenPoint[],
  style: 'comma' | 'space' = 'space',
  breakBefore?: (i: number) => boolean,
): string {
  const out: string[] = [];
  let open = false;
  pts.forEach(([x, y], i) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      open = false;
      return;
    }
    const cmd = open && !breakBefore?.(i) ? 'L' : 'M';
    out.push(style === 'comma' ? `${cmd}${x.toFixed(1)},${y.toFixed(1)}` : `${cmd} ${x.toFixed(1)} ${y.toFixed(1)}`);
    open = true;
  });
  return out.join(' ');
}

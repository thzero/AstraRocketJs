/**
 * The two number guards the .ork reader and writer share: a raw string to a
 * finite number or nothing, and a count clamped into a domain range.
 */

/**
 * The ONE parse for a raw number out of an attribute or text node: a finite
 * number, or undefined. The file used to be read three ways at once -
 * `parseFloat(x) || 0` (passes Infinity), `Number(x ?? '0')` (reads a blank
 * as 0) and `Number(x?.trim())` - and which one a field got decided whether a
 * hostile value reached the kernel. Callers choose their own fallback.
 */
export function finiteNum(raw: string | null | undefined): number | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

/** A whole number in [lo, hi]; a non-finite value lands on `lo`. */
export function clampCount(v: number, lo: number, hi: number): number {
  const r = Math.round(v);
  return Number.isFinite(r) ? Math.min(hi, Math.max(lo, r)) : lo;
}

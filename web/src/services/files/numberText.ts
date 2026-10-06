/**
 * A number as file text: plain decimal with a '.' point, rounded to `digits`
 * places, trailing zeros dropped, never "-0". Locale-free on purpose, which is
 * what separates it from `fmtNum` (a displayed number).
 *
 * Every file writer chooses its own precision and what a non-finite value
 * becomes, but none of them may write "NaN" or "Infinity": a reader of the
 * format takes that for a number it cannot parse.
 */
export function plainDecimal(v: number, digits: number, nonFinite = ''): string {
  if (!Number.isFinite(v)) return nonFinite;
  // toFixed, not Math.round(v * 10 ** digits): the two round a halfway value
  // differently, and the golden exports pin toFixed's answer.
  const r = Number(v.toFixed(digits));
  return Object.is(r, -0) ? '0' : String(r);
}

/**
 * Does a typed launch pressure look like a sea-level figure?
 *
 * The launch pressure is the pressure AT the site, which is what the kernel
 * flies. Weather apps, airport reports and most forecasts quote pressure
 * reduced to sea level instead, and typed at a high site that figure makes the
 * air far too dense: 1013 hPa at a 1500 m field, where about 850 is usual, is
 * roughly 19% too much air, and the flight comes out low.
 *
 * Weather moves surface pressure some tens of hPa either side of the standard
 * atmosphere, so only a typed value well above the standard pressure at the
 * site's elevation is flagged: a sea-level figure clears the margin from about
 * 450 m up, and an ordinary high-pressure day does not. A caution, never a
 * block: the value may be right.
 */

/** How far above the standard pressure at the site a typed value may sit (Pa). */
export const SEA_LEVEL_MARGIN_PA = 5_000;

/**
 * How far the typed pressure sits above the standard pressure at the site, in
 * Pa, when that is past {@link SEA_LEVEL_MARGIN_PA}; otherwise null.
 *
 * @param typedPa    the launch pressure as entered
 * @param standardPa the kernel's standard-atmosphere pressure at the site's elevation
 */
export function seaLevelExcessPa(typedPa: number, standardPa: number): number | null {
  const excess = typedPa - standardPa;
  return excess > SEA_LEVEL_MARGIN_PA ? excess : null;
}

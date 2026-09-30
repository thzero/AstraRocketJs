import type { WindLevel } from '../design/orkTree';

/**
 * What a multilevel wind profile has to be true of before the kernel will take
 * it, asked in ONE place so the editor, the .ork reader, the stored defaults
 * and the run gate cannot disagree about it.
 *
 * The kernel keys its levels ON ALTITUDE: `MultiLevelPinkNoiseWindModel`
 * binary-searches the sorted list to insert one and throws
 * `Wind level already exists for altitude: 0.0` on a collision. So an altitude
 * is a level's IDENTITY, not a dimension with a sensible zero, and the two
 * faults that follow from that are the ones handled here:
 *
 *   - Two levels at one altitude. Refused by the kernel, mid-run, in its own
 *     words, after the design was built - for something the profile editor
 *     happily let the user type.
 *   - A level whose altitude is missing or unreadable. Every reader defaulted
 *     it to 0, which does not mean "ground level" harmlessly: it either
 *     silently replaces the real surface wind or collides with it and takes the
 *     whole run down.
 */

/** The four numbers a level carries; all of them have to be real. */
const KEYS = ['altitudeM', 'speed', 'directionDeg', 'stddev'] as const;

/** Whether this is a level at all: an object carrying four finite numbers. */
export function isUsableLevel(l: unknown): l is WindLevel {
  return !!l && typeof l === 'object' && KEYS.every((k) => Number.isFinite((l as Record<string, unknown>)[k]));
}

/**
 * The row indices whose altitude repeats an EARLIER row's, in order.
 *
 * Exact equality, because that is what the kernel compares: two levels a
 * nanometer apart are two levels to it, and rounding them together here would
 * report a fault the run does not have. The first row at a given altitude is
 * not in the list - it is the one that gets in - so the indices returned are
 * exactly the rows to flag or to drop.
 */
export function duplicateAltitudeRows(levels: readonly WindLevel[]): number[] {
  const seen = new Set<number>();
  const dupes: number[] = [];
  levels.forEach((l, i) => {
    if (seen.has(l.altitudeM)) dupes.push(i);
    else seen.add(l.altitudeM);
  });
  return dupes;
}

/**
 * The levels of this profile the kernel can actually build: every number
 * finite, one level per altitude, first row wins a collision.
 *
 * For the paths that have no user to tell - a stored preference read back, an
 * .ork someone else wrote - where the choice is between dropping a level and
 * failing the run. The editor does NOT use this: a row the user is typing into
 * gets flagged, not deleted underneath them.
 */
export function usableWindLevels(levels: readonly unknown[]): WindLevel[] {
  const kept = levels.filter(isUsableLevel);
  const drop = new Set(duplicateAltitudeRows(kept));
  return kept.filter((_, i) => !drop.has(i));
}

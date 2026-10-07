import type { UnitSymbols } from '../../prefs/units';
import type { LaunchConditions } from '../design/orkTree';
import { launchLimitViolations, limitText } from '../flight/safetyLimits';

/**
 * The notes an imported design's banner shows: what the reader had to say about
 * the file, then any launch condition it carries outside the safety codes.
 *
 * Launch conditions are simulation settings, so a file carrying them outside the
 * codes is flagged on the way in rather than silently flown; the run refuses too
 * (see runPlan). Every simulation an import makes shares the file's launch
 * conditions, so one check answers for all of them.
 *
 * The reader's own array comes back unchanged when there is nothing to add.
 */
export function importNotes(
  fileNotes: string[],
  launch: LaunchConditions,
  t: (key: string, vars: Record<string, unknown>) => string,
  units: UnitSymbols,
): string[] {
  const outside = launchLimitViolations(launch);
  return outside.length ? [...fileNotes, ...outside.map((v) => limitText(v, t, units))] : fileNotes;
}

import type { UnitSymbols } from '../../prefs/units';
import type { LaunchConditions } from '../design/orkTree';
import { launchLimitViolations, limitText } from '../flight/safetyLimits';
import type { PowerClass } from '../flight/powerClass';
import type { ImportNote } from './importNote';

/**
 * The notes an imported design's banner shows: what the reader had to say about
 * the file, then any launch condition it carries outside the safety codes.
 *
 * Launch conditions are simulation settings, so a file carrying them outside the
 * codes is flagged on the way in rather than silently flown; the run refuses too
 * (see runPlan). Each of the import's simulations is judged on its own
 * conditions against the class of the configuration it flies, which sets the
 * launcher angle allowed, as the run gate judges it; a sentence two
 * simulations share is said once.
 *
 * The reader's own array comes back unchanged when there is nothing to add.
 */
export function importNotes(
  fileNotes: ImportNote[],
  flights: readonly { launch: LaunchConditions; powerClass: PowerClass }[],
  t: (key: string, vars: Record<string, unknown>) => string,
  units: UnitSymbols,
): ImportNote[] {
  const texts = new Set(
    flights.flatMap((f) => launchLimitViolations(f.launch, f.powerClass)).map((v) => limitText(v, t, units)),
  );
  return texts.size ? [...fileNotes, ...texts] : fileNotes;
}

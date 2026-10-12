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
 * (see runPlan). `launch` is one set of conditions: the caller passes the first
 * simulation's, which every simulation shares when the file has none of its
 * own, while a file's own simulations each carry theirs and only the first is
 * judged here (the run gate judges each). Each simulation flies a configuration
 * whose class sets the launcher angle allowed, so the conditions are judged
 * once per class in `classes` (the classes of the configurations the import's
 * simulations fly), and a sentence two classes share is said once.
 *
 * The reader's own array comes back unchanged when there is nothing to add.
 */
export function importNotes(
  fileNotes: ImportNote[],
  launch: LaunchConditions,
  classes: readonly PowerClass[],
  t: (key: string, vars: Record<string, unknown>) => string,
  units: UnitSymbols,
): ImportNote[] {
  const order: PowerClass[] = ['model', 'highPower'];
  const texts = new Set(
    order
      .filter((c) => classes.includes(c))
      .flatMap((c) => launchLimitViolations(launch, c))
      .map((v) => limitText(v, t, units)),
  );
  return texts.size ? [...fileNotes, ...texts] : fileNotes;
}

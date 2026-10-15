import type { UnitSymbols } from '../../prefs/units';
import type { LaunchConditions } from '../design/orkTree';
import type { LauncherKind } from '../design/launcher';
import { launchLimitViolations, limitNote } from '../flight/safetyLimits';
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
 * The notes are keyed, like the reader's own, and the workspace keeps them that
 * way: the banner translates them on every read, so a note made under one
 * language renders in whichever the app shows later. The figures in a note are
 * in the units selected when the file was opened. `launcher` is the imported
 * design's, so the rod angle sentence names its rail or rod.
 *
 * The reader's own array comes back unchanged when there is nothing to add.
 */
export function importNotes(
  fileNotes: ImportNote[],
  flights: readonly { launch: LaunchConditions; powerClass: PowerClass }[],
  launcher: LauncherKind | null,
  units: UnitSymbols,
): ImportNote[] {
  const seen = new Set<string>();
  const added: ImportNote[] = [];
  for (const f of flights) {
    for (const v of launchLimitViolations(f.launch, f.powerClass)) {
      const note = limitNote(v, units, launcher);
      // The same sentence with the same figures, whichever simulation raised it.
      const wording = JSON.stringify(note);
      if (seen.has(wording)) continue;
      seen.add(wording);
      added.push(note);
    }
  }
  return added.length ? [...fileNotes, ...added] : fileNotes;
}

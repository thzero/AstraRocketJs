import { useEffect } from 'react';
import { useWorkspaceStore, selectRunFailed, selectOutdated, selectShownSim } from '../../state/store';
import { fireAction } from '../../state/fireAction';
import { useSettings } from '../../state/SettingsProvider';
import { isResultView } from '../../state/tabs';

/**
 * Optionally auto-run the shown sim when it is outdated (never run or stale) and
 * a results view is open.
 *
 * No effect walks the user off a result view: an edit ages the numbers instead
 * of deleting them, and a simulation that has never been run shows the "run one"
 * prompt rather than an empty pane.
 */
export function useAutoRunOutdated() {
  const { settings } = useSettings();
  const autoRun = settings.simulation.autoRunOutdated;
  const view = useWorkspaceStore((s) => s.view);
  // The center pane stays mounted, hidden, behind the Configurations and
  // Simulations tabs, and `view` keeps the last result view there. Without the
  // tab check, an edit on the Simulations tab re-flies the row, and the landed
  // run pulls the user off the tab they are editing on.
  const onResults = useWorkspaceStore((s) => s.tab === 'results');
  // The flight on screen, which is the one the Outdated chip describes: the row
  // the Results picker is on, else the active row. Re-flying any other row would
  // leave the chip up over the numbers the user is looking at.
  const shownId = useWorkspaceStore((s) => selectShownSim(s).id);
  const result = useWorkspaceStore((s) => selectShownSim(s).result);
  const outdated = useWorkspaceStore((s) => selectOutdated(s, selectShownSim(s)));
  const runSims = useWorkspaceStore((s) => s.runSims);
  const busy = useWorkspaceStore((s) => s.simBusy);
  // A run that threw leaves exactly the state auto-run fires on (no result, not
  // busy, result view open), so without this it would retry the same failing
  // design forever, each iteration spawning another full flight sim.
  const runFailed = useWorkspaceStore((s) => selectRunFailed(s, selectShownSim(s)));
  // Asks "is there a design?" as a BOOLEAN, never the `info` object: an engine
  // rebuild (applyBuild) hands the store a fresh info identity, and depending on
  // that re-fires the effect for a design that hasn't actually changed.
  const hasDesign = useWorkspaceStore((s) => !!s.info);
  // "Run outdated simulations automatically" covers both a missing result and an
  // aged one, which is what the setting says.
  const needsRun = !result || !!outdated;
  useEffect(() => {
    if (autoRun && onResults && isResultView(view) && needsRun && hasDesign && !busy && !runFailed) {
      fireAction(runSims([shownId]));
    }
  }, [onResults, view, needsRun, hasDesign, busy, runFailed, autoRun, runSims, shownId]);
}

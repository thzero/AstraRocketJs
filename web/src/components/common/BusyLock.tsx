import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';

/**
 * A full-cover overlay that blocks interaction with the SIMULATION editor while
 * a run is in flight. The parent must be `relative`.
 *
 * It used to cover the design panes too — the component tree, the property
 * editor, the 2D/3D canvas — because a flight is computed from a snapshot of the
 * design, and an edit mid-run would leave a result describing a rocket that is
 * no longer on screen. That is now handled properly rather than prevented:
 * `runSims` records the tree it flew (`ranOn`) and discards every answer that
 * comes back against a different one, so editing during a run costs the run
 * instead of freezing the app for it. With the worker pool a batch can be
 * several seconds long, and locking the whole design for it was the wrong
 * trade.
 *
 * What is left is the simulation editor, where the hazard is different and
 * still real. A run installs its result with `outdated: false`, while editing a
 * simulation's launch conditions sets `outdated: true`; without the lock, an
 * edit made mid-run would be overwritten by an answer computed from the
 * conditions it replaced, and the row would claim to be current. Closing that
 * needs the same identity check `ranOn` does, per simulation.
 */
export function BusyLock() {
  const busy = useWorkspaceStore((s) => s.simBusy);
  const { t } = useTranslation();
  if (!busy) return null;
  return (
    <div
      className="absolute inset-0 z-40 cursor-wait bg-slate-950/30"
      title={t('sim.lockedWhileRunning')}
      aria-hidden
    />
  );
}

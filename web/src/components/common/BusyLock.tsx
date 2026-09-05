import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';

/**
 * A full-cover overlay that blocks all interaction with a design-editing pane
 * while a simulation is running. The sim worker computes a flight from a
 * snapshot of the design; if the design could change mid-flight, the result
 * would describe a design that's no longer on screen. Locking the editors for
 * the (~500 ms) run keeps the on-screen design and the incoming result in sync.
 *
 * Drop this inside any pane that can mutate the design (component tree, canvas
 * drag, motor / launch inputs). The parent must be `relative`.
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

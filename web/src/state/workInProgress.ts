import { useWorkspaceStore } from './store';
import { useConfirmStore } from './confirmStore';
import { usePromptStore } from './promptStore';

/**
 * Whether reloading the tab now would interrupt something: a batch of flights
 * or a drift sweep still in the air, or a dialog waiting on an answer. An
 * import asks about a name clash mid-action, and a reload under that dialog
 * abandons the import with nothing said.
 *
 * Read at the moment it is needed, not subscribed to.
 */
export function workInProgress(): boolean {
  const s = useWorkspaceStore.getState();
  return (
    s.simBusy ||
    s.driftSweepRun !== null ||
    useConfirmStore.getState().request !== null ||
    usePromptStore.getState().request !== null
  );
}

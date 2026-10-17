import type { WorkspaceState } from './store';

/** The fields a workspace write stores (see `workspaceSnapshot`). */
type Written = Pick<WorkspaceState, 'tree' | 'sims' | 'configs' | 'activeId' | 'loadedMeta'>;

/**
 * The workspace as storage last saw it: the last write that landed, or a swap
 * that writes nothing because what it put on screen is already stored or not
 * worth storing (a load, a library open, New).
 *
 * The hidden-tab save, the unload journal and the flush ahead of opening
 * another design skip a workspace that still matches it. Writing it back
 * would change nothing but `updatedAt`, which reorders the library, and after
 * New it would create a library entry for a design nobody touched.
 *
 * Compared by identity: every edit replaces the object it changes, so an
 * object that is still the same one holds nothing new.
 */
let written: Written | null = null;

export function markWritten(s: Written): void {
  written = { tree: s.tree, sims: s.sims, configs: s.configs, activeId: s.activeId, loadedMeta: s.loadedMeta };
}

export function unchangedSinceWrite(s: Written): boolean {
  return (
    written !== null &&
    written.tree === s.tree &&
    written.sims === s.sims &&
    written.configs === s.configs &&
    written.activeId === s.activeId &&
    written.loadedMeta === s.loadedMeta
  );
}

/**
 * Which workspace a debounced autosave was armed for.
 *
 * The autosave timer captures the design it saves when it is armed, and React
 * clears it only when the effect re-runs, which is after the store changes.
 * A switch or delete that starts before then would let the timer write the
 * outgoing design into whatever the workspace store points at by the time it
 * fires. So the timer takes this token when it is armed and saves only if the
 * token is still current; anything that supersedes the pending save (a flush
 * ahead of a switch, deleting the open design, a workspace swap) moves it on.
 */
let autosaveToken = 0;

export function currentAutosaveToken(): number {
  return autosaveToken;
}

export function voidPendingAutosave(): void {
  autosaveToken++;
}

/**
 * Open holds on every write of the open design (`holdSaves`).
 *
 * Deleting the open design removes its index row before its blob, and a save
 * that cannot find its row adds one back. So while the delete runs, the
 * autosave, the hidden-tab save, the unload journal and the flush ahead of a
 * switch write nothing; a delete that fails releases the hold and flushes.
 */
let saveHolds = 0;

/** Hold every write of the open design until the returned release is called. */
export function holdSaves(): () => void {
  saveHolds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    saveHolds--;
  };
}

export function savesHeld(): boolean {
  return saveHolds > 0;
}

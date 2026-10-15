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

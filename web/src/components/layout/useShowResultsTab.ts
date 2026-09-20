import { useWorkspaceStore } from '../../state/store';

/**
 * Whether the Results tab is offered.
 *
 * Results only exist once SOME simulation has produced one, so the tab comes
 * and goes with that rather than sitting there empty. Any sim, not the active
 * one: switching to a never-run simulation should not take the tab away, and
 * the pane says "not run yet" for that row on its own.
 *
 * A design edit no longer takes it away either (results are flagged outdated,
 * not destroyed), so this now only fires on New / Open, where
 * `|| tab === 'results'` keeps the tab under anyone standing on it.
 *
 * One rule for both tab strips: the phone's bottom bar and the desktop header
 * strip each carried their own copy.
 */
export function useShowResultsTab(): boolean {
  const tab = useWorkspaceStore((s) => s.tab);
  const hasResult = useWorkspaceStore((s) => s.sims.some((x) => !!x.result));
  return hasResult || tab === 'results';
}

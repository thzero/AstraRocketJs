import { configOf, selectOutdated, useWorkspaceStore, type WorkspaceState } from '../../src/state/store';
import { resultKey, type Simulation } from '../../src/services/flight/simulations';

/**
 * A row as if it had just been flown on the workspace's current inputs: the
 * `resultKey` a run would have written, so it reads current until something it
 * depends on moves. Planting a `result` without this leaves the row reading
 * outdated from the start.
 */
export const asFlown = (st: WorkspaceState, sim: Simulation): Simulation => ({
  ...sim,
  resultKey: resultKey(st.tree, configOf(st.configs, sim), sim, st.simPrefs),
});

/** Whether the store currently derives this row as outdated. */
export const isStale = (sim: Simulation): boolean => selectOutdated(useWorkspaceStore.getState(), sim);

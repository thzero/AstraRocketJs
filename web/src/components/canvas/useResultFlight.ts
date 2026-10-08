import { useMemo } from 'react';
import { useWorkspaceStore, selectActive } from '../../state/store';
import { resultFlight, type ResultFlight } from '../../services/flight/simulations';

/**
 * The flight the results views draw and the flight the 3D path animates. Owns
 * which simulation's result is shown; nothing here draws.
 */
export function useResultFlight() {
  const result = useWorkspaceStore((s) => selectActive(s).result);
  const sims = useWorkspaceStore((s) => s.sims);
  const activeId = useWorkspaceStore((s) => selectActive(s).id);
  const resultSimId = useWorkspaceStore((s) => s.resultSimId);

  /**
   * The flight every results view draws, chosen in the Results picker.
   *
   * Built here with useMemo rather than as a store selector: a selector that
   * builds a fresh object is compared by reference by zustand, so subscribing to
   * one re-renders forever (see `selectRunIds`).
   */
  const flight = useMemo<ResultFlight | null>(
    () => resultFlight(sims, resultSimId, activeId),
    [sims, resultSimId, activeId],
  );

  /**
   * The flight the 3D path animates: the one being shown, falling back to the
   * active row's own result.
   *
   * Bound once so the guard and the view cannot disagree. A guard that asked
   * the active simulation for a result while the view drew this expression
   * would, after adding a second row or picking another row in the Results
   * picker, leave the 3D path saying "run a simulation" while the charts
   * beside it drew the flight.
   */
  const pathResult = flight?.result ?? result;

  return { flight, pathResult };
}

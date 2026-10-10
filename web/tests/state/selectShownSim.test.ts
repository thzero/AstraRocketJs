import { describe, it, expect } from 'vitest';
import { selectShownSim } from '../../src/state/store';
import type { WorkspaceState } from '../../src/state/store';
import type { Simulation } from '../../src/services/flight/simulations';

/**
 * The simulation the Results tab's tiles, warnings and events read. It has to
 * be the flight the charts draw (`resultFlight`): the one picked in the Results
 * picker while it has a result, else the active one.
 */
const sim = (id: string, flown: boolean) =>
  ({ id, name: id, ...(flown ? { result: {} } : {}) }) as unknown as Simulation;

const state = (sims: Simulation[], activeId: string, resultSimId: string | null) =>
  ({ sims, activeId, resultSimId }) as unknown as WorkspaceState;

describe('selectShownSim', () => {
  const a = sim('a', true);
  const b = sim('b', true);

  it('is the picked flight, not the active row', () => {
    expect(selectShownSim(state([a, b], 'a', 'b'))).toBe(b);
  });

  it('is the active row when nothing is picked', () => {
    expect(selectShownSim(state([a, b], 'a', null))).toBe(a);
  });

  it('falls back to the active row when the pick has no result or is gone', () => {
    expect(selectShownSim(state([a, sim('b', false)], 'a', 'b'))).toBe(a);
    expect(selectShownSim(state([a, b], 'a', 'deleted'))).toBe(a);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useAutoRunOutdated } from '../../../src/components/canvas/useAutoRunOutdated';
import { useWorkspaceStore } from '../../../src/state/store';
import { SettingsProvider } from '../../../src/state/SettingsProvider';
import { resultKey } from '../../../src/services/flight/simulations';
import { configOf } from '../../../src/state/workspaceSelectors';
import { seedSettings } from '../../testing/renderWithProviders';

const st = () => useWorkspaceStore.getState();
const wrapper = ({ children }: { children: ReactNode }) => <SettingsProvider>{children}</SettingsProvider>;

/**
 * Auto-run re-flies the flight the Outdated chip describes: the row the Results
 * picker is on, not the active row.
 */
describe('useAutoRunOutdated', () => {
  const runSims = vi.fn(() => Promise.resolve({}));

  /** Two rows flown, the active one first, with the picker on the second. */
  const setRows = (activeFresh: boolean, shownFresh: boolean) => {
    st().resetWorkspace();
    st().addSim();
    const [a, b] = st().sims.map((x) => ({ ...x, result: {} as never }));
    const keyed = (sim: NonNullable<typeof a>, fresh: boolean) => ({
      ...sim,
      // No key reads as outdated against any design.
      resultKey: fresh ? resultKey(st().tree, configOf(st().configs, sim), sim, st().simPrefs) : undefined,
    });
    useWorkspaceStore.setState({
      tab: 'results',
      view: 'flight',
      sims: [keyed(a!, activeFresh), keyed(b!, shownFresh)],
      activeId: a!.id,
      resultSimId: b!.id,
      simRuns: {},
      simBusy: false,
      info: {} as never,
      runSims,
    });
    return { a: a!, b: b! };
  };

  beforeEach(() => {
    runSims.mockClear();
    seedSettings({ simulation: { autoRunOutdated: true } });
  });

  it('re-flies the picked flight when it is stale and the active row is fresh', () => {
    const { b } = setRows(true, false);
    renderHook(() => useAutoRunOutdated(), { wrapper });
    expect(runSims).toHaveBeenCalledTimes(1);
    expect(runSims).toHaveBeenCalledWith([b.id]);
  });

  it('flies nothing when the picked flight is fresh and the active row is stale', () => {
    setRows(false, true);
    renderHook(() => useAutoRunOutdated(), { wrapper });
    expect(runSims).not.toHaveBeenCalled();
  });
});

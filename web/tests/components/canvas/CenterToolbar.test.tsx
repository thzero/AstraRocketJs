// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';

import { CenterToolbar } from '../../../src/components/canvas/CenterToolbar';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';
import { resultKey, type SimRun } from '../../../src/services/flight/simulations';
import { configOf } from '../../../src/state/workspaceSelectors';

const st = () => useWorkspaceStore.getState();

const renderToolbar = () =>
  renderWithProviders(
    <CenterToolbar
      resultName="Simulation 1"
      onCtrlSlot={() => {}}
      onPresetSlot={() => {}}
      maxed={false}
      onToggleMaxed={() => {}}
    />,
  );

/**
 * The Results heading says when the flight it shows is being flown again, so
 * the numbers on screen are known to be about to change. While it runs, the
 * Running chip stands in for Outdated, which is true but no longer the thing to
 * act on.
 */
describe('CenterToolbar run state', () => {
  const setRun = (run: SimRun | undefined) => {
    const id = st().sims[0]!.id;
    // A result with no resultKey reads as outdated against any design.
    useWorkspaceStore.setState({
      tab: 'results',
      view: 'flight',
      resultSimId: null,
      sims: [{ ...st().sims[0]!, result: {} as never, resultKey: undefined }],
      activeId: id,
      simRuns: run ? { [id]: run } : {},
    });
  };

  beforeEach(() => setRun(undefined));

  it('shows Outdated and no Running chip when nothing is flying', () => {
    renderToolbar();
    expect(screen.getByText('Outdated')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows Running in place of Outdated while the shown flight runs', () => {
    setRun({ phase: 'running' });
    renderToolbar();
    expect(screen.getByRole('status').textContent).toBe('Running');
    expect(screen.queryByText('Outdated')).toBeNull();
  });

  it('shows Running while the shown flight waits its turn in a batch', () => {
    setRun({ phase: 'queued' });
    renderToolbar();
    expect(screen.getByRole('status').textContent).toBe('Running');
  });
});

/**
 * The Outdated chip sits beside the heading, so it describes the flight the
 * heading names: the picked row when the picker is on one, not the active row.
 */
describe('CenterToolbar Outdated chip', () => {
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
    });
  };

  it('shows when the picked flight is stale and the active row is fresh', () => {
    setRows(true, false);
    renderToolbar();
    expect(screen.getByText('Outdated')).toBeTruthy();
  });

  it('stays hidden when the picked flight is fresh and the active row is stale', () => {
    setRows(false, true);
    renderToolbar();
    expect(screen.queryByText('Outdated')).toBeNull();
  });
});

/**
 * The toolbar's glyph and letter buttons are named for a screen reader, and a
 * toggle keeps one name while aria-pressed carries its state.
 */
describe('CenterToolbar button names', () => {
  beforeEach(() => useWorkspaceStore.setState({ tab: 'design', view: '2d' }));

  it('names each ruler toggle for its side, not its letter', () => {
    renderToolbar();
    for (const side of ['Top', 'Bottom', 'Left', 'Right']) {
      expect(screen.getByRole('button', { name: `${side} ruler` })).toBeTruthy();
    }
  });

  it('keeps the maximize toggle on one name, with the state in aria-pressed', () => {
    const name = 'Expand the drawing to the whole window';
    const { unmount } = renderToolbar();
    expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('false');
    unmount();
    renderWithProviders(
      <CenterToolbar
        resultName="Simulation 1"
        onCtrlSlot={() => {}}
        onPresetSlot={() => {}}
        maxed={true}
        onToggleMaxed={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('true');
  });
});

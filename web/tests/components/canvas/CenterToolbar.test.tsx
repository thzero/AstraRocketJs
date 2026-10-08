// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';

import { CenterToolbar } from '../../../src/components/canvas/CenterToolbar';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';
import type { SimRun } from '../../../src/services/flight/simulations';

const st = () => useWorkspaceStore.getState();

const renderToolbar = () =>
  renderWithProviders(
    <CenterToolbar resultName="Simulation 1" onCtrlSlot={() => {}} maxed={false} onToggleMaxed={() => {}} />,
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

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { LocationsDialog } from '../../../src/components/sim/LocationsDialog';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';
import {
  setLaunchLocationStore,
  type LaunchLocation,
  type LaunchLocationStore,
} from '../../../src/services/storage/launchLocationStore';

const HOME: LaunchLocation = {
  id: 'home',
  name: 'Home field',
  latitudeDeg: 39.05,
  longitudeDeg: -104.8,
  launchAltitudeM: 1830,
};

const memoryStore = (items: LaunchLocation[]): LaunchLocationStore => ({
  list: async () => items,
  save: async () => {},
  remove: async () => {},
});

const st = () => useWorkspaceStore.getState();

/**
 * Applying a location writes to every ticked simulation, like every other
 * launch edit. The dialog also opens from the menu, away from the editor's
 * "editing N simulations" banner, so the button says how many it writes to.
 * And it is one undo step, closed when the click is done.
 */
describe('LocationsDialog, Use', () => {
  beforeEach(() => {
    setLaunchLocationStore(memoryStore([HOME]));
    act(() => {
      st().resetWorkspace();
      st().addSim();
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const pick = async () => {
    fireEvent.click(await screen.findByText('Home field'));
  };

  it('says Use when it writes to one simulation', async () => {
    renderWithProviders(<LocationsDialog onClose={() => {}} />);
    await pick();
    expect(screen.getByRole('button', { name: 'Use' })).toBeTruthy();
  });

  it('names the count when several simulations are ticked, and writes to them', async () => {
    act(() => useWorkspaceStore.setState({ selectedSimIds: st().sims.map((s) => s.id) }));
    renderWithProviders(<LocationsDialog onClose={() => {}} />);
    await pick();
    fireEvent.click(screen.getByRole('button', { name: 'Use for 2 simulations' }));
    for (const sim of st().sims) expect(sim.launch.launchAltitudeM).toBe(1830);
  });

  it('closes its undo step', async () => {
    const real = st().commitEdit;
    const commitEdit = vi.fn(real);
    act(() => useWorkspaceStore.setState({ commitEdit }));
    try {
      renderWithProviders(<LocationsDialog onClose={() => {}} />);
      await pick();
      fireEvent.click(screen.getByRole('button', { name: 'Use' }));
      expect(commitEdit).toHaveBeenCalled();
    } finally {
      act(() => useWorkspaceStore.setState({ commitEdit: real }));
    }
  });
});

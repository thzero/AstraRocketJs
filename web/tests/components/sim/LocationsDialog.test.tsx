// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { LocationsDialog } from '../../../src/components/sim/LocationsDialog';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';
import { useConfirmStore } from '../../../src/state/confirmStore';
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
 * Applying a location writes to the active simulation only. The dialog also
 * opens from the menu, away from the editor's "editing N simulations" banner,
 * so it never reaches the ticked rows. And it is one undo step.
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

  it('writes the active simulation alone when several are ticked', async () => {
    act(() => useWorkspaceStore.setState({ selectedSimIds: st().sims.map((s) => s.id) }));
    const activeId = st().activeId;
    renderWithProviders(<LocationsDialog onClose={() => {}} />);
    await pick();
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    for (const sim of st().sims) {
      if (sim.id === activeId) expect(sim.launch.launchAltitudeM).toBe(1830);
      else expect(sim.launch.launchAltitudeM).not.toBe(1830);
    }
  });

  it('is one undo step', async () => {
    const before = st().sims.find((s) => s.id === st().activeId)!.launch;
    const past = st().past.length;
    renderWithProviders(<LocationsDialog onClose={() => {}} />);
    await pick();
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    expect(st().past).toHaveLength(past + 1);
    act(() => st().undo());
    expect(st().sims.find((s) => s.id === st().activeId)!.launch).toEqual(before);
  });
});

/**
 * Closing throws an unsaved edit away as surely as picking another location
 * does, so it asks the same question first.
 */
describe('LocationsDialog, closing with unsaved edits', () => {
  beforeEach(() => {
    setLaunchLocationStore(memoryStore([HOME]));
    act(() => st().resetWorkspace());
  });
  afterEach(() => {
    act(() => useConfirmStore.getState().settle(false));
  });

  it('asks before discarding, and stays open when the user keeps editing', async () => {
    const onClose = vi.fn();
    renderWithProviders(<LocationsDialog onClose={onClose} />);
    fireEvent.click(await screen.findByText('Home field'));
    fireEvent.change(screen.getByDisplayValue('Home field'), { target: { value: 'Club field' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!);
    await waitFor(() => expect(useConfirmStore.getState().request).not.toBeNull());
    act(() => useConfirmStore.getState().settle(false));
    await Promise.resolve();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes at once with nothing edited', async () => {
    const onClose = vi.fn();
    renderWithProviders(<LocationsDialog onClose={onClose} />);
    fireEvent.click(await screen.findByText('Home field'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useConfirmStore.getState().request).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';

import { ConfigsPane } from '../../../src/components/config/ConfigsPane';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';
import { useConfirmStore } from '../../../src/state/confirmStore';
import { findMounts, findRecoveryDevices, findStages } from '../../../src/services/design/treeEdit';
import { C6 } from '../../../src/engine/api';

const st = () => useWorkspaceStore.getState();
const mountId = () => findMounts(st().tree)[0]!.id as string;
const table = () => screen.getByRole('table', { name: /flight configurations/i });
/** Data rows only: the header row is a row too. */
const rows = () => within(table()).getAllByRole('row').slice(1);

/**
 * The configurations table is the one place a loadout is authored, so what it
 * has to get right is the list itself: which setups exist, which one is
 * selected, and how many simulations each one flies.
 */
describe('ConfigsPane', () => {
  beforeEach(() => {
    // jsdom has no matchMedia, and the pane asks whether it is at a desktop
    // width (useMediaQuery) to decide whether the motor editor goes inline under
    // the table. Answer "desktop", where the editor is the tab's own column and
    // this pane is the toolbar and the table.
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    st().resetWorkspace();
    st().setConfigsTab('motors');
  });

  it('lists one row per configuration, labeled by its motors when unnamed', () => {
    renderWithProviders(<ConfigsPane />);
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]!).getByRole('button', { name: /C6/ })).toBeTruthy();
  });

  it('names the seated motor with its delay, not just its designation', () => {
    // The delay is when the nose comes off, so a cell reading "C6" has not said
    // which motor this mount is flying. The app seats a C6 on a 5 s charge.
    renderWithProviders(<ConfigsPane />);
    expect(within(rows()[0]!).getByText('C6-5')).toBeTruthy();
  });

  it('counts the simulations flying each configuration', () => {
    st().addSim(); // joins the same setup: one configuration, two flights
    renderWithProviders(<ConfigsPane />);
    expect(within(rows()[0]!).getByText('2')).toBeTruthy();
  });

  it('adds a configuration and selects it', () => {
    renderWithProviders(<ConfigsPane />);
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    expect(rows()).toHaveLength(2);
    expect(st().selectedConfigId).toBe(st().configs[1]!.id);
  });

  it('copies the selected configuration, motors and all', () => {
    st().setMountMotor(st().configs[0]!.id, mountId(), { ...C6, designation: 'D12' });
    renderWithProviders(<ConfigsPane />);
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    expect(st().configs).toHaveLength(2);
    expect(st().configs[1]!.motors[mountId()]!.spec.designation).toBe('D12');
  });

  it('will not delete the only configuration', () => {
    renderWithProviders(<ConfigsPane />);
    const del = screen.getByRole('button', { name: /Delete/ }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
  });

  it('asks before deleting one that simulations fly, and moves them when confirmed', async () => {
    st().addConfig(); // the second one, selected, flown by nobody
    const doomed = st().selectedConfigId!;
    st().setSimConfig(st().sims[0]!.id, doomed); // now it is flown
    renderWithProviders(<ConfigsPane />);

    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    // The prompt is a real question, not a formality: the rows flying it are
    // about to fly something else.
    expect(useConfirmStore.getState().request).toBeTruthy();
    useConfirmStore.getState().settle(true);
    await screen.findByRole('table', { name: /flight configurations/i });

    expect(st().configs).toHaveLength(1);
    expect(st().sims.every((x) => x.configId === st().configs[0]!.id)).toBe(true);
  });

  it('deletes one nothing flies without asking', () => {
    st().addConfig();
    renderWithProviders(<ConfigsPane />);
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(useConfirmStore.getState().request).toBeFalsy();
    expect(st().configs).toHaveLength(1);
  });

  it('switches the columns to the recovery devices, and back', () => {
    renderWithProviders(<ConfigsPane />);
    // The default design has one mount and one parachute, so each sub-tab has
    // exactly one part column of its own.
    expect(within(table()).getByRole('columnheader', { name: /Parachute|Inner tube/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Recovery' }));
    expect(st().configsTab).toBe('recovery');
    // The cell says WHEN it opens, which is the whole of what this sub-tab is for.
    expect(within(rows()[0]!).getByText(/Apogee/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Motors' }));
    expect(st().configsTab).toBe('motors');
  });

  it('marks a deployment the configuration overrides, against the ones it inherits', () => {
    st().setDeployment(st().configs[0]!.id, findRecoveryDevices(st().tree)[0]!.id as string, 'deployEvent', 'altitude');
    st().setConfigsTab('recovery');
    renderWithProviders(<ConfigsPane />);
    expect(within(rows()[0]!).getByText(/Altitude/i)).toBeTruthy();
  });

  it('shows a staging column per stage, separating or not', () => {
    st().setConfigsTab('separation');
    renderWithProviders(<ConfigsPane />);
    // The default design is single-stage: one stage column, which can still be
    // grounded even though it separates from nothing.
    expect(within(table()).getAllByRole('columnheader')).toHaveLength(3);
  });

  it('gives a second stage its own column, showing when it lets go', () => {
    st().addStageToTree();
    st().setConfigsTab('separation');
    renderWithProviders(<ConfigsPane />);
    expect(within(table()).getAllByRole('columnheader')).toHaveLength(4);
    expect(within(rows()[0]!).getByText(/ejection/i)).toBeTruthy();
  });

  it('says which stages a configuration leaves on the ground', () => {
    // Two stages, because the last one still flying cannot be grounded: a
    // rocket with nothing in the air is not a flight.
    st().addStageToTree();
    const booster = findStages(st().tree)[1]!.id as string;
    st().setStageFlies(st().configs[0]!.id, booster, false);
    st().setConfigsTab('separation');
    renderWithProviders(<ConfigsPane />);
    expect(within(rows()[0]!).getByText(/grounded/i)).toBeTruthy();
  });

  it('selecting a row points the editor at it', () => {
    st().addConfig();
    st().setSelectedConfigId(null); // back to following the active simulation
    renderWithProviders(<ConfigsPane />);
    fireEvent.click(within(rows()[1]!).getAllByRole('button')[0]!);
    expect(st().selectedConfigId).toBe(st().configs[1]!.id);
  });
});

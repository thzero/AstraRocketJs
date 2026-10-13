// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { SettingsDialog } from '../../../src/components/layout/SettingsDialog';
import { readSettings, renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import { useConfirmStore } from '../../../src/state/confirmStore';

beforeEach(() => {
  localStorage.clear();
  useConfirmStore.setState({ request: null });
});

/** Reset all wipes every tab at once, with no undo, so it asks first. */
describe('Settings reset all', () => {
  it('asks before resetting, and resets nothing when declined', async () => {
    seedSettings({ playbackSpeed: 4 });
    renderWithProviders(<SettingsDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    const ask = useConfirmStore.getState().request;
    expect(ask?.danger).toBe(true);
    await act(async () => useConfirmStore.getState().settle(false));
    expect(readSettings()['playbackSpeed']).toBe(4);
  });

  it('resets once confirmed', async () => {
    seedSettings({ playbackSpeed: 4 });
    renderWithProviders(<SettingsDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    await act(async () => useConfirmStore.getState().settle(true));
    expect(readSettings()['playbackSpeed']).not.toBe(4);
  });
});

/**
 * The Launch tab holds the home site the user typed, and Materials what they
 * chose per part type. A tab reset there has no undo, so it asks; the tabs of
 * picked preferences reset at once.
 */
describe('Settings tab reset', () => {
  const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

  it('asks before resetting the Launch tab, and keeps the site when declined', async () => {
    seedSettings({ launchDefaults: { latitudeDeg: 39.05 } as never });
    renderWithProviders(<SettingsDialog onClose={() => {}} />);
    openTab('Launch');
    fireEvent.click(screen.getByRole('button', { name: 'Reset Launch' }));
    expect(useConfirmStore.getState().request?.danger).toBe(true);
    await act(async () => useConfirmStore.getState().settle(false));
    expect((readSettings()['launchDefaults'] as { latitudeDeg: number }).latitudeDeg).toBe(39.05);
  });

  it('resets the Launch tab once confirmed', async () => {
    seedSettings({ launchDefaults: { latitudeDeg: 39.05 } as never });
    renderWithProviders(<SettingsDialog onClose={() => {}} />);
    openTab('Launch');
    fireEvent.click(screen.getByRole('button', { name: 'Reset Launch' }));
    await act(async () => useConfirmStore.getState().settle(true));
    expect((readSettings()['launchDefaults'] as { latitudeDeg: number }).latitudeDeg).not.toBe(39.05);
  });

  // The Colors tab edits the aero heat palette too, so its reset has to cover it.
  it('resets the aero heat palette with the Colors tab', async () => {
    seedSettings({ aeroHeat: 'openrocket' });
    renderWithProviders(<SettingsDialog onClose={() => {}} />);
    openTab('Colors');
    fireEvent.click(screen.getByRole('button', { name: 'Reset Colors' }));
    if (useConfirmStore.getState().request) await act(async () => useConfirmStore.getState().settle(true));
    expect(readSettings()['aeroHeat']).toBe('sky');
  });

  it('resets a preference tab without asking', () => {
    seedSettings({ playbackSpeed: 4 });
    renderWithProviders(<SettingsDialog onClose={() => {}} />);
    openTab('Playback');
    fireEvent.click(screen.getByRole('button', { name: 'Reset Playback' }));
    expect(useConfirmStore.getState().request).toBeNull();
    expect(readSettings()['playbackSpeed']).not.toBe(4);
  });
});

/** Each part color's reset button says which part it resets. */
describe('Settings part color reset', () => {
  it('names the part on its reset button', () => {
    seedSettings({ partColors: { fins: '#123456' } });
    renderWithProviders(<SettingsDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Colors' }));
    expect(screen.getByRole('button', { name: 'Reset Fins to default color' })).toBeTruthy();
  });
});

/**
 * Launch defaults are written when a field is left, not per keystroke: a
 * settings write hits storage, and each prefix typed would otherwise become
 * the default for new simulations.
 */
describe('Settings launch defaults', () => {
  it('writes a typed altitude on blur, not on each key', () => {
    renderWithProviders(<SettingsDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Launch' }));
    const box = screen.getByRole('spinbutton', { name: /^Altitude/ });
    const before = (readSettings()['launchDefaults'] as Record<string, number> | undefined)?.['launchAltitudeM'];
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '1' } });
    fireEvent.change(box, { target: { value: '12' } });
    expect((readSettings()['launchDefaults'] as Record<string, number> | undefined)?.['launchAltitudeM']).toBe(before);
    fireEvent.blur(box);
    const after = (readSettings()['launchDefaults'] as Record<string, number>)['launchAltitudeM'];
    expect(after).toBeGreaterThan(0);
    expect(after).not.toBe(before);
  });
});

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

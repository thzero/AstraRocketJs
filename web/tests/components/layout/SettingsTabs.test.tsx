// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { PlaybackTab, SimTab } from '../../../src/components/layout/SettingsTabs';
import { readSettings, renderWithProviders, seedSettings } from '../../testing/renderWithProviders';

beforeEach(() => localStorage.clear());

/** Each Settings tab renders and writes on its own, outside the dialog. */
describe('a Settings tab alone', () => {
  it('writes the playback speed', () => {
    seedSettings({ playbackSpeed: 1 });
    renderWithProviders(<PlaybackTab />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '4' } });
    expect(readSettings()['playbackSpeed']).toBe(4);
  });

  it('shows the simulation defaults', () => {
    renderWithProviders(<SimTab />);
    expect(screen.getByLabelText('Time step')).toBeTruthy();
    expect(screen.getByLabelText('Max angle step')).toBeTruthy();
  });
});

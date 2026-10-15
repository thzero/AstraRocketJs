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

/**
 * A numeric setting is written when the field is left, not per keystroke:
 * every caller substitutes its default for an empty box, so a write mid-edit
 * would refill the box under the cursor.
 */
describe('a numeric setting', () => {
  const timeStep = () => (readSettings()['simulation'] as Record<string, number> | undefined)?.['timeStep'];

  it('is written on blur, not on each key', () => {
    renderWithProviders(<SimTab />);
    const box = screen.getByRole('spinbutton', { name: 'Time step' });
    const before = timeStep();
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '0.0' } });
    fireEvent.change(box, { target: { value: '0.02' } });
    expect(timeStep()).toBe(before);
    fireEvent.blur(box);
    expect(timeStep()).toBe(0.02);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';

const saveSettings = vi.hoisted(() => vi.fn());
const loadSettings = vi.hoisted(() => vi.fn());

vi.mock('../services/settings', async (orig) => {
  const real = await orig<typeof import('../services/settings')>();
  return { ...real, saveSettings, loadSettings };
});

import { SettingsProvider, useSettings } from './SettingsProvider';
import { DEFAULT_SETTINGS } from '../services/settings';

/** Renders the provider and hands back its `update` so a test can change one. */
function Harness({ onReady }: { onReady: (u: (p: Record<string, unknown>) => void) => void }) {
  const { update } = useSettings();
  onReady(update as (p: Record<string, unknown>) => void);
  return null;
}

beforeEach(() => {
  saveSettings.mockClear();
  loadSettings.mockReset();
});

describe('SettingsProvider persistence', () => {
  /**
   * The provider seeds its state from `loadSettings()`, which NORMALIZES —
   * dropping keys it does not recognize. Writing that output straight back on
   * mount therefore meant merely OPENING an older build permanently destroyed
   * any preference a newer build had written, instead of leaving it untouched
   * for the newer build to find again.
   */
  it('does not write settings back on mount', () => {
    loadSettings.mockReturnValue({ ...DEFAULT_SETTINGS });
    render(
      <SettingsProvider>
        <Harness onReady={() => {}} />
      </SettingsProvider>,
    );
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('writes once the user actually changes something', () => {
    loadSettings.mockReturnValue({ ...DEFAULT_SETTINGS });
    let update!: (p: Record<string, unknown>) => void;
    render(
      <SettingsProvider>
        <Harness onReady={(u) => (update = u)} />
      </SettingsProvider>,
    );
    expect(saveSettings).not.toHaveBeenCalled();

    // act(): the state change has to commit before the effect that persists it runs.
    act(() => update({ units: { ...DEFAULT_SETTINGS.units, length: 'in' } }));
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });
});

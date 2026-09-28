// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { act, render } from '@testing-library/react';

const saveSettings = vi.hoisted(() => vi.fn());
const loadSettings = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/settings', async (orig) => {
  const real = await orig<typeof import('../../src/services/settings')>();
  return { ...real, saveSettings, loadSettings };
});

import { SettingsProvider, useSettings } from '../../src/state/SettingsProvider';
import { DEFAULT_SETTINGS } from '../../src/services/settings';

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

    act(() => update({ units: { ...DEFAULT_SETTINGS.units, length: 'in' } }));
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings.mock.calls[0]![0].units.length).toBe('in');
  });

  /**
   * The first guard against the mount write was a "skip the first effect run"
   * ref. StrictMode runs every effect's setup twice on mount and refs persist
   * across the pair, so the second run saw the flag set and wrote anyway: the
   * bug was back in exactly the environment developers test in (main.tsx
   * renders under StrictMode). Persisting from the update event has no first
   * run to skip.
   */
  it('does not write on mount under StrictMode either', () => {
    loadSettings.mockReturnValue({ ...DEFAULT_SETTINGS });
    render(
      <StrictMode>
        <SettingsProvider>
          <Harness onReady={() => {}} />
        </SettingsProvider>
      </StrictMode>,
    );
    expect(saveSettings).not.toHaveBeenCalled();
  });
});

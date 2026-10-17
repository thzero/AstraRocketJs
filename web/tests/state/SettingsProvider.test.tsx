// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { act, render } from '@testing-library/react';

const saveSettings = vi.hoisted(() => vi.fn());
const loadSettings = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/storage/settings', async (orig) => {
  const real = await orig<typeof import('../../src/services/storage/settings')>();
  // The real reading until a test sets its own: the workspace store reads the
  // settings when it is built, which happens as the provider is imported.
  loadSettings.mockImplementation(real.loadSettings);
  return { ...real, saveSettings, loadSettings };
});

import { SettingsProvider, useSettings } from '../../src/state/SettingsProvider';
import { DEFAULT_SETTINGS } from '../../src/services/storage/settings';
import { nsKey } from '../../src/services/storage/storageKeys';

type SettingsUpdate = ReturnType<typeof useSettings>['update'];

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
   * The provider seeds its state from `loadSettings()`, which normalizes,
   * dropping keys it does not recognize. Writing that output straight back on
   * mount would mean merely opening an older build permanently destroys any
   * preference a newer build had written, instead of leaving it untouched for
   * the newer build to find again.
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
   * A "skip the first effect run" ref does not guard the mount write.
   * StrictMode runs every effect's setup twice on mount and refs persist across
   * the pair, so the second run sees the flag set and writes anyway (main.tsx
   * renders under StrictMode).
   * Persisting from the update event has no first run to skip.
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

describe('SettingsProvider with another tab writing', () => {
  const KEY = nsKey('settings:v1');

  /** Renders the provider and hands back the live settings and `update`. */
  function Probe({ onRender }: { onRender: (ctx: ReturnType<typeof useSettings>) => void }) {
    onRender(useSettings());
    return null;
  }

  afterEach(() => localStorage.clear());

  it('reloads when another tab writes the settings', () => {
    loadSettings.mockReturnValue({ ...DEFAULT_SETTINGS, theme: 'dark' });
    let theme = '';
    render(
      <SettingsProvider>
        <Probe onRender={(c) => (theme = c.settings.theme)} />
      </SettingsProvider>,
    );
    expect(theme).toBe('dark');

    loadSettings.mockReturnValue({ ...DEFAULT_SETTINGS, theme: 'light' });
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' })));
    expect(theme).toBe('dark');
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: KEY })));
    expect(theme).toBe('light');
    // Read only: echoing the change back would bounce it between tabs.
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('lays a change over what storage holds, not over the stale copy', () => {
    loadSettings.mockReturnValue({ ...DEFAULT_SETTINGS, theme: 'dark' });
    let update!: SettingsUpdate;
    render(
      <SettingsProvider>
        <Probe onRender={(c) => (update = c.update)} />
      </SettingsProvider>,
    );
    // Another tab's write, before its storage event reaches this one.
    localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_SETTINGS, theme: 'light' }));

    act(() => update({ units: { ...DEFAULT_SETTINGS.units, length: 'in' } }));
    const written = saveSettings.mock.calls[0]![0] as typeof DEFAULT_SETTINGS;
    expect(written.units.length).toBe('in');
    expect(written.theme).toBe('light');
  });

  /**
   * An older build of this PWA can run beside a newer one. Its change must not
   * destroy the preferences the newer build stored under keys it does not know.
   */
  it("writes a newer build's keys back as stored", () => {
    loadSettings.mockReturnValue({ ...DEFAULT_SETTINGS });
    let update!: SettingsUpdate;
    render(
      <SettingsProvider>
        <Probe onRender={(c) => (update = c.update)} />
      </SettingsProvider>,
    );
    const newer = { panelLayout: { rows: 3, pinned: ['stats'] }, beta: true };
    localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...newer }));
    const stored = JSON.parse(localStorage.getItem(KEY)!) as Record<string, unknown>;

    act(() => update({ theme: 'light' }));
    const written = saveSettings.mock.calls[0]![0] as Record<string, unknown>;
    expect(written['panelLayout']).toEqual(stored['panelLayout']);
    expect(written['beta']).toEqual(stored['beta']);
    expect(written['theme']).toBe('light');
  });
});

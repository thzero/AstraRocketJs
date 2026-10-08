import { createContext, useCallback, useContext, useMemo, useState, type ReactNode, useEffect } from 'react';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../services/storage/settings';
import { applyTheme, followSystemTheme } from '../services/app/theme';

/**
 * Surface a refused settings write, out of the React updater it is detected in.
 *
 * `saveSettings` runs inside `setSettings`'s updater - deliberately, so it writes
 * the state it is actually storing - and a zustand write from there is a store
 * write during render. The microtask puts it after the render pass. Same banner
 * the design library and the workspace use for the same cause.
 *
 * The store is imported LAZILY, and not for weight: a static edge from here would
 * construct the workspace store as a side effect of loading this provider, and the
 * store's initial state reads `loadSettings()` at construction. A test that mocks
 * the settings module then builds the store against the mock before it has set one
 * up. Nothing about a settings write needs the store until a write is refused.
 */
const reportRefused = () => {
  queueMicrotask(() => {
    void import('./store').then(({ useWorkspaceStore }) => useWorkspaceStore.getState().warnStorageFull());
  });
};

interface SettingsCtx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const Ctx = createContext<SettingsCtx | null>(null);

/** Holds the app's user preferences, persists them, and exposes them reactively. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  // The theme follows the setting, and "Follow system" follows the OS.
  useEffect(() => {
    applyTheme(settings.theme);
    return followSystemTheme(settings.theme);
  }, [settings.theme]);

  // Persist from the two events that change settings, never from an effect on
  // `settings`. An effect writes loadSettings()' own output straight back on
  // mount, and `loadSettings` normalizes by dropping keys it does not recognize,
  // so merely OPENING an older build would destroy any preference a newer build
  // wrote. A "skip the first run" ref does not save it either: StrictMode runs
  // every effect's setup twice on mount and refs persist across the pair, so the
  // second run sees the flag set and writes anyway. Writing from the event has no
  // first run to skip.
  //
  // Stable identities, so a consumer can list `update` in an effect's deps
  // (or leave it out) without the effect re-running on every settings change.
  const update = useCallback(
    (patch: Partial<Settings>) =>
      setSettings((s) => {
        const next = { ...s, ...patch };
        if (!saveSettings(next)) reportRefused();
        return next;
      }),
    [],
  );
  const reset = useCallback(() => {
    if (!saveSettings(DEFAULT_SETTINGS)) reportRefused();
    setSettings(DEFAULT_SETTINGS);
  }, []);
  const value = useMemo(() => ({ settings, update, reset }), [settings, update, reset]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}

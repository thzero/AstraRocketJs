import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../services/storage/settings';

interface SettingsCtx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const Ctx = createContext<SettingsCtx | null>(null);

/** Holds the app's user preferences, persists them, and exposes them reactively. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);

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
        saveSettings(next);
        return next;
      }),
    [],
  );
  const reset = useCallback(() => {
    saveSettings(DEFAULT_SETTINGS);
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

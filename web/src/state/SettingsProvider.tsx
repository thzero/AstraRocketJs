import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../services/settings';

interface SettingsCtx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const Ctx = createContext<SettingsCtx | null>(null);

/** Holds the app's user preferences, persists them, and exposes them reactively. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  useEffect(() => { saveSettings(settings); }, [settings]);

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  const reset = () => setSettings(DEFAULT_SETTINGS);

  return <Ctx.Provider value={{ settings, update, reset }}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}
